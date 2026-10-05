import test from "node:test";
import assert from "node:assert/strict";
import {
  detectRPeaks,
  fitBetaLag,
  simulatePair,
  syntheticEcgAt,
  syntheticEegAt,
  syntheticEegBaseAt,
  syntheticEegFeatureAt,
} from "../signal-model.js";
import { runShuffledCodeMappingControlCheck, runHeldOutBench } from "../validation.js";

function pearson(left, right) {
  const count = Math.min(left.length, right.length);
  const meanLeft = left.slice(0, count).reduce((sum, value) => sum + value, 0) / count;
  const meanRight = right.slice(0, count).reduce((sum, value) => sum + value, 0) / count;
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < count; index += 1) {
    const a = left[index] - meanLeft;
    const b = right[index] - meanRight;
    numerator += a * b;
    leftVariance += a * a;
    rightVariance += b * b;
  }
  return numerator / Math.sqrt(leftVariance * rightVariance);
}

test("β=0 is a genuine no-injected-link control", () => {
  const times = Array.from({ length: 400 }, (_, index) => index / 80);
  const beatsA = [0.5, 1.3, 2.1, 2.9, 3.7, 4.5];
  const beatsB = [0.5, 1.5, 2.5, 3.5, 4.5];
  for (const time of times) {
    const first = syntheticEegAt(time, { beta: 0, dominantHz: 10, bpm: 72 }, beatsA);
    const second = syntheticEegAt(time, { beta: 0, dominantHz: 10, bpm: 72 }, beatsB);
    assert.equal(first, second);
    assert.equal(first, syntheticEegBaseAt(time, 10));
  }
});

test("simulator returns separate EEG-like and ECG electrical streams", () => {
  const pair = simulatePair({ duration: 5, sampleRate: 80, seed: 5, beta: 0 });
  assert.notEqual(pair.eeg, pair.ecg);
  assert.notEqual(pair.eeg[40].value, pair.ecg[40].value);
  assert.ok(pair.eeg.every((sample) => Number.isFinite(sample.time) && Number.isFinite(sample.value)));
  assert.ok(pair.ecg.every((sample) => Number.isFinite(sample.time) && Number.isFinite(sample.value)));
  assert.ok(syntheticEcgAt(0.5, 72) > 0.9, "synthetic ECG has an R-like electrical peak");
});

test("shared-clock common noise can increase apparent stream correlation with β=0", () => {
  const independent = simulatePair({ duration: 24, sampleRate: 100, seed: 38, beta: 0, commonNoise: 0, noise: 0 });
  const confounded = simulatePair({ duration: 24, sampleRate: 100, seed: 38, beta: 0, commonNoise: 1, noise: 0 });
  const baseCorrelation = pearson(independent.eeg.map((sample) => sample.value), independent.ecg.map((sample) => sample.value));
  const confoundedCorrelation = pearson(confounded.eeg.map((sample) => sample.value), confounded.ecg.map((sample) => sample.value));
  assert.ok(confoundedCorrelation > baseCorrelation + 0.04, `expected shared-noise correlation to rise (${baseCorrelation.toFixed(3)} → ${confoundedCorrelation.toFixed(3)})`);
  assert.equal(confounded.truth.beta, 0, "the apparent similarity is not an injected EEG→beat link");
});

test("synthetic streams are deterministic for a fixed seed", () => {
  const options = { seed: 77, duration: 8, beta: 0.33, lag: 0.16, noise: 0.08, jitterMs: 9, dropRate: 0.1 };
  assert.deepEqual(simulatePair(options), simulatePair(options));
});

test("held-out seeds recover known β/τ and beat alignment under combined distortions", () => {
  const report = runHeldOutBench({
    seeds: [23, 41, 67, 89],
    perturbations: { timeOffsetMs: 120, jitterMs: 12, noise: 0.12, dropRate: 0.10, commonNoise: 0.05 },
  });
  assert.equal(report.heldOut, true);
  assert.deepEqual(report.seeds, [23, 41, 67, 89]);
  assert.ok(report.meanAbsoluteError.beta < 0.12, `β MAE ${report.meanAbsoluteError.beta.toFixed(3)}`);
  assert.ok(report.meanAbsoluteError.lagMs < 40, `τ MAE ${report.meanAbsoluteError.lagMs.toFixed(1)} ms`);
  assert.ok(report.meanAbsoluteError.beatAlignmentMs < 35, `beat MAE ${report.meanAbsoluteError.beatAlignmentMs.toFixed(1)} ms`);
});

