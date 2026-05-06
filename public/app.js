const startRecordBtn = document.getElementById("startRecordBtn");
const stopRecordBtn = document.getElementById("stopRecordBtn");
const playRecordBtn = document.getElementById("playRecordBtn");
const clearRecordBtn = document.getElementById("clearRecordBtn");
const analyzeBtn = document.getElementById("analyzeBtn");
const showResultBtn = document.getElementById("showResultBtn");
const saveScoreBtn = document.getElementById("saveScoreBtn");
const showLeaderboardBtn = document.getElementById("showLeaderboardBtn");
const recordedAudio = document.getElementById("recordedAudio");
const referenceAudioEl = document.getElementById("referenceAudio");
const recordingIndicator = document.getElementById("recordingIndicator");
const recordingCountdownEl = document.getElementById("recordingCountdown");
const statusEl = document.getElementById("status");
const playerNameInput = document.getElementById("playerNameInput");
const leaderboardList = document.getElementById("leaderboardList");
const actionStatusEl = document.getElementById("actionStatus");
const actionStatusTextEl = document.getElementById("actionStatusText");
const REFERENCE_AUDIO_PATH = "assets/Michael Jackson Hee Hee.mp3";
const LEADERBOARD_MAX_SIZE = 10;
const MAX_NAME_LENGTH = 40;
const MAX_RECORDING_SECONDS = 5;
const API_ENDPOINTS = {
  leaderboard: "/api/leaderboard",
  analyzeScore: "/api/analyze-score",
  submitScore: "/api/submit-score",
};
const API_TIMEOUT_MS = 8000;
const TOP_RANK_IMAGE_PATHS = [
  "assets/grammy_mj.png",
  "assets/mj_glove.png",
  "assets/pngegg (1).png",
];
const TOP_RANK_IMAGE_FALLBACK = "assets/top-rank-placeholder.svg";
const MISMATCH_GUARD = {
  maxMismatchScore: 0.49,
  weakEnvelope: 0.42,
  weakPitch: 0.38,
  weakStructure: 0.45,
  weakDuration: 0.55,
};
const RESULT_IMAGE_BY_BAND = {
  elite: "assets/MJ_aura.jpg",
  amazing: "assets/MJ_grammy.jpg",
  great: "assets/muzan_mj.jpg",
  good: "assets/MJ_Thriller laughing.jpg",
  decent: "assets/MJ_Polic.jpg",
  rough: "assets/MJ_Lean.jpg",
  needsWork: "assets/MJ_Under50.jpg",
};
const RESULT_TEXT_BY_BAND = {
  elite: "AURA! HE'S HIM!",
  amazing: "Granny",
  great: "You're getting pretty good. My name isn't Miguel",
  good: "Kinda mid... try again",
  decent: "I am call polic",
  rough: "Lean into it a bit....yeah heehee",
  needsWork: "iCarl sad and bad",
};

