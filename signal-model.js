export const DEFAULTS = Object.freeze({
  beta: 0.36,
  lag: 0.18,
  bpm: 72,
  dominantHz: 10,
  commonNoise: 0,
  seed: 1,
});

const EEG_COMPONENTS = [
  { hz: 3.5, amplitude: 0.15, phase: 0.22 },
  { hz: 6.2, amplitude: 0.22, phase: 1.15 },
  { hz: 20, amplitude: 0.11, phase: 2.05 },
];

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function seededRandom(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random) {
  // Sum-of-uniforms normal approximation; deterministic and dependency-free.
  let total = 0;
  for (let index = 0; index < 6; index += 1) total += random();
  return (total - 3) * Math.sqrt(2);
}

function wrappedPhaseDistance(phase, center) {
  const distance = ((phase - center + 1.5) % 1 + 1) % 1 - 0.5;
  return distance;
}

function phaseGaussian(phase, center, width) {
  const distance = wrappedPhaseDistance(phase, center) / width;
  return Math.exp(-0.5 * distance * distance);
}

export function beatTimesFor(t, bpm) {
  const period = 60 / bpm;
  const firstBeat = 0.5;
  const lastIndex = Math.floor((t - firstBeat) / period);
  if (lastIndex < 0) return [];
  return Array.from({ length: lastIndex + 1 }, (_, index) => firstBeat + index * period);
}

export function syntheticEcgAt(t, bpm = DEFAULTS.bpm) {
  const phase = (((t - 0.5) * bpm) / 60 % 1 + 1) % 1;
  // A schematic ECG-like P-QRS-T morphology; values have arbitrary units.
  return (
    0.13 * phaseGaussian(phase, 0.205, 0.035) -
    0.14 * phaseGaussian(phase, 0.965, 0.012) +
    1.2 * phaseGaussian(phase, 0, 0.013) -
    0.29 * phaseGaussian(phase, 0.035, 0.016) +
    0.31 * phaseGaussian(phase, 0.29, 0.065)
  );
}

export function syntheticEegBaseAt(t, dominantHz = DEFAULTS.dominantHz) {
  let value = 0.52 * Math.sin(2 * Math.PI * dominantHz * t + 0.48);
  for (const component of EEG_COMPONENTS) {
    value += component.amplitude * Math.sin(2 * Math.PI * component.hz * t + component.phase);
  }
  return value;
}

function sharedClockNoise(t, seed) {
  const phase = ((seed >>> 0) % 997) / 997 * 2 * Math.PI;
  return 0.62 * Math.sin(2 * Math.PI * 0.73 * t + phase) +
    0.38 * Math.sin(2 * Math.PI * 1.31 * t + phase * 0.63);
}

function eventTemplate(t, beatTimes, lag) {
  let value = 0;
  for (const beatTime of beatTimes) {
    const elapsed = t - beatTime - lag;
    if (elapsed < -0.12 || elapsed > 0.42) continue;
    const positive = Math.exp(-0.5 * ((elapsed - 0.09) / 0.043) ** 2);
    const rebound = Math.exp(-0.5 * ((elapsed - 0.235) / 0.075) ** 2);
    value += positive - 0.28 * rebound;
  }
  return value;
}

export function syntheticEegAt(t, options = {}, beats = beatTimesFor(t, options.bpm ?? DEFAULTS.bpm)) {
  const beta = clamp(options.beta ?? DEFAULTS.beta, 0, 1);
  const lag = options.lag ?? DEFAULTS.lag;
  const bpm = options.bpm ?? DEFAULTS.bpm;
  const dominantHz = options.dominantHz ?? DEFAULTS.dominantHz;
  const commonNoise = clamp(options.commonNoise ?? 0, 0, 1);
  const seed = options.seed ?? DEFAULTS.seed;
  // β injects a deliberately synthetic beat-locked component into the EEG stream.
  // β=0 removes that component exactly; this is a simulation parameter, not physiology.
  return syntheticEegBaseAt(t, dominantHz) +
    beta * eventTemplate(t, beats, lag) +
    commonNoise * 0.18 * sharedClockNoise(t, seed);
}

export function syntheticEegFeatureAt(t, options = {}, beats = beatTimesFor(t, options.bpm ?? DEFAULTS.bpm)) {
  // A slow, smoothed absolute-amplitude feature computed from the synthetic EEG samples.
  const windowSeconds = options.featureWindowSeconds ?? 1.4;
  const sampleCount = options.featureSampleCount ?? 36;
  let total = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const fraction = index / Math.max(1, sampleCount - 1);
    const sampleTime = t - windowSeconds + fraction * windowSeconds;
    total += Math.abs(syntheticEegAt(sampleTime, options, beats));
  }
  const meanAbsoluteAmplitude = total / sampleCount;
  return clamp((meanAbsoluteAmplitude - 0.12) / 0.40, 0, 1);
}

