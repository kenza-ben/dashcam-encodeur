// import express from "express";
// import multer from "multer";
// import { createClient } from "@supabase/supabase-js";
// import crypto from "crypto";
// import dotenv from "dotenv";

// dotenv.config();

// const app = express();
// const upload = multer({
//   storage: multer.memoryStorage(),
//   limits: { fileSize: 50 * 1024 * 1024 },
// });

// const SUPABASE_URL = process.env.SUPABASE_URL;
// const SUPABASE_KEY = process.env.SUPABASE_KEY;
// const RETENTION_HOURS = parseInt(process.env.RETENTION_HOURS || '2');

// console.log("=== CONFIGURATION ===");
// console.log("SUPABASE_URL:", SUPABASE_URL ? "✓" : "✗ MANQUANTE");
// console.log("SUPABASE_KEY:", SUPABASE_KEY ? "✓" : "✗ MANQUANTE");
// console.log("RETENTION_HOURS:", RETENTION_HOURS, "heures");
// console.log("====================\n");

// if (!SUPABASE_URL || !SUPABASE_KEY) {
//   console.error("❌ ERREUR: Variables manquantes dans .env");
//   process.exit(1);
// }

// const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// function hashBuffer(buffer) {
//   return crypto.createHash("sha256").update(buffer).digest("hex");
// }

// app.use(express.json());
// app.use(express.static("public"));

// app.use((req, res, next) => {
//   console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
//   next();
// });

// // ============================================
// // NETTOYAGE AUTOMATIQUE DES SESSIONS EXPIRÉES
// // ============================================

// async function deleteExpiredSessions() {
//   console.log('\n🧹 === NETTOYAGE AUTOMATIQUE ===');

//   try {
//     // Trouver les sessions expirées (non déclarées et dépassant le délai)
//     const { data: expiredSessions, error } = await supabase
//       .from('sessions')
//       .select('session_code')
//       .lt('expires_at', new Date().toISOString())
//       .eq('declared', false)
//       .not('ended_at', 'is', null);

//     if (error) {
//       console.error('❌ Erreur recherche:', error);
//       return;
//     }

//     if (!expiredSessions || expiredSessions.length === 0) {
//       console.log('✓ Aucune session expirée à supprimer');
//       return;
//     }

//     console.log(`⚠️ ${expiredSessions.length} session(s) expirée(s) à supprimer`);

//     for (const session of expiredSessions) {
//       const sessionCode = session.session_code;
//       console.log(`\n🗑️ Suppression session: ${sessionCode}`);

//       // 1. Supprimer fichiers du storage Supabase
//       try {
//         const { data: files } = await supabase.storage
//           .from('videos')
//           .list(`sessions/${sessionCode}`);

//         if (files && files.length > 0) {
//           const filePaths = files.map(f => `sessions/${sessionCode}/${f.name}`);
//           await supabase.storage.from('videos').remove(filePaths);
//           console.log(`✓ ${files.length} fichier(s) supprimé(s) du storage`);
//         }
//       } catch (err) {
//         console.error(`❌ Erreur suppression storage:`, err.message);
//       }

//       // 2. Supprimer frames de la base
//       await supabase.from('frames').delete().eq('session_code', sessionCode);
//       console.log(`✓ Frames supprimées de la base`);

//       // 3. Supprimer la session
//       await supabase.from('sessions').delete().eq('session_code', sessionCode);
//       console.log(`✓ Session supprimée`);
//     }

//     console.log('\n✅ Nettoyage terminé\n');
//   } catch (err) {
//     console.error('❌ ERREUR lors du nettoyage:', err);
//   }
// }

// // Lancer le nettoyage toutes les 5 minutes
// setInterval(deleteExpiredSessions, 5 * 60 * 1000);
// // Premier nettoyage 5 secondes après le démarrage
// setTimeout(deleteExpiredSessions, 5000);

// // ============================================
// // ROUTES API
// // ============================================

// // Upload d'une frame
// app.post("/upload", upload.single("frame"), async (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({ error: "Aucun fichier" });
//     }

//     const buffer = req.file.buffer;
//     const clientHash = req.body.hash;
//     const serverHash = hashBuffer(buffer);

//     // Vérification d'intégrité
//     if (clientHash !== serverHash) {
//       return res.status(400).json({ error: "Hash mismatch" });
//     }

//     const sessionCode = req.body.sessionId || "default";
//     const timestamp = Number(req.body.timestamp) || Date.now();

//     if (isNaN(timestamp)) {
//       return res.status(400).json({ error: "Timestamp invalide" });
//     }

//     // Créer/mettre à jour session avec date d'expiration
//     const expiresAt = new Date(Date.now() + RETENTION_HOURS * 60 * 60 * 1000);

