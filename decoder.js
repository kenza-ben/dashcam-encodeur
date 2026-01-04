import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const execAsync = promisify(exec);

// Fonction pour calculer le hash d'un buffer
function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// ============================================
// VÉRIFIER UNE VIDÉO (NOUVELLE MÉTHODE)
// ============================================
export async function verifyVideo(req, res) {
  const tempDir = path.join(process.cwd(), 'temp_verify');
  
  try {
    console.log('\n🔍 === VÉRIFICATION VIDÉO (Méthode frames) ===');

    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'Pas de sessionId' });
    }

    console.log(`Session: ${sessionId}`);

    // 1. Récupérer les hashs stockés dans Supabase
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );

    const { data: storedFrames, error } = await supabase
      .from('frames')
      .select('hash, file_path, timestamp')
      .eq('session_code', sessionId)
      .order('timestamp', { ascending: true });

    if (error || !storedFrames || storedFrames.length === 0) {
      throw new Error('Session non trouvée ou pas de frames');
    }

    console.log(`✓ ${storedFrames.length} frames stockées trouvées`);

    // 2. Créer dossier temporaire
    await fs.mkdir(tempDir, { recursive: true });
    const framesDir = path.join(tempDir, 'frames');
    await fs.mkdir(framesDir, { recursive: true });

    // 3. Télécharger toutes les frames depuis Supabase Storage
    console.log('📥 Téléchargement des frames depuis Supabase...');
    const downloadedFrames = [];

    for (let i = 0; i < storedFrames.length; i++) {
      const storedFrame = storedFrames[i];
      
      try {
        const { data, error: downloadError } = await supabase.storage
          .from('videos')
          .download(storedFrame.file_path);

        if (downloadError) {
          console.error(`❌ Erreur téléchargement frame ${i}:`, downloadError.message);
          continue;
        }

        const buffer = Buffer.from(await data.arrayBuffer());
        const frameNumber = String(i + 1).padStart(4, '0');
        const framePath = path.join(framesDir, `frame_${frameNumber}.jpg`);
        
        await fs.writeFile(framePath, buffer);
        
        downloadedFrames.push({
          index: i,
          path: framePath,
          buffer: buffer,
          storedHash: storedFrame.hash,
          timestamp: storedFrame.timestamp
        });

      } catch (err) {
        console.error(`❌ Erreur frame ${i}:`, err.message);
      }
    }

    console.log(`✓ ${downloadedFrames.length} frames téléchargées`);

    // 4. Recalculer les hashs des frames téléchargées
    console.log('🔐 Recalcul des hashs...');
    const verificationResults = [];
    let validFrames = 0;
    let invalidFrames = 0;
    let modifiedFrames = [];

    for (const frame of downloadedFrames) {
      const recalculatedHash = hashBuffer(frame.buffer);
      const isValid = recalculatedHash === frame.storedHash;

      if (isValid) {
        validFrames++;
      } else {
        invalidFrames++;
        modifiedFrames.push({
          index: frame.index,
          storedHash: frame.storedHash,
          recalculatedHash: recalculatedHash,
          timestamp: frame.timestamp
        });
      }

      verificationResults.push({
        index: frame.index,
        storedHash: frame.storedHash,
        recalculatedHash: recalculatedHash,
        isValid: isValid
      });

      console.log(`Frame ${frame.index + 1}: ${isValid ? '✅' : '❌'} ${recalculatedHash.substring(0, 16)}...`);
    }

    // 5. Calculer l'intégrité
    const totalFrames = storedFrames.length;
    const integrity = (validFrames / totalFrames * 100).toFixed(2);

    console.log(`\n📊 RÉSULTATS:`);
    console.log(`✅ Frames valides: ${validFrames}/${totalFrames}`);
    console.log(`❌ Frames modifiées: ${invalidFrames}`);
    console.log(`📈 Intégrité: ${integrity}%`);

    // 6. Optionnel : Reconstruire la vidéo depuis les frames téléchargées
    let reconstructedVideoPath = null;
    if (downloadedFrames.length > 0) {
      try {
        console.log('\n🎬 Reconstruction de la vidéo...');
        reconstructedVideoPath = path.join(tempDir, 'reconstructed.mp4');
        const cmd = `ffmpeg -framerate 2 -i "${framesDir}/frame_%04d.jpg" -c:v libx264 -pix_fmt yuv420p "${reconstructedVideoPath}"`;
        await execAsync(cmd);
        console.log('✓ Vidéo reconstruite');
      } catch (err) {
        console.log('⚠️ Reconstruction vidéo échouée:', err.message);
      }
    }

    // 7. Nettoyer les fichiers temporaires
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log('✓ Fichiers temporaires supprimés\n');

    // 8. Renvoyer le résultat détaillé
    const isAuthentic = integrity >= 95;
    
    res.json({
      success: true,
      sessionId: sessionId,
      integrity: parseFloat(integrity),
      totalFrames: totalFrames,
      validFrames: validFrames,
      invalidFrames: invalidFrames,
      modifiedFrames: modifiedFrames,
      verdict: isAuthentic ? 'AUTHENTIQUE' : 'FRAUDULEUSE',
      authentic: isAuthentic,
      details: verificationResults,
      message: invalidFrames > 0 
        ? `⚠️ FRAUDE DÉTECTÉE ! ${invalidFrames} frame(s) ont été modifiée(s).` 
        : '✅ Toutes les frames sont authentiques.'
    });

  } catch (error) {
    console.error('❌ Erreur:', error.message);
    
    // Nettoyer même en cas d'erreur
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// ============================================
// RECONSTRUIRE UNE VIDÉO DEPUIS LES FRAMES
// ============================================
export async function reconstructVideo(req, res) {
  const tempDir = path.join(process.cwd(), 'temp_reconstruct');
  
  try {
    console.log('\n🎬 === RECONSTRUCTION VIDÉO ===');

    const { sessionId, fps = 2 } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'Pas de sessionId' });
    }

    console.log(`Session: ${sessionId}`);
    console.log(`FPS: ${fps}`);

    // 1. Récupérer les frames depuis Supabase
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );

    const { data: frames, error } = await supabase
      .from('frames')
      .select('file_path, timestamp')
      .eq('session_code', sessionId)
      .order('timestamp', { ascending: true });

    if (error || !frames || frames.length === 0) {
      throw new Error('Session non trouvée ou pas de frames');
    }

    console.log(`✓ ${frames.length} frames à télécharger`);

    // 2. Créer le dossier temporaire
    await fs.mkdir(tempDir, { recursive: true });
    const framesDir = path.join(tempDir, 'frames');
    await fs.mkdir(framesDir, { recursive: true });

    // 3. Télécharger toutes les frames
    for (let i = 0; i < frames.length; i++) {
      const { data, error } = await supabase.storage
        .from('videos')
        .download(frames[i].file_path);

      if (error) {
        console.log(`⚠️ Frame ${i} non téléchargée`);
        continue;
      }

      const buffer = Buffer.from(await data.arrayBuffer());
      const frameNumber = String(i + 1).padStart(4, '0');
      await fs.writeFile(path.join(framesDir, `frame_${frameNumber}.jpg`), buffer);
    }

    console.log('✓ Frames téléchargées');

    // 4. Créer la vidéo avec FFmpeg
    const outputVideo = path.join(tempDir, 'video.mp4');
    const cmd = `ffmpeg -framerate ${fps} -i "${framesDir}/frame_%04d.jpg" -c:v libx264 -pix_fmt yuv420p "${outputVideo}"`;
    await execAsync(cmd);
    console.log('✓ Vidéo reconstruite');

    // 5. Lire la vidéo
    const videoBuffer = await fs.readFile(outputVideo);

    // 6. Nettoyer
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log('✓ Fichiers temporaires supprimés\n');

    // 7. Envoyer la vidéo
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="verified_${sessionId}.mp4"`);
    res.send(videoBuffer);

  } catch (error) {
    console.error('❌ Erreur:', error.message);
    
    // Nettoyer même en cas d'erreur
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}