const resultModal = document.getElementById("resultModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const leaderboardModal = document.getElementById("leaderboardModal");
const closeLeaderboardModalBtn = document.getElementById("closeLeaderboardModalBtn");
const scoreText = document.getElementById("scoreText");
const resultCaptionEl = document.getElementById("resultCaption");
const mjImage = document.getElementById("mjImage");

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

const state = {
  stream: null,
  recorder: null,
  chunks: [],
  userBlob: null,
  userUrl: null,
  lastScore: null,
  leaderboardEntries: [],
  isBusy: false,
  lastSavedRank: null,
  lastSavedName: "",
  lastSavedScore: null,
  recordingStartedAtMs: null,
  recordedDurationSec: null,
  recordingTimeoutId: null,
  recordingCountdownIntervalId: null,
};

referenceAudioEl.src = encodeURI(REFERENCE_AUDIO_PATH);
updateResultActions();

startRecordBtn.addEventListener("click", startRecording);
stopRecordBtn.addEventListener("click", stopRecording);
playRecordBtn.addEventListener("click", playRecording);
clearRecordBtn.addEventListener("click", clearRecording);
analyzeBtn.addEventListener("click", analyzeHeeHee);
showResultBtn.addEventListener("click", showLastResult);
showLeaderboardBtn.addEventListener("click", showLeaderboardModal);
playerNameInput.addEventListener("input", updateResultActions);
saveScoreBtn.addEventListener("click", saveLatestScore);
closeModalBtn.addEventListener("click", closeModal);
closeLeaderboardModalBtn.addEventListener("click", closeLeaderboardModal);
resultModal.addEventListener("click", (event) => {
  if (event.target === resultModal) {
    closeModal();
  }
});
leaderboardModal.addEventListener("click", (event) => {
  if (event.target === leaderboardModal) {
    closeLeaderboardModal();
  }
});

mjImage.addEventListener("error", () => {
  mjImage.style.display = "none";
});

renderLeaderboard();
loadLeaderboardFromServer();

async function startRecording() {
  setStatus("Requesting microphone access...");

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("Microphone API is not available in this browser.");
    return;
  }

  try {
    resetRecording();
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const preferredMimeTypes = [
      "audio/webm;codecs=opus",
      "audio/ogg;codecs=opus",
      "audio/webm",
    ];

    const mimeType = preferredMimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
    state.recorder = mimeType
      ? new MediaRecorder(state.stream, { mimeType })
      : new MediaRecorder(state.stream);

    state.chunks = [];
    state.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        state.chunks.push(event.data);
      }
    };

    state.recorder.onstop = () => {
      clearRecordingTimeout();
      state.userBlob = new Blob(state.chunks, { type: state.recorder.mimeType || "audio/webm" });
      if (state.recordingStartedAtMs) {
        state.recordedDurationSec = (Date.now() - state.recordingStartedAtMs) / 1000;
      }
      if (state.userUrl) {
        URL.revokeObjectURL(state.userUrl);
      }
      state.userUrl = URL.createObjectURL(state.userBlob);
      recordedAudio.src = state.userUrl;
      setRecordingIndicator(false);
      playRecordBtn.disabled = false;
      clearRecordBtn.disabled = false;
      analyzeBtn.disabled = false;
      if (Number.isFinite(state.recordedDurationSec) && state.recordedDurationSec > MAX_RECORDING_SECONDS + 0.2) {
        analyzeBtn.disabled = true;
        setStatus(`Recording too long (${state.recordedDurationSec.toFixed(1)}s). Max is ${MAX_RECORDING_SECONDS}s.`);
      } else {
        setStatus("Recording captured. Hit Analyze when ready.");
      }
    };

    state.recorder.start();
    state.recordingStartedAtMs = Date.now();
    state.recordedDurationSec = null;
    startRecordingCountdown();
    state.recordingTimeoutId = setTimeout(() => {
      if (state.recorder && state.recorder.state === "recording") {
        stopRecording();
        setStatus(`Recording auto-stopped at ${MAX_RECORDING_SECONDS}s.`);
      }
    }, MAX_RECORDING_SECONDS * 1000);
    setRecordingIndicator(true);
    startRecordBtn.disabled = true;
    stopRecordBtn.disabled = false;
    setStatus("Recording... bring the heehee energy!");
  } catch (error) {
    console.error(error);
    setRecordingIndicator(false);
    setStatus("Could not start recording. Please allow microphone access.");
  }
}

function stopRecording() {
  if (!state.recorder || state.recorder.state !== "recording") {
    return;
  }

  state.recorder.stop();
  clearRecordingTimeout();
  clearRecordingCountdown();
  setRecordingIndicator(false);

  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }

  startRecordBtn.disabled = false;
  stopRecordBtn.disabled = true;
}

function playRecording() {
  if (!state.userBlob) {
    return;
  }
  recordedAudio.play();
}