//     const { error: sessionError } = await supabase
//       .from("sessions")
//       .upsert({
//         session_code: sessionCode,
//         expires_at: expiresAt.toISOString(),
//         retention_hours: RETENTION_HOURS
//       }, { onConflict: "session_code" });

//     if (sessionError) {
//       return res.status(500).json({ error: sessionError.message });
//     }

//     const fileName = `sessions/${sessionCode}/frame_${timestamp}_${clientHash.substring(0,8)}.jpg`;

//     // Upload vers Supabase Storage
//     const { error } = await supabase.storage
//       .from("videos")
//       .upload(fileName, buffer, {
//         contentType: "image/jpeg",
//         upsert: false
//       });

//     if (error) {
//       // Gérer le cas du doublon (fichier déjà existant)
//       if (error.statusCode === '409') {
//         return res.status(500).json({
//           error: "The resource already exists",
//           details: error
//         });
//       }
//       return res.status(500).json({ error: error.message });
//     }

//     // Enregistrer dans la table frames
//     const { error: frameError } = await supabase
//       .from("frames")
//       .insert({
//         session_code: sessionCode,
//         hash: clientHash,
//         file_path: fileName,
//         timestamp: new Date(timestamp).toISOString()
//       });

//     if (frameError) {
//       return res.status(500).json({ error: frameError.message });
//     }

//     res.json({
//       success: true,
//       hash: clientHash,
//       path: fileName,
//       expiresAt: expiresAt.toISOString()
//     });

//   } catch (err) {
//     console.error('❌ ERREUR:', err);
//     res.status(500).json({ error: err.message });
//   }
// });

// // Upload vidéo complète
// app.post('/upload-full-video', upload.single('fullVideo'), async (req, res) => {
//   try {
//     if(!req.file) {
//       return res.status(400).json({ error: "Aucune vidéo" });
//     }

//     const buffer = req.file.buffer;
//     const sessionCode = req.body.sessionId || 'default';
//     const fileName = `sessions/${sessionCode}/fullVideo_${Date.now()}.webm`;

//     const { error } = await supabase.storage
//       .from('videos')
//       .upload(fileName, buffer, {
//         contentType: 'video/webm',
//         upsert: true
//       });

//     if(error) {
//       return res.status(500).json({ error: error.message });
//     }

//     // Retourner la date d'expiration
//     const { data: session } = await supabase
//       .from('sessions')
//       .select('expires_at')
//       .eq('session_code', sessionCode)
//       .single();

//     res.json({
//       success: true,
//       path: fileName,
//       expiresAt: session?.expires_at
//     });

//   } catch(err) {
//     console.error('❌ ERREUR:', err);
//     res.status(500).json({ error: err.message });
//   }
// });

// // Déclarer un sinistre (préserve les données)
// app.post("/declare-incident", async (req, res) => {
//   console.log('\n🚨 === DÉCLARATION DE SINISTRE ===');

//   try {
//     const { sessionId, description } = req.body;

//     if (!sessionId) {
//       return res.status(400).json({ error: 'sessionId requis' });
//     }

//     console.log('Session:', sessionId);
//     console.log('Description:', description || '(aucune)');

//     // Vérifier que la session existe
//     const { data: session, error: findError } = await supabase
//       .from('sessions')
//       .select('*')
//       .eq('session_code', sessionId)
//       .single();

//     if (findError || !session) {
//       return res.status(404).json({ error: 'Session non trouvée' });
//     }

//     // Vérifier si déjà expirée
//     if (session.expires_at && new Date(session.expires_at) < new Date()) {
//       console.log('⚠️ Session déjà expirée - données supprimées');
//       return res.status(410).json({
//         error: 'Session expirée, données déjà supprimées'
//       });
//     }

//     // Marquer comme déclarée = conservation permanente
//     const { error: updateError } = await supabase
//       .from('sessions')
//       .update({
//         declared: true,
//         declaration_time: new Date().toISOString(),
//         expires_at: null // Plus d'expiration !
//       })
//       .eq('session_code', sessionId);

//     if (updateError) {
//       return res.status(500).json({ error: updateError.message });
//     }

//     console.log('✅ Sinistre déclaré - Données préservées définitivement');
//     console.log('=====================================\n');

//     res.json({
//       success: true,
//       message: 'Sinistre déclaré avec succès',
//       sessionId: sessionId
//     });

//   } catch (err) {
//     console.error('❌ ERREUR:', err);
//     res.status(500).json({ error: err.message });
//   }
// });

// // Vérifier le statut d'une session
// app.get("/session-status/:sessionId", async (req, res) => {
//   try {
//     const { sessionId } = req.params;

//     const { data: session, error } = await supabase
//       .from('sessions')
//       .select('*')
//       .eq('session_code', sessionId)
//       .single();

//     if (error || !session) {
//       return res.status(404).json({ error: 'Session non trouvée' });
//     }