export function syntheticEcgStreamAt(t, options = {}) {
  const bpm = options.bpm ?? DEFAULTS.bpm;
  const commonNoise = clamp(options.commonNoise ?? 0, 0, 1);
  const seed = options.seed ?? DEFAULTS.seed;
  // This separate stream is a synthetic ECG-like electrical trace, not PPG.
  return syntheticEcgAt(t, bpm) + commonNoise * 0.12 * sharedClockNoise(t, seed);
}

export function simulatePair(options = {}) {
  const settings = {
    duration: options.duration ?? 16,
    sampleRate: options.sampleRate ?? 80,
    beta: clamp(options.beta ?? DEFAULTS.beta, 0, 1),
    lag: options.lag ?? DEFAULTS.lag,
    bpm: options.bpm ?? DEFAULTS.bpm,
    dominantHz: options.dominantHz ?? DEFAULTS.dominantHz,
    commonNoise: clamp(options.commonNoise ?? 0, 0, 1),
    noise: clamp(options.noise ?? 0, 0, 2),
    jitterMs: clamp(options.jitterMs ?? 0, 0, 150),
    dropRate: clamp(options.dropRate ?? 0, 0, 0.8),
    eegClockOffsetMs: options.eegClockOffsetMs ?? 0,
    ecgClockOffsetMs: options.ecgClockOffsetMs ?? 0,
    seed: options.seed ?? DEFAULTS.seed,
  };
  const eegRandom = seededRandom(settings.seed ^ 0x13579bdf);
  const ecgRandom = seededRandom(settings.seed ^ 0x2468ace0);
  const beatTimes = beatTimesFor(settings.duration, settings.bpm);
  const eeg = [];
  const ecg = [];
  const count = Math.floor(settings.duration * settings.sampleRate);
  const jitter = settings.jitterMs / 1000;

  for (let index = 0; index < count; index += 1) {
    const trueTime = index / settings.sampleRate;
    if (eegRandom() >= settings.dropRate) {
      const timestampJitter = (eegRandom() * 2 - 1) * jitter;
      eeg.push({
        time: trueTime + settings.eegClockOffsetMs / 1000 + timestampJitter,
        value: syntheticEegAt(trueTime, settings, beatTimes) + settings.noise * gaussian(eegRandom),
        index,
      });
    }
    if (ecgRandom() >= settings.dropRate) {
      const timestampJitter = (ecgRandom() * 2 - 1) * jitter;
      ecg.push({
        time: trueTime + settings.ecgClockOffsetMs / 1000 + timestampJitter,
        value: syntheticEcgStreamAt(trueTime, settings) + settings.noise * 0.55 * gaussian(ecgRandom),
        index,
      });
    }
  }

  return {
    eeg,
    ecg,
    truth: {
      beatTimes: beatTimes.filter((time) => time < settings.duration),
      beta: settings.beta,
      lag: settings.lag,
      eegClockOffsetMs: settings.eegClockOffsetMs,
      ecgClockOffsetMs: settings.ecgClockOffsetMs,
      settings,
    },
  };
}

export function detectRPeaks(ecgSamples, { clockOffsetMs = 0, threshold = 0.68, refractorySeconds = 0.45, sampleRate = 80 } = {}) {
  const offset = clockOffsetMs / 1000;
  const indexSteps = [];
  for (let index = 1; index < ecgSamples.length; index += 1) {
    const difference = (ecgSamples[index].index ?? index) - (ecgSamples[index - 1].index ?? index - 1);
    if (difference > 0) indexSteps.push(difference);
  }
  indexSteps.sort((left, right) => left - right);
  const medianStep = indexSteps[Math.floor(indexSteps.length / 2)] || 1;
  const refractorySamples = refractorySeconds * sampleRate / medianStep;
  const candidates = [];
  for (let index = 1; index < ecgSamples.length - 1; index += 1) {
    const before = ecgSamples[index - 1].value;
    const current = ecgSamples[index].value;
    const after = ecgSamples[index + 1].value;
    if (current < threshold || current <= before || current < after) continue;
    candidates.push({
      index: ecgSamples[index].index ?? index,
      time: ecgSamples[index].time - offset,
      value: current,
    });
  }
  const groups = [];
  for (const candidate of candidates) {
    const currentGroup = groups.at(-1);
    if (currentGroup && candidate.index - currentGroup.firstIndex < refractorySamples) {
      if (candidate.value > currentGroup.best.value) currentGroup.best = candidate;
    } else {
      groups.push({ firstIndex: candidate.index, best: candidate });
    }
  }
  return groups.map((group) => group.best.time);
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-10) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let item = column; item <= size; item += 1) rows[column][item] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let item = column; item <= size; item += 1) rows[row][item] -= factor * rows[column][item];
    }
  }
  return rows.map((row) => row[size]);
}