function clearRecording() {
  resetRecording();
  setStatus("Your HeeHee was cleared. Record a fresh one.");
}

async function analyzeHeeHee() {
  if (!state.userBlob) {
    setStatus("Record your heehee first.");
    return;
  }
  if (Number.isFinite(state.recordedDurationSec) && state.recordedDurationSec > MAX_RECORDING_SECONDS + 0.2) {
    setStatus(`Recording is too long. Please keep it under ${MAX_RECORDING_SECONDS}s.`);
    return;
  }

  setStatus("Analyzing your performance...");

  try {
    let score = null;
    let usedServerScore = false;

    try {
      score = await requestServerScore(state.userBlob);
      usedServerScore = true;
    } catch (serverError) {
      console.warn("Server analysis unavailable, using local fallback:", serverError);

      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      const referenceBuffer = await loadReferenceBuffer();
      const userBuffer = await decodeBlobToAudioBuffer(state.userBlob);
      score = compareAudio(referenceBuffer, userBuffer);
    }

    state.lastScore = score;
    // New analysis invalidates previously saved ranking context until user saves again.
    state.lastSavedRank = null;
    state.lastSavedName = "";
    state.lastSavedScore = null;
    updateResultActions();
    showResult(score);
    setStatus(
      usedServerScore
        ? `Done. Your HeeHee score is ${score}%`
        : `Done. Local estimate: ${score}%`
    );
  } catch (error) {
    console.error(error);
    setStatus(`Analysis failed: ${error.message}`);
  }
}

async function requestServerScore(audioBlob) {
  const formData = new FormData();
  formData.append("audio", audioBlob, "heehee.webm");

  const response = await fetchWithTimeout(API_ENDPOINTS.analyzeScore, {
    method: "POST",
    body: formData,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Could not analyze score on server.");
  }
  if (!Number.isFinite(payload.score)) {
    throw new Error("Server returned an invalid score.");
  }

  return Math.round(payload.score);
}

async function loadReferenceBuffer() {
  const response = await fetch(encodeURI(REFERENCE_AUDIO_PATH));
  if (!response.ok) {
    throw new Error(`Reference file not found: ${REFERENCE_AUDIO_PATH}`);
  }

  return decodeArrayBufferToAudioBuffer(await response.arrayBuffer());
}

async function decodeBlobToAudioBuffer(blob) {
  return decodeArrayBufferToAudioBuffer(await blob.arrayBuffer());
}

async function decodeArrayBufferToAudioBuffer(arrayBuffer) {
  const copy = arrayBuffer.slice(0);
  return audioCtx.decodeAudioData(copy);
}

function compareAudio(referenceBuffer, userBuffer) {
  const refSamples = trimSilence(toMono(referenceBuffer));
  const userSamples = trimSilence(toMono(userBuffer));

  const durationScore = getDurationScore(refSamples.length / referenceBuffer.sampleRate, userSamples.length / userBuffer.sampleRate);

  const refEnvelope = getRmsEnvelope(refSamples);
  const userEnvelope = getRmsEnvelope(userSamples);
  const envelopeScore = getCorrelationScore(refEnvelope, userEnvelope);

  const refPitch = getPitchContour(refSamples, referenceBuffer.sampleRate);
  const userPitch = getPitchContour(userSamples, userBuffer.sampleRate);
  const pitchScore = getPitchScore(refPitch, userPitch);

  const structureResult = getSyllableStructureScore(
    refSamples,
    userSamples,
    referenceBuffer.sampleRate,
    userBuffer.sampleRate
  );
  const structureScore = structureResult.score;

  const baseScore = clamp(
    0.2 * durationScore +
    0.3 * envelopeScore +
    0.2 * pitchScore +
    0.3 * structureScore,
    0,
    1
  );

  const guardedScore = applyMismatchGuard(baseScore, {
    durationScore,
    envelopeScore,
    pitchScore,
    structureScore,
    refPeakCount: structureResult.refPeakCount,
    userPeakCount: structureResult.userPeakCount,
  });

  return Math.round(guardedScore * 100);
}

function toMono(buffer) {
  const output = new Float32Array(buffer.length);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < buffer.length; i += 1) {
      output[i] += data[i] / buffer.numberOfChannels;
    }
  }

  return output;
}