//     const now = new Date();
//     const expiresAt = session.expires_at ? new Date(session.expires_at) : null;
//     const timeRemaining = session.declared || !expiresAt ? null : Math.max(0, expiresAt - now);

//     res.json({
//       sessionId: session.session_code,
//       declared: session.declared,
//       expiresAt: session.expires_at,
//       timeRemainingMs: timeRemaining,
//       timeRemainingMinutes: timeRemaining ? Math.floor(timeRemaining / 1000 / 60) : null,
//       expired: !session.declared && expiresAt && expiresAt < now
//     });

//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // Terminer une session
// app.post("/end-session", async (req, res) => {
//   try {
//     const { sessionId } = req.body;

//     const { error } = await supabase
//       .from("sessions")
//       .update({ ended_at: new Date().toISOString() })
//       .eq("session_code", sessionId);

//     if (error) {
//       return res.status(500).json({ error: error.message });
//     }

//     res.json({ success: true });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// // Health check
// app.get("/health", (req, res) => {
//   res.json({
//     status: "ok",
//     timestamp: new Date().toISOString(),
//     retentionHours: RETENTION_HOURS
//   });
// });

// // Forcer le nettoyage manuellement (pour tests)
// app.post("/cleanup-expired", async (req, res) => {
//   try {
//     await deleteExpiredSessions();
//     res.json({ success: true, message: 'Nettoyage effectué' });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// const PORT = process.env.PORT || 3023;
// app.listen(PORT, () => {
//   console.log('\n🚀 ============================');
//   console.log(`✓ Serveur: http://localhost:${PORT}`);
//   console.log(`✓ Interface: http://localhost:${PORT}`);
//   console.log(`✓ Rétention: ${RETENTION_HOURS}h`);
//   console.log(`✓ Nettoyage: toutes les 5min`);
//   console.log('=============================\n');
// });

import express from "express";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import dotenv from "dotenv";
import cors from "cors";
// Charger les variables d'environnement EN PREMIER
dotenv.config();

// PUIS importer le décodeur
import { verifyVideo, reconstructVideo } from "./decoder.js";

const app = express();
app.use(cors());

// Configuration de multer pour les fichiers
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

const uploadLarge = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB pour vidéos
});

// Variables d'environnement
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const RETENTION_HOURS = parseInt(process.env.RETENTION_HOURS || "2");
const PORT = process.env.PORT || 3030;

console.log("=== CONFIGURATION ===");
console.log("SUPABASE_URL:", SUPABASE_URL ? "✓" : "✗ MANQUANTE");
console.log("SUPABASE_KEY:", SUPABASE_KEY ? "✓" : "✗ MANQUANTE");
console.log("RETENTION_HOURS:", RETENTION_HOURS, "heures");
console.log("====================\n");

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ ERREUR: Variables manquantes dans .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

app.use(express.json());
app.use(express.static("public"));

// ============================================
// NETTOYAGE AUTOMATIQUE DES SESSIONS EXPIRÉES
// ============================================

async function deleteExpiredSessions() {
  console.log("\n🧹 Nettoyage automatique...");

  try {
    const { data: expiredSessions, error } = await supabase
      .from("sessions")
      .select("session_code")
      .lt("expires_at", new Date().toISOString())
      .eq("declared", false);

    if (error || !expiredSessions || expiredSessions.length === 0) {
      console.log("✓ Rien à nettoyer\n");
      return;
    }

    console.log(`⚠️ ${expiredSessions.length} session(s) expirée(s)`);

    for (const session of expiredSessions) {
      const code = session.session_code;

      // Supprimer les fichiers du storage
      const { data: files } = await supabase.storage
        .from("videos")
        .list(`sessions/${code}`);

      if (files && files.length > 0) {
        const paths = files.map((f) => `sessions/${code}/${f.name}`);
        await supabase.storage.from("videos").remove(paths);
      }

      // Supprimer les frames
      await supabase.from("frames").delete().eq("session_code", code);

      // Supprimer la session
      await supabase.from("sessions").delete().eq("session_code", code);

      console.log(`✓ ${code} supprimée`);
    }

    console.log("✅ Nettoyage terminé\n");
  } catch (err) {
    console.error("❌ Erreur nettoyage:", err.message);
  }
}

// Nettoyage toutes les 5 minutes
setInterval(deleteExpiredSessions, 5 * 60 * 1000);
setTimeout(deleteExpiredSessions, 5000);

// ============================================
// ROUTES - ENREGISTREMENT
// ============================================

