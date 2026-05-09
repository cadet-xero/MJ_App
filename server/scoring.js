function compareAudio(referenceSamples, userSamples, sampleRate = 16000) {
  const ref = trimSilence(referenceSamples);
  const user = trimSilence(userSamples);
  const activity = getActivityMetrics(user);
  if (activity.hardSilence) {
    return 0;
  }

  const durationScore = getDurationScore(ref.length / sampleRate, user.length / sampleRate);
  const refEnvelope = getRmsEnvelope(ref);
  const userEnvelope = getRmsEnvelope(user);
  const envelopeScore = getCorrelationScore(refEnvelope, userEnvelope);

  const refPitch = getPitchContour(ref, sampleRate);
  const userPitch = getPitchContour(user, sampleRate);
  const pitchScore = getPitchScore(refPitch, userPitch);

  const structureResult = getSyllableStructureScore(ref, user, sampleRate, sampleRate);
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

  let finalScore = guardedScore;
  if (activity.activityWeight < 0.25) {
    finalScore = Math.min(finalScore, 0.25);
  } else if (activity.activityWeight < 0.4) {
    finalScore = Math.min(finalScore, 0.45);
  }

  return Math.round(finalScore * 100);
}

const MISMATCH_GUARD = {
  maxMismatchScore: 0.49,
  weakEnvelope: 0.42,
  weakPitch: 0.38,
  weakStructure: 0.45,
  weakDuration: 0.55,
};

function trimSilence(samples, threshold = 0.02) {
  let start = 0;
  while (start < samples.length && Math.abs(samples[start]) < threshold) {
    start += 1;
  }
  let end = samples.length - 1;
  while (end > start && Math.abs(samples[end]) < threshold) {
    end -= 1;
  }
  return start >= end ? samples : samples.slice(start, end + 1);
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
  if (corr === null) {
    return 0;
  }
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
    return 0;
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
    if (!(value >= left && value >= right)) {
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
  const { durationScore, envelopeScore, pitchScore, structureScore, refPeakCount, userPeakCount } = metrics;
  let mismatchCount = 0;
  if (envelopeScore < MISMATCH_GUARD.weakEnvelope) mismatchCount += 1;
  if (pitchScore < MISMATCH_GUARD.weakPitch) mismatchCount += 1;
  if (structureScore < MISMATCH_GUARD.weakStructure) mismatchCount += 1;
  if (durationScore < MISMATCH_GUARD.weakDuration) mismatchCount += 1;
  if (Math.abs(userPeakCount - refPeakCount) >= 2) mismatchCount += 1;
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

function getActivityMetrics(samples) {
  if (!samples || samples.length === 0) {
    return { hardSilence: true, activityWeight: 0 };
  }

  const rms = getRms(samples);
  let peak = 0;
  let activeCount = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) {
      peak = abs;
    }
    if (abs >= 0.015) {
      activeCount += 1;
    }
  }

  const activeRatio = activeCount / samples.length;
  const hardSilence = peak < 0.02 || rms < 0.003 || activeRatio < 0.008;

  const rmsScore = clamp(rms / 0.02, 0, 1);
  const activeScore = clamp(activeRatio / 0.12, 0, 1);
  const peakScore = clamp(peak / 0.15, 0, 1);
  const activityWeight = clamp(
    0.5 * rmsScore + 0.35 * activeScore + 0.15 * peakScore,
    0,
    1
  );

  return { hardSilence, activityWeight };
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
    return null;
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
    return null;
  }
  return num / Math.sqrt(denA * denB);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = { compareAudio };