function trimSilence(samples, threshold = 0.02) {
  let start = 0;
  while (start < samples.length && Math.abs(samples[start]) < threshold) {
    start += 1;
  }

  let end = samples.length - 1;
  while (end > start && Math.abs(samples[end]) < threshold) {
    end -= 1;
  }

  if (start >= end) {
    return samples;
  }

  return samples.slice(start, end + 1);
}

function getDurationScore(refDuration, userDuration) {
  if (refDuration <= 0 || userDuration <= 0) {
    return 0;
  }

  const ratio = Math.min(refDuration, userDuration) / Math.max(refDuration, userDuration);
  return clamp(ratio, 0, 1);
}

function getRmsEnvelope(samples, frameSize = 1024, hop = 256) {
  if (samples.length < frameSize) {
    return [0];
  }

  const envelope = [];
  for (let start = 0; start + frameSize <= samples.length; start += hop) {
    let sum = 0;
    for (let i = start; i < start + frameSize; i += 1) {
      const x = samples[i];
      sum += x * x;
    }
    envelope.push(Math.sqrt(sum / frameSize));
  }

  return normalize(envelope);
}

function normalize(values) {
  const max = Math.max(...values);
  if (!Number.isFinite(max) || max === 0) {
    return values.map(() => 0);
  }
  return values.map((value) => value / max);
}

function getCorrelationScore(a, b) {
  if (a.length < 2 || b.length < 2) {
    return 0;
  }

  const target = Math.min(80, Math.max(a.length, b.length));
  const a2 = resampleArray(a, target);
  const b2 = resampleArray(b, target);
  const corr = pearsonCorrelation(a2, b2);
  return clamp((corr + 1) / 2, 0, 1);
}

function getPitchContour(samples, sampleRate, frameSize = 2048, hop = 512) {
  if (samples.length < frameSize) {
    return [];
  }

  const contour = [];
  for (let start = 0; start + frameSize <= samples.length; start += hop) {
    const frame = samples.slice(start, start + frameSize);
    if (getRms(frame) < 0.01) {
      continue;
    }

    const pitch = autoCorrelatePitch(frame, sampleRate);
    if (pitch) {
      contour.push(Math.log2(pitch));
    }
  }

  return contour;
}

function getPitchScore(referenceContour, userContour) {
  if (referenceContour.length < 2 || userContour.length < 2) {
    return 0.5;
  }

  const target = Math.min(60, Math.max(referenceContour.length, userContour.length));
  const ref = resampleArray(referenceContour, target);
  const user = resampleArray(userContour, target);
  const corr = pearsonCorrelation(ref, user);
  return clamp((corr + 1) / 2, 0, 1);
}

function getSyllableStructureScore(refSamples, userSamples, refSampleRate, userSampleRate) {
  const refPeakFrames = detectSyllablePeaks(refSamples, refSampleRate);
  const userPeakFrames = detectSyllablePeaks(userSamples, userSampleRate);

  const refPeakCount = refPeakFrames.length;
  const userPeakCount = userPeakFrames.length;

  const countScore = clamp(
    1 - Math.abs(userPeakCount - refPeakCount) / Math.max(2, refPeakCount),
    0,
    1
  );

  const refGapSeconds = getPrimaryPeakGapSeconds(refPeakFrames, refSampleRate);
  const userGapSeconds = getPrimaryPeakGapSeconds(userPeakFrames, userSampleRate);

  let gapScore = 0.5;
  if (refGapSeconds && userGapSeconds) {
    gapScore = clamp(
      Math.min(refGapSeconds, userGapSeconds) / Math.max(refGapSeconds, userGapSeconds),
      0,
      1
    );
  } else if (!refGapSeconds && !userGapSeconds) {
    gapScore = 1;
  } else {
    gapScore = 0;
  }

  return {
    score: clamp(0.65 * countScore + 0.35 * gapScore, 0, 1),
    refPeakCount,
    userPeakCount,
  };
}