// Upload d'une frame
app.post("/upload", upload.single("frame"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Aucun fichier" });
    }

    const buffer = req.file.buffer;
    const clientHash = req.body.hash;
    const serverHash = hashBuffer(buffer);

    if (clientHash !== serverHash) {
      return res.status(400).json({ error: "Hash mismatch" });
    }

    const sessionCode = req.body.sessionId || "default";
    const timestamp = Number(req.body.timestamp) || Date.now();

    const expiresAt = new Date(Date.now() + RETENTION_HOURS * 60 * 60 * 1000);

    // Créer/mettre à jour la session
    await supabase.from("sessions").upsert(
      {
        session_code: sessionCode,
        expires_at: expiresAt.toISOString(),
        retention_hours: RETENTION_HOURS,
      },
      { onConflict: "session_code" }
    );

    const fileName = `sessions/${sessionCode}/frame_${timestamp}_${clientHash.substring(
      0,
      8
    )}.jpg`;

    // Upload vers Supabase Storage
    await supabase.storage.from("videos").upload(fileName, buffer, {
      contentType: "image/jpeg",
      upsert: false,
    });

    // Enregistrer dans la table frames
    await supabase.from("frames").insert({
      session_code: sessionCode,
      hash: clientHash,
      file_path: fileName,
      timestamp: new Date(timestamp).toISOString(),
    });

    res.json({
      success: true,
      hash: clientHash,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("❌ Erreur upload:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Upload vidéo complète
app.post("/upload-full-video", upload.single("fullVideo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Aucune vidéo" });
    }

    const sessionCode = req.body.sessionId || "default";
    const fileName = `sessions/${sessionCode}/fullVideo_${Date.now()}.webm`;

    await supabase.storage.from("videos").upload(fileName, req.file.buffer, {
      contentType: "video/webm",
      upsert: true,
    });

    const { data: session } = await supabase
      .from("sessions")
      .select("expires_at")
      .eq("session_code", sessionCode)
      .single();

    res.json({
      success: true,
      path: fileName,
      expiresAt: session?.expires_at,
    });
  } catch (err) {
    console.error("❌ Erreur upload vidéo:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Terminer une session
app.post("/end-session", async (req, res) => {
  try {
    const { sessionId } = req.body;

    await supabase
      .from("sessions")
      .update({ ended_at: new Date().toISOString() })
      .eq("session_code", sessionId);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// ROUTES - DÉCODEUR (SIMPLIFIÉ)
// ============================================

// Vérifier une vidéo
app.post("/verify-video", uploadLarge.single("video"), verifyVideo);

// Reconstruire une vidéo
app.post("/reconstruct-video", reconstructVideo);

// ============================================
// ROUTES - GESTION
// ============================================

// Déclarer un sinistre
app.post("/declare-incident", async (req, res) => {
  console.log("\n🚨 Déclaration de sinistre");

  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId requis" });
    }

    const { data: session, error } = await supabase
      .from("sessions")
      .select("*")
      .eq("session_code", sessionId)
      .single();

    if (error || !session) {
      return res.status(404).json({ error: "Session non trouvée" });
    }

    if (session.expires_at && new Date(session.expires_at) < new Date()) {
      return res.status(410).json({ error: "Session déjà expirée" });
    }

    // Marquer comme déclarée = conservation permanente
    await supabase
      .from("sessions")
      .update({
        declared: true,
        declaration_time: new Date().toISOString(),
        expires_at: null,
      })
      .eq("session_code", sessionId);

    console.log(`✅ Sinistre déclaré: ${sessionId}\n`);

    res.json({
      success: true,
      message: "Sinistre déclaré avec succès",
    });
  } catch (err) {
    console.error("❌ Erreur:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Statut d'une session
app.get("/session-status/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    const { data: session, error } = await supabase
      .from("sessions")
      .select("*")
      .eq("session_code", sessionId)
      .single();

    if (error || !session) {
      return res.status(404).json({ error: "Session non trouvée" });
    }

    const now = new Date();
    const expiresAt = session.expires_at ? new Date(session.expires_at) : null;
    const timeRemaining =
      session.declared || !expiresAt ? null : Math.max(0, expiresAt - now);

    res.json({
      sessionId: session.session_code,
      declared: session.declared,
      expiresAt: session.expires_at,
      timeRemainingMinutes: timeRemaining
        ? Math.floor(timeRemaining / 1000 / 60)
        : null,
      expired: !session.declared && expiresAt && expiresAt < now,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    retentionHours: RETENTION_HOURS,
  });
});

// Forcer le nettoyage
app.post("/cleanup-expired", async (req, res) => {
  try {
    await deleteExpiredSessions();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// DÉMARRAGE
// ============================================

app.listen(PORT, () => {
  console.log("\n🚀 ============================");
  console.log(`✓ Serveur: http://localhost:${PORT}`);
  console.log(`✓ Rétention: ${RETENTION_HOURS}h`);
  console.log(`✓ Décodeur: ACTIF`);
  console.log("=============================\n");
});