function fitLeastSquares(columns, values) {
  const size = columns.length;
  const matrix = Array.from({ length: size }, () => Array(size).fill(0));
  const vector = Array(size).fill(0);
  for (let row = 0; row < values.length; row += 1) {
    for (let left = 0; left < size; left += 1) {
      vector[left] += columns[left][row] * values[row];
      for (let right = 0; right < size; right += 1) matrix[left][right] += columns[left][row] * columns[right][row];
    }
  }
  const coefficients = solveLinearSystem(matrix, vector);
  if (!coefficients) return { coefficients: Array(size).fill(0), error: Infinity };
  let error = 0;
  for (let row = 0; row < values.length; row += 1) {
    let predicted = 0;
    for (let column = 0; column < size; column += 1) predicted += columns[column][row] * coefficients[column];
    error += (values[row] - predicted) ** 2;
  }
  return { coefficients, error };
}

export function fitBetaLag(eegSamples, beatTimes, options = {}) {
  const clockOffsetMs = options.clockOffsetMs ?? 0;
  const dominantHz = options.dominantHz ?? DEFAULTS.dominantHz;
  const minLag = options.minLag ?? -0.05;
  const maxLag = options.maxLag ?? 0.40;
  const lagStep = options.lagStep ?? 0.01;
  const samples = eegSamples.map((sample) => ({
    time: sample.time - clockOffsetMs / 1000,
    value: sample.value,
  }));
  if (samples.length < 30 || beatTimes.length < 3) {
    return { beta: 0, lag: null, fitError: Infinity, sampleCount: samples.length };
  }

  const centerTime = (samples[0].time + samples[samples.length - 1].time) / 2;
  const centeredTimes = samples.map((sample) => sample.time - centerTime);
  const baseColumns = [
    Array(samples.length).fill(1),
    centeredTimes,
  ];
  for (const hz of new Set([3.5, 6.2, dominantHz, 20])) {
    baseColumns.push(samples.map((sample) => Math.sin(2 * Math.PI * hz * sample.time)));
    baseColumns.push(samples.map((sample) => Math.cos(2 * Math.PI * hz * sample.time)));
  }

  let best = { error: Infinity, beta: 0, lag: null };
  const candidateCount = Math.floor((maxLag - minLag) / lagStep + 0.5);
  for (let candidate = 0; candidate <= candidateCount; candidate += 1) {
    const lag = minLag + candidate * lagStep;
    const template = samples.map((sample) => eventTemplate(sample.time, beatTimes, lag));
    const fit = fitLeastSquares([...baseColumns, template], samples.map((sample) => sample.value));
    if (fit.error < best.error) {
      best = { error: fit.error, beta: fit.coefficients.at(-1), lag };
    }
  }
  const beta = Math.abs(best.beta) < 0.035 ? 0 : best.beta;
  return {
    beta,
    lag: beta === 0 ? null : best.lag,
    fitError: best.error,
    sampleCount: samples.length,
  };
}

export function meanAbsoluteError(estimated, truth) {
  if (!estimated.length || !truth.length) return Infinity;
  return matchTimes(estimated, truth).meanAbsoluteError;
}

export function matchTimes(estimated, truth, toleranceSeconds = 0.25) {
  const available = new Set(truth.map((_, index) => index));
  const errors = [];
  for (const estimate of estimated) {
    let closestIndex = -1;
    let closestError = Infinity;
    for (const index of available) {
      const error = Math.abs(estimate - truth[index]);
      if (error < closestError) {
        closestError = error;
        closestIndex = index;
      }
    }
    if (closestIndex >= 0 && closestError <= toleranceSeconds) {
      errors.push(closestError);
      available.delete(closestIndex);
    }
  }
  return {
    meanAbsoluteError: errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : Infinity,
    matched: errors.length,
    estimatedCount: estimated.length,
    truthCount: truth.length,
  };
}