function detectSyllablePeaks(samples, sampleRate, frameSize = 512, hop = 128) {
  const envelope = getRmsEnvelope(samples, frameSize, hop);
  if (envelope.length < 3) {
    return [];
  }

  const smooth = smoothMovingAverage(envelope, 5);
  const mean = smooth.reduce((sum, value) => sum + value, 0) / smooth.length;
  const threshold = clamp(mean + 0.12, 0.22, 0.78);
  const minGapFrames = Math.max(1, Math.round(0.12 / (hop / sampleRate)));
  const peaks = [];

  for (let i = 2; i < smooth.length - 2; i += 1) {
    const value = smooth[i];
    if (value < threshold) {
      continue;
    }

    const left = Math.max(smooth[i - 1], smooth[i - 2]);
    const right = Math.max(smooth[i + 1], smooth[i + 2]);
    const isLocalMax = value >= left && value >= right;
    if (!isLocalMax) {
      continue;
    }

    if (peaks.length === 0) {
      peaks.push(i);
      continue;
    }

    const last = peaks[peaks.length - 1];
    if (i - last >= minGapFrames) {
      peaks.push(i);
    } else if (value > smooth[last]) {
      peaks[peaks.length - 1] = i;
    }
  }

  return peaks;
}

function getPrimaryPeakGapSeconds(peakFrames, sampleRate, hop = 128) {
  if (peakFrames.length < 2) {
    return null;
  }
  return ((peakFrames[1] - peakFrames[0]) * hop) / sampleRate;
}

function smoothMovingAverage(values, windowSize) {
  if (windowSize <= 1 || values.length < 2) {
    return values.slice();
  }

  const radius = Math.floor(windowSize / 2);
  const output = [];

  for (let i = 0; i < values.length; i += 1) {
    let sum = 0;
    let count = 0;
    for (let k = -radius; k <= radius; k += 1) {
      const index = i + k;
      if (index < 0 || index >= values.length) {
        continue;
      }
      sum += values[index];
      count += 1;
    }
    output.push(count > 0 ? sum / count : values[i]);
  }

  return output;
}

function applyMismatchGuard(baseScore, metrics) {
  const {
    durationScore,
    envelopeScore,
    pitchScore,
    structureScore,
    refPeakCount,
    userPeakCount,
  } = metrics;

  let mismatchCount = 0;

  if (envelopeScore < MISMATCH_GUARD.weakEnvelope) {
    mismatchCount += 1;
  }
  if (pitchScore < MISMATCH_GUARD.weakPitch) {
    mismatchCount += 1;
  }
  if (structureScore < MISMATCH_GUARD.weakStructure) {
    mismatchCount += 1;
  }
  if (durationScore < MISMATCH_GUARD.weakDuration) {
    mismatchCount += 1;
  }
  if (Math.abs(userPeakCount - refPeakCount) >= 2) {
    mismatchCount += 1;
  }

  if (mismatchCount >= 2) {
    return Math.min(baseScore, MISMATCH_GUARD.maxMismatchScore);
  }
  return baseScore;
}

function getRms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const x = samples[i];
    sum += x * x;
  }
  return Math.sqrt(sum / samples.length);
}

function autoCorrelatePitch(frame, sampleRate, minHz = 120, maxHz = 1200) {
  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.floor(sampleRate / minHz);

  let bestLag = -1;
  let bestCorr = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let corr = 0;
    for (let i = 0; i + lag < frame.length; i += 1) {
      corr += frame[i] * frame[i + lag];
    }

    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (bestLag <= 0 || bestCorr <= 0) {
    return null;
  }

  const pitch = sampleRate / bestLag;
  if (!Number.isFinite(pitch) || pitch < minHz || pitch > maxHz) {
    return null;
  }

  return pitch;
}