for (const scenario of [
  { name: "relative clock offset", perturbations: { timeOffsetMs: 220, jitterMs: 0, noise: 0.08, dropRate: 0, commonNoise: 0 } },
  { name: "timestamp jitter", perturbations: { timeOffsetMs: 80, jitterMs: 32, noise: 0.08, dropRate: 0, commonNoise: 0 } },
  { name: "added channel noise", perturbations: { timeOffsetMs: 80, jitterMs: 4, noise: 0.32, dropRate: 0, commonNoise: 0 } },
  { name: "dropped samples", perturbations: { timeOffsetMs: 80, jitterMs: 4, noise: 0.10, dropRate: 0.30, commonNoise: 0 } },
]) {
  test(`held-out recovery remains measurable with ${scenario.name}`, () => {
    const report = runHeldOutBench({ seeds: [23, 41], perturbations: scenario.perturbations });
    assert.ok(report.meanAbsoluteError.beta < 0.24, `β MAE ${report.meanAbsoluteError.beta.toFixed(3)}`);
    assert.ok(report.meanAbsoluteError.lagMs < 90, `τ MAE ${report.meanAbsoluteError.lagMs.toFixed(1)} ms`);
    assert.ok(report.meanAbsoluteError.beatAlignmentMs < 55, `beat MAE ${report.meanAbsoluteError.beatAlignmentMs.toFixed(1)} ms`);
    assert.ok(report.perSeed.every((result) => result.detectedBeatCount > 10), "ECG beat detector retains enough events");
  });
}

test("R-peak timing is corrected by the known ECG clock offset", () => {
  const pair = simulatePair({ duration: 10, sampleRate: 100, seed: 9, eegClockOffsetMs: 40, ecgClockOffsetMs: -80, jitterMs: 0, noise: 0 });
  const aligned = detectRPeaks(pair.ecg, { clockOffsetMs: -80 });
  const uncorrected = detectRPeaks(pair.ecg);
  const alignedFit = fitBetaLag(pair.eeg, aligned, { clockOffsetMs: 40 });
  const truthFit = fitBetaLag(pair.eeg, pair.truth.beatTimes, { clockOffsetMs: 40 });
  assert.ok(Math.abs(aligned.length - pair.truth.beatTimes.length) <= 1);
  assert.ok(alignedFit.lag !== null && truthFit.lag !== null);
  assert.ok(Math.abs(alignedFit.lag - truthFit.lag) < 0.03);
  assert.ok(Math.abs(uncorrected[0] - aligned[0]) > 0.07, "uncorrected ECG timestamps retain the clock skew");
});

test("slow EEG feature is derived from the synthetic stream and evolves over time", () => {
  const options = { beta: 0.4, lag: 0.18, bpm: 72, dominantHz: 10, commonNoise: 0, seed: 7 };
  const features = Array.from({ length: 30 }, (_, index) => {
    const time = 2 + index * 0.17;
    return syntheticEegFeatureAt(time, options);
  });
  assert.ok(features.every((feature) => feature >= 0 && feature <= 1));
  assert.ok(Math.max(...features) - Math.min(...features) > 0.02, "feature changes with the synthetic EEG waveform");
});

test("shuffled-code mapping-control check distinguishes driven, time-shuffled, and zero-input conditions", () => {
  const report = runShuffledCodeMappingControlCheck({ frameCount: 180, seed: 517, fieldGain: 0.78, bpm: 72 });
  assert.match(report.note, /randomized software codes.*code\/scorer retains.*not a genuinely blinded/i);
  const byCondition = Object.fromEntries(report.arms.map((arm) => [arm.condition, arm]));
  assert.equal(report.arms.length, 3);
  assert.equal(new Set(report.arms.map((arm) => arm.code)).size, 3);
  assert.equal(byCondition["signal-driven"].mappingError, 0);
  assert.ok(byCondition["time-shuffled"].mappingError > byCondition["signal-driven"].mappingError);
  assert.ok(byCondition["zero-input"].mappingError > byCondition["time-shuffled"].mappingError);
  assert.equal(report.codeKey[byCondition["signal-driven"].code], "signal-driven");
});
