import {
  beatTimesFor,
  detectRPeaks,
  fitBetaLag,
  matchTimes,
  seededRandom,
  simulatePair,
  syntheticEegFeatureAt,
} from "./signal-model.js";
import { mapEegFeatureToField } from "./mapping.js";

export const HELD_OUT_SEEDS = Object.freeze([23, 41, 67, 89]);
export const VALIDATION_TRUTH = Object.freeze({ beta: 0.36, lag: 0.18, bpm: 72 });

export function runHeldOutBench({ seeds = HELD_OUT_SEEDS, perturbations = {} } = {}) {
  const results = seeds.map((seed) => {
    const offsetMs = perturbations.timeOffsetMs ?? 120;
    const pair = simulatePair({
      duration: 16,
      sampleRate: 80,
      beta: VALIDATION_TRUTH.beta,
      lag: VALIDATION_TRUTH.lag,
      bpm: VALIDATION_TRUTH.bpm,
      seed,
      // Known synthetic clock offsets are corrected before fitting; generation and fitting share the same beat-template family.
      eegClockOffsetMs: offsetMs / 2,
      ecgClockOffsetMs: -offsetMs / 2,
      jitterMs: perturbations.jitterMs ?? 12,
      noise: perturbations.noise ?? 0.12,
      dropRate: perturbations.dropRate ?? 0.10,
      commonNoise: perturbations.commonNoise ?? 0.05,
    });
    const detectedBeats = detectRPeaks(pair.ecg, {
      clockOffsetMs: pair.truth.settings.ecgClockOffsetMs,
    });
    const fit = fitBetaLag(pair.eeg, detectedBeats, {
      clockOffsetMs: pair.truth.settings.eegClockOffsetMs,
      dominantHz: pair.truth.settings.dominantHz,
    });
    const beatMatch = matchTimes(detectedBeats, pair.truth.beatTimes);
    return {
      seed,
      betaError: Math.abs(fit.beta - pair.truth.beta),
      lagErrorMs: fit.lag === null ? Infinity : Math.abs(fit.lag - pair.truth.lag) * 1000,
      beatAlignmentErrorMs: beatMatch.meanAbsoluteError * 1000,
      beatRecall: beatMatch.matched / beatMatch.truthCount,
      estimatedBeta: fit.beta,
      estimatedLagMs: fit.lag === null ? null : fit.lag * 1000,
      detectedBeatCount: detectedBeats.length,
      truthBeatCount: pair.truth.beatTimes.length,
      sampleCounts: { eeg: pair.eeg.length, ecg: pair.ecg.length },
    };
  });

  const average = (key) => results.reduce((sum, result) => sum + result[key], 0) / results.length;
  return {
    seeds: [...seeds],
    heldOut: true,
    groundTruth: { ...VALIDATION_TRUTH },
    perturbations: {
      timeOffsetMs: perturbations.timeOffsetMs ?? 120,
      jitterMs: perturbations.jitterMs ?? 12,
      noise: perturbations.noise ?? 0.12,
      dropRate: perturbations.dropRate ?? 0.10,
      commonNoise: perturbations.commonNoise ?? 0.05,
    },
    meanAbsoluteError: {
      beta: average("betaError"),
      lagMs: average("lagErrorMs"),
      beatAlignmentMs: average("beatAlignmentErrorMs"),
      beatRecall: average("beatRecall"),
    },
    perSeed: results,
  };
}

export function runShuffledCodeMappingControlCheck({ frameCount = 240, seed = 517, fieldGain = 0.78, bpm = 72 } = {}) {
  const options = { beta: 0.36, lag: 0.18, bpm, dominantHz: 10, commonNoise: 0, seed };
  const frames = Array.from({ length: frameCount }, (_, index) => {
    const time = 2 + index * 0.05;
    const beats = beatTimesFor(time, bpm);
    const rrIntervalMs = beats.length > 1 ? (beats.at(-1) - beats.at(-2)) * 1000 : 60_000 / bpm;
    return {
      time,
      feature: syntheticEegFeatureAt(time, options, beats),
      rrIntervalMs,
    };
  });
  const shuffledFeatures = frames.map((frame) => frame.feature);
  const random = seededRandom(seed ^ 0x5f3759df);
  for (let index = shuffledFeatures.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffledFeatures[index], shuffledFeatures[swap]] = [shuffledFeatures[swap], shuffledFeatures[index]];
  }

  const expectedField = frames.map((frame) => mapEegFeatureToField(frame.feature, fieldGain));
  const conditions = [
    { name: "signal-driven", source: (index) => frames[index].feature },
    { name: "time-shuffled", source: (index) => shuffledFeatures[index] },
    { name: "zero-input", source: () => 0 },
  ];
  // Software-randomize display codes only; condition identities remain available to the scorer.
  const codeOrder = ["A", "B", "C"];
  for (let index = codeOrder.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [codeOrder[index], codeOrder[swap]] = [codeOrder[swap], codeOrder[index]];
  }
  const arms = conditions.map((condition, index) => {
    const fieldSpread = frames.map((_, frameIndex) => mapEegFeatureToField(condition.source(frameIndex), fieldGain));
    const mappingError = fieldSpread.reduce((sum, value, frameIndex) => sum + Math.abs(value - expectedField[frameIndex]), 0) / frameCount;
    return {
      code: codeOrder[index],
      condition: condition.name,
      mappingError,
      frames: frames.map((frame, frameIndex) => ({
        time: frame.time,
        feature: condition.source(frameIndex),
        fieldSpread: fieldSpread[frameIndex],
        rrIntervalMs: frame.rrIntervalMs,
      })),
    };
  });
  return {
    seed,
    frameCount,
    fieldGain,
    bpm,
    arms,
    codeKey: Object.fromEntries(arms.map((arm) => [arm.code, arm.condition])),
    note: "Condition labels receive randomized software codes, but the code/scorer retains their mapping throughout; this is not a genuinely blinded or human-perception study. The signal-driven arm's zero error is guaranteed by construction (its target is generated by the same mapper from the same frames); this is a matched-model software check, not independent validation.",
  };
}
