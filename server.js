const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const express = require("express");
const multer = require("multer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const ffmpegPath = require("ffmpeg-static");
const { compareAudio } = require("./server/scoring");

const PORT = Number(process.env.PORT || 8080);
const SAMPLE_RATE = 16000;
const PUBLIC_DIR = path.join(__dirname, "public");
const REFERENCE_AUDIO_PATH = path.join(PUBLIC_DIR, "assets", "Michael Jackson Hee Hee.mp3");
const MAX_NAME_LENGTH = 40;
const LEADERBOARD_MAX_SIZE = 10;
const MAX_UPLOAD_MB = 4;
const MAX_RECORDING_SECONDS = 10;
const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
]);

const app = express();
app.set("trust proxy", 1);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (!file || !file.mimetype || !ALLOWED_AUDIO_MIME_TYPES.has(file.mimetype)) {
      cb(new Error("Unsupported audio format."));
      return;
    }
    cb(null, true);
  },
});

let referenceSamples = null;
let scores = [];
let nextScoreId = 1;

function compareEntries(a, b) {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  if (a.createdAt !== b.createdAt) {
    return a.createdAt - b.createdAt;
  }
  return a.id - b.id;
}

function getTopLeaderboard(limit = LEADERBOARD_MAX_SIZE) {
  return scores
    .slice()
    .sort(compareEntries)
    .slice(0, limit)
    .map((entry) => ({
      name: entry.name,
      score: entry.score,
      createdAt: entry.createdAt,
    }));
}

function insertScore(name, score) {
  const createdAt = Date.now();
  const entry = { id: nextScoreId, name, score, createdAt };
  nextScoreId += 1;
  scores.push(entry);
  return entry;
}

function getRankForEntry(entry) {
  const sorted = scores.slice().sort(compareEntries);
  const index = sorted.findIndex((candidate) => candidate.id === entry.id);
  return index >= 0 ? index + 1 : sorted.length + 1;
}

async function decodeAudioBufferToMonoFloat32(inputBuffer) {
  if (!ffmpegPath) {
    throw new Error("ffmpeg binary not found. Install dependencies.");
  }

  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-f",
      "f32le",
      "pipe:1",
    ];

    const ffmpeg = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdoutChunks = [];
    const stderrChunks = [];

    ffmpeg.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    ffmpeg.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    ffmpeg.on("error", (err) => reject(err));

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        reject(new Error(`ffmpeg decode failed (${code}): ${stderr}`));
        return;
      }

      const pcmBuffer = Buffer.concat(stdoutChunks);
      if (pcmBuffer.length < 4) {
        resolve(new Float32Array(0));
        return;
      }

      const samples = new Float32Array(Math.floor(pcmBuffer.length / 4));
      for (let i = 0; i < samples.length; i += 1) {
        samples[i] = pcmBuffer.readFloatLE(i * 4);
      }
      resolve(samples);
    });

    ffmpeg.stdin.write(inputBuffer);
    ffmpeg.stdin.end();
  });
}

function sanitizeName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_NAME_LENGTH);
}

app.disable("x-powered-by");
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: "200kb" }));

app.use("/api", rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.use("/api/submit-score", rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.use("/api/analyze-score", rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    uptimeSec: Math.round(process.uptime()),
    storeReady: true,
    entries: scores.length,
    referenceReady: Boolean(referenceSamples && referenceSamples.length > 0),
  });
});

app.get("/api/leaderboard", (req, res) => {
  const leaderboard = getTopLeaderboard();
  res.json({ leaderboard });
});

app.post("/api/analyze-score", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      res.status(400).json({ error: "Audio upload is required." });
      return;
    }

    const userSamples = await decodeAudioBufferToMonoFloat32(req.file.buffer);
    if (userSamples.length < SAMPLE_RATE * 0.2) {
      res.status(400).json({ error: "Audio is too short." });
      return;
    }
    if (userSamples.length > SAMPLE_RATE * MAX_RECORDING_SECONDS) {
      res.status(400).json({ error: `Audio is too long. Max is ${MAX_RECORDING_SECONDS} seconds.` });
      return;
    }

    const score = compareAudio(referenceSamples, userSamples, SAMPLE_RATE);
    res.json({ score });
  } catch (error) {
    console.error(error);
    if (error && error.message === "Unsupported audio format.") {
      res.status(400).json({ error: "Unsupported audio format." });
      return;
    }
    res.status(500).json({ error: "Could not process score on server." });
  }
});

app.post("/api/submit-score", upload.single("audio"), async (req, res) => {
  try {
    const name = sanitizeName(req.body.name);
    if (!name) {
      res.status(400).json({ error: "Name is required." });
      return;
    }
    if (!req.file || !req.file.buffer) {
      res.status(400).json({ error: "Audio upload is required." });
      return;
    }

    const userSamples = await decodeAudioBufferToMonoFloat32(req.file.buffer);
    if (userSamples.length < SAMPLE_RATE * 0.2) {
      res.status(400).json({ error: "Audio is too short." });
      return;
    }
    if (userSamples.length > SAMPLE_RATE * MAX_RECORDING_SECONDS) {
      res.status(400).json({ error: `Audio is too long. Max is ${MAX_RECORDING_SECONDS} seconds.` });
      return;
    }

    const score = compareAudio(referenceSamples, userSamples, SAMPLE_RATE);
    const entry = insertScore(name, score);
    const rank = getRankForEntry(entry);
    const leaderboard = getTopLeaderboard();
    res.json({ entry, rank, leaderboard });
  } catch (error) {
    console.error(error);
    if (error && error.message === "Unsupported audio format.") {
      res.status(400).json({ error: "Unsupported audio format." });
      return;
    }
    res.status(500).json({ error: "Could not process score on server." });
  }
});

app.use(express.static(PUBLIC_DIR, {
  index: false,
  dotfiles: "deny",
  etag: true,
  fallthrough: true,
  extensions: false,
}));

app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((error, req, res, next) => {
  if (error && error.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: `Audio file too large. Max ${MAX_UPLOAD_MB}MB.` });
    return;
  }
  if (error && error.message === "Unsupported audio format.") {
    res.status(400).json({ error: "Unsupported audio format." });
    return;
  }
  if (error) {
    console.error("Unhandled server error:", error);
    res.status(500).json({ error: "Server error." });
    return;
  }
  next();
});

async function start() {
  const referenceBuffer = fs.readFileSync(REFERENCE_AUDIO_PATH);
  referenceSamples = await decodeAudioBufferToMonoFloat32(referenceBuffer);
  if (!referenceSamples || referenceSamples.length === 0) {
    throw new Error("Reference audio decode produced no samples.");
  }
  app.listen(PORT, () => {
    console.log(`MJ App server running at http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error("Server startup failed:", error);
  process.exit(1);
});