function resampleArray(values, targetLength) {
  if (values.length === targetLength) {
    return values.slice();
  }

  if (targetLength <= 1) {
    return [values[0] ?? 0];
  }

  const output = [];
  const scale = (values.length - 1) / (targetLength - 1);

  for (let i = 0; i < targetLength; i += 1) {
    const index = i * scale;
    const left = Math.floor(index);
    const right = Math.min(values.length - 1, left + 1);
    const mix = index - left;
    output.push(values[left] * (1 - mix) + values[right] * mix);
  }

  return output;
}

function pearsonCorrelation(a, b) {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  const meanA = a.reduce((sum, x) => sum + x, 0) / a.length;
  const meanB = b.reduce((sum, x) => sum + x, 0) / b.length;

  let num = 0;
  let denA = 0;
  let denB = 0;

  for (let i = 0; i < a.length; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }

  if (denA === 0 || denB === 0) {
    return 0;
  }

  return num / Math.sqrt(denA * denB);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function showResult(score) {
  const band = getResultBand(score);
  const imagePath = RESULT_IMAGE_BY_BAND[band];
  const captionText = RESULT_TEXT_BY_BAND[band] || "Placeholder: Result caption.";
  mjImage.src = encodeURI(imagePath);
  mjImage.style.display = "block";
  mjImage.alt = `Michael Jackson score tier for ${score}%`;
  resultCaptionEl.textContent = captionText;
  scoreText.textContent = `${score}%`;
  resultModal.classList.remove("hidden");
}

function showLastResult() {
  if (state.lastScore === null) {
    return;
  }
  showResult(state.lastScore);
}

async function saveLatestScore() {
  if (state.isBusy) {
    return;
  }

  if (!state.userBlob) {
    setStatus("Record and analyze your heehee before saving.");
    return;
  }
  if (Number.isFinite(state.recordedDurationSec) && state.recordedDurationSec > MAX_RECORDING_SECONDS + 0.2) {
    setStatus(`Recording is too long. Please keep it under ${MAX_RECORDING_SECONDS}s.`);
    return;
  }

  let name = playerNameInput.value.trim();
  if (!name) {
    const prompted = window.prompt("Enter your name for the leaderboard:");
    name = prompted ? prompted.trim() : "";
  }

  if (!name) {
    setStatus("Name is required to save score.");
    return;
  }

  if (name.length > MAX_NAME_LENGTH) {
    setStatus(`Name must be ${MAX_NAME_LENGTH} characters or fewer.`);
    return;
  }

  const cleanName = name.slice(0, MAX_NAME_LENGTH);
  const formData = new FormData();
  formData.append("name", cleanName);
  formData.append("audio", state.userBlob, "heehee.webm");

  setBusyState(true, "Saving score...");
  setStatus("Saving score to leaderboard...");
  try {
    const response = await fetchWithTimeout(API_ENDPOINTS.submitScore, {
      method: "POST",
      body: formData,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload.error || "Could not save score.";
      setStatus(message);
      return;
    }

    const entry = payload.entry || null;
    const rank = Number(payload.rank);
    const leaderboard = Array.isArray(payload.leaderboard) ? payload.leaderboard : [];
    if (entry && Number.isFinite(entry.score)) {
      state.lastScore = Math.round(entry.score);
      updateResultActions();
      state.lastSavedScore = Math.round(entry.score);
    } else {
      state.lastSavedScore = Number.isFinite(state.lastScore) ? state.lastScore : null;
    }
    state.lastSavedRank = Number.isFinite(rank) ? rank : null;
    state.lastSavedName = entry && typeof entry.name === "string" ? entry.name : cleanName;

    state.leaderboardEntries = leaderboard.slice(0, LEADERBOARD_MAX_SIZE);
    renderLeaderboard(state.leaderboardEntries);
    playerNameInput.value = "";
    setStatus(`Saved ${cleanName} with ${state.lastScore}% to leaderboard.`);
    if (leaderboardModal) {
      leaderboardModal.classList.remove("hidden");
      renderLeaderboard();
    }
  } catch (error) {
    console.error(error);
    setStatus("Could not reach leaderboard server. Is backend running?");
  } finally {
    setBusyState(false);
  }
}

async function loadLeaderboardFromServer() {
  try {
    const response = await fetchWithTimeout(API_ENDPOINTS.leaderboard);
    if (!response.ok) {
      return false;
    }
    const payload = await response.json().catch(() => ({}));
    if (Array.isArray(payload.leaderboard)) {
      state.leaderboardEntries = payload.leaderboard.slice(0, LEADERBOARD_MAX_SIZE);
      renderLeaderboard(state.leaderboardEntries);
      return true;
    }
    return false;
  } catch (error) {
    console.warn("Leaderboard fetch failed:", error);
    return false;
  }
}

function renderLeaderboard(entries = state.leaderboardEntries) {
  if (!leaderboardList) {
    return;
  }
  leaderboardList.innerHTML = "";

  if (entries.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No saved performers yet.";
    empty.className = "leaderboard-empty";
    leaderboardList.appendChild(empty);
    return;
  }

  entries.slice(0, LEADERBOARD_MAX_SIZE).forEach((entry, index) => {
    const item = document.createElement("li");
    item.className = "leaderboard-row";
    if (index === 0) {
      item.classList.add("top-1");
    } else if (index === 1) {
      item.classList.add("top-2");
    } else if (index === 2) {
      item.classList.add("top-3");
    }

    if (index < 3) {
      const image = document.createElement("img");
      image.className = "rank-avatar";
      image.src = TOP_RANK_IMAGE_PATHS[index] || TOP_RANK_IMAGE_FALLBACK;
      image.alt = `Top ${index + 1} placeholder`;
      image.addEventListener("error", () => {
        image.src = TOP_RANK_IMAGE_FALLBACK;
      });
      item.appendChild(image);
    }

    const rank = document.createElement("span");
    rank.className = "rank-number";
    rank.textContent = `#${index + 1}`;

    const name = document.createElement("span");
    name.className = "rank-name";
    name.textContent = entry.name;

    const score = document.createElement("span");
    score.className = "rank-score";
    score.textContent = `${entry.score}%`;

    item.appendChild(rank);
    item.appendChild(name);
    item.appendChild(score);
    leaderboardList.appendChild(item);
  });

  const savedEntryInTop = entries.some((entry) => {
    if (!entry || typeof entry.name !== "string" || !Number.isFinite(entry.score)) {
      return false;
    }
    return entry.name === state.lastSavedName && Math.round(entry.score) === Math.round(state.lastSavedScore);
  });

  const shouldShowSavedRankRow =
    !savedEntryInTop &&
    Number.isFinite(state.lastSavedRank) &&
    state.lastSavedRank > LEADERBOARD_MAX_SIZE &&
    Number.isFinite(state.lastSavedScore) &&
    typeof state.lastSavedName === "string" &&
    state.lastSavedName.length > 0;

  if (shouldShowSavedRankRow) {
    const yourRankRow = document.createElement("li");
    yourRankRow.className = "leaderboard-row your-rank-row";

    const rank = document.createElement("span");
    rank.className = "rank-number";
    rank.textContent = `#${state.lastSavedRank}`;

    const name = document.createElement("span");
    name.className = "rank-name";
    name.textContent = `${state.lastSavedName}`;

    const score = document.createElement("span");
    score.className = "rank-score";
    score.textContent = `${state.lastSavedScore}%`;

    yourRankRow.appendChild(rank);
    yourRankRow.appendChild(name);
    yourRankRow.appendChild(score);
    leaderboardList.appendChild(yourRankRow);
  }
}

function getResultBand(score) {
  if (score >= 95) {
    return "elite";
  }
  if (score >= 90) {
    return "amazing";
  }
  if (score >= 80) {
    return "great";
  }
  if (score >= 70) {
    return "good";
  }
  if (score >= 60) {
    return "decent";
  }
  if (score >= 50) {
    return "rough";
  }
  return "needsWork";
}

function closeModal() {
  resultModal.classList.add("hidden");
}

async function showLeaderboardModal() {
  if (state.isBusy) {
    return;
  }

  if (!leaderboardModal) {
    setStatus("Leaderboard UI is missing from page.");
    return;
  }

  setBusyState(true, "Loading rankings...");
  leaderboardModal.classList.remove("hidden");
  renderLeaderboard();
  if (state.leaderboardEntries.length === 0) {
    leaderboardList.innerHTML = "<li class=\"leaderboard-empty\">Loading leaderboard...</li>";
  }

  try {
    const loaded = await loadLeaderboardFromServer();
    if (!loaded && state.leaderboardEntries.length === 0) {
      leaderboardList.innerHTML = "<li class=\"leaderboard-empty\">Could not load leaderboard.</li>";
    } else {
      renderLeaderboard();
    }
  } finally {
    setBusyState(false);
  }
}

function closeLeaderboardModal() {
  leaderboardModal.classList.add("hidden");
}

function updateResultActions() {
  const hasScore = state.lastScore !== null;
  showResultBtn.disabled = !hasScore;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function setRecordingIndicator(isRecording) {
  recordingIndicator.classList.toggle("active", isRecording);
}

function setBusyState(isBusy, text = "Working...") {
  state.isBusy = isBusy;
  if (actionStatusEl && actionStatusTextEl) {
    if (isBusy) {
      actionStatusTextEl.textContent = text;
      actionStatusEl.classList.remove("hidden");
    } else {
      actionStatusEl.classList.add("hidden");
    }
  }

  saveScoreBtn.disabled = isBusy;
  showLeaderboardBtn.disabled = isBusy;
}

function resetRecording() {
  setRecordingIndicator(false);
  clearRecordingTimeout();
  if (state.userUrl) {
    URL.revokeObjectURL(state.userUrl);
  }
  recordedAudio.pause();
  recordedAudio.removeAttribute("src");
  recordedAudio.load();
  state.userBlob = null;
  state.userUrl = null;
  state.chunks = [];
  state.recordingStartedAtMs = null;
  state.recordedDurationSec = null;
  playRecordBtn.disabled = true;
  clearRecordBtn.disabled = true;
  analyzeBtn.disabled = true;
  updateResultActions();
}

function clearRecordingTimeout() {
  if (state.recordingTimeoutId) {
    clearTimeout(state.recordingTimeoutId);
    state.recordingTimeoutId = null;
  }
}

function startRecordingCountdown() {
  clearRecordingCountdown();
  updateRecordingCountdownText();
  state.recordingCountdownIntervalId = setInterval(updateRecordingCountdownText, 1000);
}

function clearRecordingCountdown() {
  if (state.recordingCountdownIntervalId) {
    clearInterval(state.recordingCountdownIntervalId);
    state.recordingCountdownIntervalId = null;
  }
  if (recordingCountdownEl) {
    recordingCountdownEl.textContent = "";
  }
}

function updateRecordingCountdownText() {
  if (!recordingCountdownEl || !state.recordingStartedAtMs) {
    return;
  }
  const elapsedMs = Date.now() - state.recordingStartedAtMs;
  const remaining = Math.max(0, Math.ceil(MAX_RECORDING_SECONDS - elapsedMs / 1000));
  recordingCountdownEl.textContent = `(${remaining}s left)`;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const merged = { ...options, signal: controller.signal };
    return await fetch(url, merged);
  } finally {
    clearTimeout(timer);
  }
}
