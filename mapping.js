import { clamp } from "./signal-model.js";

export function mapEegFeatureToField(feature, gain = 0.75) {
  return 0.32 + 0.55 * clamp(gain, 0, 1) * clamp(feature, 0, 1);
}

export function mapRrIntervalToPulse(rrIntervalMs, gain = 0.72) {
  const intervalSeconds = clamp(rrIntervalMs / 1000, 0.35, 1.5);
  const pulseDepth = 0.16 + 0.62 * clamp(gain, 0, 1);
  return { intervalSeconds, pulseDepth };
}
