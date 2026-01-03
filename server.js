import express from "express";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Vérification des variables d'environnement
console.log("=== VÉRIFICATION CONFIG ===");
console.log("SUPABASE_URL:", SUPABASE_URL ? "✓ Définie" : "✗ MANQUANTE");
console.log("SUPABASE_KEY:", SUPABASE_KEY ? "✓ Définie" : "✗ MANQUANTE");
console.log("========================\n");

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ ERREUR: Variables d'environnement manquantes!");
  console.error("Créez un fichier .env avec:");
  console.error("SUPABASE_URL=https://votre-projet.supabase.co");
  console.error("SUPABASE_KEY=votre_anon_key");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

app.use(express.json());
app.use(express.static("public"));

// Middleware de logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ============================================
// ENDPOINTS EXISTANTS
// ============================================

// --- Upload frame ---
app.post("/upload", upload.single("frame"), async (req, res) => {
  console.log("\n=== DÉBUT UPLOAD FRAME ===");

  try {
    if (!req.file) {
      console.log("❌ Aucun fichier fourni");
      return res.status(400).json({ error: "Aucun fichier fourni" });
    }

    console.log("✓ Fichier reçu:", req.file.size, "bytes");

    const buffer = req.file.buffer;
    const clientHash = req.body.hash;
    const serverHash = hashBuffer(buffer);

    console.log("Hash client:", clientHash?.substring(0, 16) + "...");
    console.log("Hash serveur:", serverHash.substring(0, 16) + "...");

    if (clientHash !== serverHash) {
      console.log("❌ Hash mismatch!");
      return res.status(400).json({
        error: "Hash mismatch",
        clientHash,
        serverHash,
      });
    }

    console.log("✓ Hash validé");

    const sessionCode = req.body.sessionId || "default";
    console.log("Session:", sessionCode);

    // Créer la session si elle n'existe pas
    console.log("Création/mise à jour de la session...");
    const { data: sessionData, error: sessionError } = await supabase
      .from("sessions")
      .upsert({ session_code: sessionCode }, { onConflict: "session_code" });

    if (sessionError) {
      console.error("❌ Erreur session:", sessionError);
      return res
        .status(500)
        .json({ error: sessionError.message, details: sessionError });
    }
    console.log("✓ Session créée/mise à jour");

    const timestamp = req.body.timestamp || Date.now();
    const timestampNum = Number(timestamp);

    if (isNaN(timestampNum)) {
      console.error("❌ Timestamp invalide:", timestamp);
      return res.status(400).json({ error: "Timestamp invalide" });
    }

    const fileName = `sessions/${sessionCode}/frame_${timestampNum}_${clientHash.substring(
      0,
      8
    )}.jpg`;
    console.log("Nom du fichier:", fileName);
    console.log(
      "Timestamp:",
      timestampNum,
      "→",
      new Date(timestampNum).toISOString()
    );

    // Upload vers Supabase Storage
    console.log("Upload vers Supabase Storage...");
    const { data, error } = await supabase.storage
      .from("videos")
      .upload(fileName, buffer, {
        contentType: "image/jpeg",
        upsert: false,
      });

    if (error) {
      console.error("❌ Erreur upload storage:", error);
      return res.status(500).json({ error: error.message, details: error });
    }
    console.log("✓ Upload storage réussi");

    // Insertion dans la table frames
    console.log("Insertion dans la table frames...");
    const { data: frameData, error: frameError } = await supabase
      .from("frames")
      .insert({
        session_code: sessionCode,
        hash: clientHash,
        file_path: fileName,
        timestamp: new Date(timestampNum).toISOString(),
      });

    if (frameError) {
      console.error("❌ Erreur insertion frame:", frameError);
      return res
        .status(500)
        .json({ error: frameError.message, details: frameError });
    }

    console.log("✓ Frame enregistrée en base");
    console.log("=== FIN UPLOAD FRAME (SUCCÈS) ===\n");

    res.json({ success: true, hash: clientHash, path: fileName });
  } catch (err) {
    console.error("❌ ERREUR CRITIQUE:", err);
    console.error("Stack:", err.stack);
    console.log("=== FIN UPLOAD FRAME (ERREUR) ===\n");
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// --- Upload vidéo complète ---
app.post("/upload-full-video", upload.single("fullVideo"), async (req, res) => {
  console.log("\n=== DÉBUT UPLOAD VIDÉO COMPLÈTE ===");

  try {
    if (!req.file) {
      console.log("❌ Aucune vidéo fournie");
      return res.status(400).json({ error: "Aucune vidéo fournie" });
    }

    console.log(
      "✓ Vidéo reçue:",
      (req.file.size / 1024 / 1024).toFixed(2),
      "MB"
    );

    const buffer = req.file.buffer;
    const sessionCode = req.body.sessionId || "default";
    const fileName = `sessions/${sessionCode}/fullVideo_${Date.now()}.webm`;

    console.log("Session:", sessionCode);
    console.log("Nom du fichier:", fileName);
    console.log("Upload vers Supabase Storage...");

    const { data, error } = await supabase.storage
      .from("videos")
      .upload(fileName, buffer, {
        contentType: "video/webm",
        upsert: true,
      });

    if (error) {
      console.error("❌ Erreur upload:", error);
      return res.status(500).json({ error: error.message, details: error });
    }

    console.log("✓ Vidéo uploadée avec succès");
    console.log("=== FIN UPLOAD VIDÉO (SUCCÈS) ===\n");

    res.json({ success: true, path: fileName });
  } catch (err) {
    console.error("❌ ERREUR CRITIQUE:", err);
    console.error("Stack:", err.stack);
    console.log("=== FIN UPLOAD VIDÉO (ERREUR) ===\n");
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// --- Terminer session ---
app.post("/end-session", async (req, res) => {
  console.log("\n=== FIN DE SESSION ===");
  try {
    const { sessionId } = req.body;
    console.log("Session à terminer:", sessionId);

    const { error } = await supabase
      .from("sessions")
      .update({ ended_at: new Date().toISOString() })
      .eq("session_code", sessionId);

    if (error) {
      console.error("❌ Erreur:", error);
      return res.status(500).json({ error: error.message });
    }

    console.log("✓ Session terminée");
    console.log("===================\n");
    res.json({ success: true });
  } catch (err) {
    console.error("❌ ERREUR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// NOUVEAUX ENDPOINTS POUR LE DÉCODEUR
// ============================================

// --- Récupérer tous les hashs d'une session ---
app.get("/get-session-hashes", async (req, res) => {
  console.log("\n=== RÉCUPÉRATION HASHS SESSION ===");

  try {
    const sessionId = req.query.sessionId;

    if (!sessionId) {
      console.log("❌ Session ID manquant");
      return res.status(400).json({ error: "Session ID requis" });
    }

    console.log("Session demandée:", sessionId);

    // Récupérer tous les hashs de cette session
    const { data: frames, error } = await supabase
      .from("frames")
      .select("hash, timestamp, file_path")
      .eq("session_code", sessionId)
      .order("timestamp", { ascending: true });

    if (error) {
      console.error("❌ Erreur récupération:", error);
      return res.status(500).json({ error: error.message, details: error });
    }

    console.log(`✓ ${frames.length} hashs récupérés`);
    console.log("=================================\n");

    res.json({
      success: true,
      sessionId: sessionId,
      count: frames.length,
      hashes: frames,
    });
  } catch (err) {
    console.error("❌ ERREUR:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- Reconstituer la vidéo à partir des frames stockées ---
app.get("/reconstruct-video", async (req, res) => {
  console.log("\n=== RECONSTRUCTION VIDÉO ===");

  try {
    const sessionId = req.query.sessionId;

    if (!sessionId) {
      console.log("❌ Session ID manquant");
      return res.status(400).json({ error: "Session ID requis" });
    }

    console.log("Session demandée:", sessionId);

    // Récupérer tous les frames de cette session, ordonnés par timestamp
    const { data: frames, error } = await supabase
      .from("frames")
      .select("file_path, timestamp")
      .eq("session_code", sessionId)
      .order("timestamp", { ascending: true });

    if (error) {
      console.error("❌ Erreur récupération frames:", error);
      return res.status(500).json({ error: error.message });
    }

    if (frames.length === 0) {
      console.log("⚠️ Aucune frame trouvée");
      return res
        .status(404)
        .json({ error: "Aucune frame trouvée pour cette session" });
    }

    console.log(`✓ ${frames.length} frames à télécharger`);

    // Télécharger toutes les frames depuis Supabase Storage
    const frameBuffers = [];

    for (let i = 0; i < frames.length; i++) {
      console.log(`Téléchargement frame ${i + 1}/${frames.length}...`);

      const { data: frameData, error: downloadError } = await supabase.storage
        .from("videos")
        .download(frames[i].file_path);

      if (downloadError) {
        console.error(`❌ Erreur téléchargement frame ${i}:`, downloadError);
        continue;
      }

      const buffer = Buffer.from(await frameData.arrayBuffer());
      frameBuffers.push(buffer);
    }

    console.log(`✓ ${frameBuffers.length} frames téléchargées`);

    // Pour simplifier, on retourne un zip contenant toutes les frames
    // Dans une vraie implémentation, on utiliserait FFmpeg pour créer une vidéo

    // Ici, on retourne simplement les frames en JSON avec leurs données base64
    const framesData = frameBuffers.map((buffer, index) => ({
      index: index,
      timestamp: frames[index].timestamp,
      data: buffer.toString("base64"),
    }));

    console.log("✓ Reconstruction terminée");
    console.log("============================\n");

    res.json({
      success: true,
      sessionId: sessionId,
      frameCount: framesData.length,
      frames: framesData,
    });
  } catch (err) {
    console.error("❌ ERREUR:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- Vérifier l'intégrité d'une frame spécifique ---
app.post("/verify-frame", async (req, res) => {
  console.log("\n=== VÉRIFICATION FRAME ===");

  try {
    const { hash, sessionId } = req.body;

    if (!hash || !sessionId) {
      return res.status(400).json({ error: "Hash et sessionId requis" });
    }

    console.log("Hash à vérifier:", hash.substring(0, 16) + "...");
    console.log("Session:", sessionId);

    // Chercher cette frame dans la base
    const { data: frames, error } = await supabase
      .from("frames")
      .select("*")
      .eq("session_code", sessionId)
      .eq("hash", hash);

    if (error) {
      console.error("❌ Erreur recherche:", error);
      return res.status(500).json({ error: error.message });
    }

    const exists = frames && frames.length > 0;

    console.log(exists ? "✅ Frame valide" : "❌ Frame invalide");
    console.log("==========================\n");

    res.json({
      valid: exists,
      hash: hash,
      sessionId: sessionId,
      frame: exists ? frames[0] : null,
    });
  } catch (err) {
    console.error("❌ ERREUR:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- Statistiques d'une session ---
app.get("/session-stats", async (req, res) => {
  console.log("\n=== STATISTIQUES SESSION ===");

  try {
    const sessionId = req.query.sessionId;

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID requis" });
    }

    console.log("Session:", sessionId);

    // Récupérer les infos de la session
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("*")
      .eq("session_code", sessionId)
      .single();

    if (sessionError) {
      console.error("❌ Session non trouvée:", sessionError);
      return res.status(404).json({ error: "Session non trouvée" });
    }

    // Compter les frames
    const { count, error: countError } = await supabase
      .from("frames")
      .select("*", { count: "exact", head: true })
      .eq("session_code", sessionId);

    if (countError) {
      console.error("❌ Erreur comptage:", countError);
      return res.status(500).json({ error: countError.message });
    }

    // Récupérer la première et dernière frame
    const { data: firstFrame } = await supabase
      .from("frames")
      .select("timestamp")
      .eq("session_code", sessionId)
      .order("timestamp", { ascending: true })
      .limit(1)
      .single();

    const { data: lastFrame } = await supabase
      .from("frames")
      .select("timestamp")
      .eq("session_code", sessionId)
      .order("timestamp", { ascending: false })
      .limit(1)
      .single();

    const stats = {
      sessionId: sessionId,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      frameCount: count || 0,
      firstFrameTimestamp: firstFrame?.timestamp,
      lastFrameTimestamp: lastFrame?.timestamp,
      duration:
        firstFrame && lastFrame
          ? new Date(lastFrame.timestamp) - new Date(firstFrame.timestamp)
          : null,
    };

    console.log("✓ Statistiques calculées");
    console.log(`  - Frames: ${stats.frameCount}`);
    console.log(
      `  - Durée: ${
        stats.duration ? (stats.duration / 1000).toFixed(2) + "s" : "N/A"
      }`
    );
    console.log("============================\n");

    res.json(stats);
  } catch (err) {
    console.error("❌ ERREUR:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- Health check ---
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    supabase: SUPABASE_URL ? "configured" : "missing",
  });
});

const PORT = process.env.PORT || 3014;
app.listen(PORT, () => {
  console.log("\n🚀 ===============================");
  console.log(`✓ Serveur démarré sur http://localhost:${PORT}`);
  console.log(`✓ Interface d'enregistrement: http://localhost:${PORT}`);
  console.log(`✓ Interface de décodage: http://localhost:${PORT}/decoder.html`);
  console.log("================================\n");
});

