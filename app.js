import {
  beatTimesFor,
  syntheticEcgStreamAt,
  syntheticEegAt,
  syntheticEegFeatureAt,
} from "./signal-model.js";
import { mapEegFeatureToField, mapRrIntervalToPulse } from "./mapping.js";
import { runShuffledCodeMappingControlCheck, runHeldOutBench } from "./validation.js";

const byId = (id) => document.getElementById(id);
const controls = {
  beta: byId("betaControl"), lag: byId("lagControl"), confound: byId("confoundControl"),
  rhythm: byId("rhythmControl"), bpm: byId("bpmControl"), fieldGain: byId("fieldGainControl"), pulseGain: byId("pulseGainControl"),
  offset: byId("offsetControl"), jitter: byId("jitterControl"), noise: byId("noiseControl"), drop: byId("dropControl"),
};
const canvases = {
  score: byId("scoreCanvas"), eeg: byId("eegCanvas"), ecg: byId("ecgCanvas"),
};
const contexts = Object.fromEntries(Object.entries(canvases).map(([key, canvas]) => [key, canvas.getContext("2d")]));
const settings = {
  beta: Number(controls.beta.value), lag: Number(controls.lag.value) / 1000,
  commonNoise: Number(controls.confound.value) / 100, dominantHz: Number(controls.rhythm.value),
  bpm: Number(controls.bpm.value), fieldGain: Number(controls.fieldGain.value), pulseGain: Number(controls.pulseGain.value),
};
const WINDOW_SECONDS = 4.8;
let paused = false;
let startTime = performance.now();
let lastTime = 0;
let previousFrameTime = null;
let slowFeature = 0.48;

function syncOutputs() {
  byId("betaValue").textContent = settings.beta.toFixed(2);
  byId("lagValue").textContent = `${Math.round(settings.lag * 1000)} ms`;
  byId("confoundValue").textContent = `${Math.round(settings.commonNoise * 100)}%`;
  byId("rhythmValue").textContent = settings.dominantHz.toFixed(1);
  byId("rhythmReadout").textContent = `${settings.dominantHz.toFixed(1)} Hz · synthetic rhythm`;
  byId("bpmValue").textContent = String(settings.bpm);
  byId("bpmReadout").textContent = `${settings.bpm} BPM · simulated`;
  byId("fieldGainSetting").textContent = settings.fieldGain.toFixed(2);
  byId("fieldGainReadout").textContent = settings.fieldGain.toFixed(2);
  byId("pulseGainSetting").textContent = settings.pulseGain.toFixed(2);
  byId("pulseGainReadout").textContent = settings.pulseGain.toFixed(2);
  byId("threadReadout").textContent = `β ${settings.beta.toFixed(2)} · τ ${Math.round(settings.lag * 1000)} ms · modeled link`;
  byId("threadStatus").textContent = settings.beta === 0 ? "β = 0 · NO INJECTED LINK" : "SYNTHETIC BEAT → EEG INJECTION · +τ";
}

function sizeCanvas(canvas, context) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width: rect.width, height: rect.height };
}

function drawGrid(context, width, height, color) {
  context.save();
  context.strokeStyle = "rgba(151, 181, 191, .075)";
  context.lineWidth = 1;
  const left = 16; const right = width - 16; const top = 17; const bottom = height - 25;
  for (let row = 0; row <= 4; row += 1) {
    const y = top + (bottom - top) * row / 4;
    context.beginPath(); context.moveTo(left, y); context.lineTo(right, y); context.stroke();
  }
  for (let column = 0; column <= 8; column += 1) {
    const x = left + (right - left) * column / 8;
    context.beginPath(); context.moveTo(x, top); context.lineTo(x, bottom); context.stroke();
  }
  context.strokeStyle = color; context.globalAlpha = .21; context.setLineDash([2, 5]);
  context.beginPath(); context.moveTo(left, (top + bottom) / 2); context.lineTo(right, (top + bottom) / 2); context.stroke();
  context.restore();
}

function drawAura(context, width, height, color, phase, time) {
  const x = width * 0.5; const y = height * 0.42; const radius = Math.min(width * 0.33, height * 0.42);
  const gradient = context.createRadialGradient(x, y, 2, x, y, radius);
  gradient.addColorStop(0, `${color}12`); gradient.addColorStop(0.62, `${color}05`); gradient.addColorStop(1, `${color}00`);
  context.fillStyle = gradient; context.fillRect(0, 0, width, height);
  context.save(); context.translate(x, y); context.strokeStyle = color; context.lineWidth = 1;
  for (let ring = 0; ring < 3; ring += 1) {
    context.globalAlpha = 0.13 - ring * 0.025;
    context.beginPath(); context.ellipse(0, 0, radius * (0.38 + ring * 0.2), radius * (0.25 + ring * 0.14), phase * 0.08, 0, Math.PI * 2); context.stroke();
  }
  context.globalAlpha = 0.22;
  for (let dot = 0; dot < 12; dot += 1) {
    const angle = dot * Math.PI / 6 + time * 0.06; const orbit = radius * (0.34 + (dot % 3) * 0.16);
    context.beginPath(); context.arc(Math.cos(angle) * orbit, Math.sin(angle) * orbit * 0.6, 1.2, 0, Math.PI * 2); context.fillStyle = color; context.fill();
  }
  context.restore();
}

function drawScoreScene(context, width, height, scene) {
  const { time, spread, feature, beatPhase, pulseDepth, beta, lag } = scene;
  const fieldRadius = Math.min(width, height) * (0.20 + spread * 0.33);
  const cx = width * 0.5; const cy = height * 0.49;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#091117"; context.fillRect(0, 0, width, height);
  const halo = context.createRadialGradient(cx, cy, 1, cx, cy, fieldRadius * 1.8);
  halo.addColorStop(0, "rgba(118, 235, 205, .16)"); halo.addColorStop(.47, "rgba(74, 155, 173, .085)"); halo.addColorStop(1, "rgba(10, 16, 22, 0)");
  context.fillStyle = halo; context.fillRect(0, 0, width, height);

  const pulseDistance = Math.min(beatPhase, 1 - beatPhase);
  const pulse = Math.exp(-0.5 * (pulseDistance / 0.05) ** 2);
  context.save();
  for (let ring = 0; ring < 5; ring += 1) {
    const ringRadius = fieldRadius * (0.34 + ring * 0.17) + pulse * pulseDepth * 11;
    context.beginPath(); context.ellipse(cx, cy, ringRadius * 1.33, ringRadius * .71, Math.sin(time * .14) * .11, 0, Math.PI * 2);
    context.lineWidth = ring === 0 ? 1.1 : .7;
    context.strokeStyle = ring < 2 ? "rgba(137, 245, 212, .35)" : "rgba(141, 200, 255, .2)";
    context.globalAlpha = .36 - ring * .045 + pulse * pulseDepth * .18;
    context.stroke();
  }
  context.restore();

  const ribbon = context.createLinearGradient(0, 0, width, height);
  ribbon.addColorStop(0, "rgba(137,245,212,.8)"); ribbon.addColorStop(.52, "rgba(141,200,255,.65)"); ribbon.addColorStop(1, "rgba(255,154,135,.8)");
  for (let layer = 0; layer < 11; layer += 1) {
    const phase = time * (.1 + feature * .045) + layer * .43 + lag * .8;
    const amplitude = fieldRadius * (.17 + layer * .018);
    context.beginPath();
    const steps = Math.max(60, Math.floor(width / 5));
    for (let index = 0; index <= steps; index += 1) {
      const x = width * index / steps;
      const normalizedX = x / width * Math.PI * 2;
      const y = cy + Math.sin(normalizedX * (1.05 + layer * .018) + phase) * amplitude + Math.sin(normalizedX * 2.4 - time * .13 + layer) * amplitude * .17;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.strokeStyle = ribbon; context.globalAlpha = .13 + (layer % 3) * .025 + feature * .045;
    context.lineWidth = layer === 5 ? 1.35 : .8; context.shadowColor = layer === 5 ? "#89f5d4" : "transparent"; context.shadowBlur = layer === 5 ? 10 : 0; context.stroke();
  }
  context.shadowBlur = 0; context.globalAlpha = 1;

  // A moving score thread carries beat phase and the injected β/τ timing.
  const threadY = height * .82;
  context.save(); context.setLineDash(beta === 0 ? [3, 5] : []);
  context.strokeStyle = beta === 0 ? "rgba(151,166,175,.25)" : `rgba(137,245,212,${.22 + beta * .5})`;
  context.lineWidth = 1; context.beginPath(); context.moveTo(width * .1, threadY); context.lineTo(width * .9, threadY); context.stroke();
  const threadPhase = ((beatPhase - lag / Math.max(.35, scene.rrSeconds) + 1) % 1 + 1) % 1;
  const threadX = width * (.1 + .8 * threadPhase);
  context.beginPath(); context.arc(threadX, threadY, 2 + pulse * pulseDepth * 3, 0, Math.PI * 2);
  context.fillStyle = beta === 0 ? "#62727d" : "#b6ffe8"; context.globalAlpha = beta === 0 ? .35 : .45 + beta * .5; context.shadowColor = "#89f5d4"; context.shadowBlur = beta > 0 ? 12 : 0; context.fill(); context.restore();

  if (pulse > .72) {
    context.save(); context.fillStyle = "rgba(255,154,135,.85)"; context.font = "9px monospace"; context.fillText("R", width * .1 + 5, threadY - 9); context.restore();
  }
}

function drawScore(context, canvas, scene) {
  const dimensions = sizeCanvas(canvas, context);
  if (dimensions) drawScoreScene(context, dimensions.width, dimensions.height, scene);
}

function drawStream(context, canvas, time, kind) {
  const dimensions = sizeCanvas(canvas, context);
  if (!dimensions) return;
  const { width, height } = dimensions;
  context.clearRect(0, 0, width, height);
  const isMind = kind === "mind"; const color = isMind ? "#89f5d4" : "#ff9a87";
  const signalOptions = { beta: settings.beta, lag: settings.lag, bpm: settings.bpm, dominantHz: settings.dominantHz, commonNoise: settings.commonNoise, seed: 17 };
  drawAura(context, width, height, color, settings.beta, time); drawGrid(context, width, height, color);
  const left = 16; const right = width - 16; const top = 20; const bottom = height - 27;
  const centerY = (top + bottom) / 2; const amplitudeScale = (bottom - top) * 0.34;
  const pointCount = Math.max(260, Math.floor(width * 1.1)); const start = time - WINDOW_SECONDS;
  const beats = beatTimesFor(time + 0.01, settings.bpm);
  context.save(); context.beginPath(); context.rect(left, top, right - left, bottom - top); context.clip(); context.beginPath();
  for (let index = 0; index <= pointCount; index += 1) {
    const fraction = index / pointCount; const sampleTime = start + fraction * WINDOW_SECONDS;
    const value = isMind ? syntheticEegAt(sampleTime, signalOptions, beats) : syntheticEcgStreamAt(sampleTime, signalOptions);
    const x = left + fraction * (right - left); const y = centerY - Math.max(-1.5, Math.min(1.5, value)) * amplitudeScale;
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.strokeStyle = color; context.lineWidth = 1.35; context.lineJoin = "round"; context.shadowColor = color; context.shadowBlur = 10; context.stroke();
  context.shadowBlur = 0; context.globalAlpha = .25; context.lineWidth = 4; context.stroke(); context.restore();
  context.save(); context.strokeStyle = color; context.globalAlpha = .4; context.lineWidth = 1; context.beginPath(); context.moveTo(right - 1, top); context.lineTo(right - 1, bottom); context.stroke(); context.restore();
  if (settings.commonNoise > .02) {
    context.save(); context.fillStyle = "rgba(141, 200, 255, .82)"; context.font = "8px monospace"; context.fillText("COMMON-MODE DISTURBANCE ON", 24, 14); context.restore();
  }
}

function animate(now) {
  if (!paused) {
    const elapsed = Math.max(0, (now - startTime) / 1000); const delta = previousFrameTime === null ? 0.016 : Math.max(0.001, elapsed - previousFrameTime);
    previousFrameTime = elapsed; lastTime = elapsed;
    const signalOptions = { beta: settings.beta, lag: settings.lag, bpm: settings.bpm, dominantHz: settings.dominantHz, commonNoise: settings.commonNoise, seed: 17 };
    const beats = beatTimesFor(elapsed, settings.bpm);
    const extractedFeature = syntheticEegFeatureAt(elapsed, signalOptions, beats);
    slowFeature += (1 - Math.exp(-delta / 1.8)) * (extractedFeature - slowFeature);
    const rrIntervalMs = beats.length > 1 ? (beats.at(-1) - beats.at(-2)) * 1000 : 60_000 / settings.bpm;
    const rrSeconds = rrIntervalMs / 1000;
    const beatPhase = (((elapsed - 0.5) / rrSeconds) % 1 + 1) % 1;
    const fieldSpread = mapEegFeatureToField(slowFeature, settings.fieldGain);
    const pulse = mapRrIntervalToPulse(rrIntervalMs, settings.pulseGain);
    const drawStarted = performance.now();
    drawScore(contexts.score, canvases.score, { time: elapsed, spread: fieldSpread, feature: slowFeature, beatPhase, pulseDepth: pulse.pulseDepth, beta: settings.beta, lag: settings.lag, rrSeconds, rrIntervalMs });
    drawStream(contexts.eeg, canvases.eeg, elapsed, "mind");
    drawStream(contexts.ecg, canvases.ecg, elapsed, "heart");
    const drawMs = performance.now() - drawStarted;
    byId("latencyReadout").textContent = `${drawMs.toFixed(2)} ms`;
    byId("fieldReadout").textContent = `${(fieldSpread * 100).toFixed(0)}%`;
    byId("featureReadout").textContent = `${slowFeature.toFixed(2)} · synthetic 1.4 s envelope`;
    byId("rrReadout").textContent = `${rrIntervalMs.toFixed(0)} ms · synthetic ECG R–R`;
    const dot = byId("threadDot");
    const threadProgress = (((elapsed - 0.5 - settings.lag) / rrSeconds) % 1 + 1) % 1;
    dot.style.left = `${(threadProgress * 100).toFixed(2)}%`;
    dot.style.opacity = settings.beta === 0 ? "0.08" : String(Math.min(.98, .2 + settings.beta));
    dot.style.transform = `translateY(-50%) scale(${1 + settings.beta * .45})`;
  }
  requestAnimationFrame(animate);
}

function bindRange(control, callback) {
  control.addEventListener("input", () => callback(Number(control.value)));
}
bindRange(controls.beta, (value) => { settings.beta = value; syncOutputs(); });
bindRange(controls.lag, (value) => { settings.lag = value / 1000; syncOutputs(); });
bindRange(controls.confound, (value) => { settings.commonNoise = value / 100; syncOutputs(); });
bindRange(controls.rhythm, (value) => { settings.dominantHz = value; syncOutputs(); });
bindRange(controls.bpm, (value) => { settings.bpm = value; syncOutputs(); });
bindRange(controls.fieldGain, (value) => { settings.fieldGain = value; syncOutputs(); });
bindRange(controls.pulseGain, (value) => { settings.pulseGain = value; syncOutputs(); });

byId("pauseButton").addEventListener("click", (event) => {
  paused = !paused; event.currentTarget.textContent = paused ? "Resume animation" : "Pause animation";
  if (!paused) { startTime = performance.now() - lastTime * 1000; previousFrameTime = null; }
});

for (const [control, output, suffix] of [
  [controls.offset, "offsetValue", " ms"], [controls.jitter, "jitterValue", " ms"],
  [controls.noise, "noiseValue", ""], [controls.drop, "dropValue", "%"],
]) {
  const update = () => { const value = Number(control.value); byId(output).textContent = `${(output === "noiseValue" ? value.toFixed(2) : value.toFixed(0))}${suffix}`; };
  control.addEventListener("input", update); update();
}

byId("runBench").addEventListener("click", (event) => {
  const button = event.currentTarget; const status = byId("benchStatus"); button.disabled = true; status.textContent = "Running deterministic held-out simulations…";
  window.setTimeout(() => {
    try {
      const report = runHeldOutBench({ perturbations: { timeOffsetMs: Number(controls.offset.value), jitterMs: Number(controls.jitter.value), noise: Number(controls.noise.value), dropRate: Number(controls.drop.value) / 100 } });
      byId("betaError").textContent = report.meanAbsoluteError.beta.toFixed(3);
      byId("lagError").textContent = Number.isFinite(report.meanAbsoluteError.lagMs) ? report.meanAbsoluteError.lagMs.toFixed(0) : "n/a";
      byId("beatError").textContent = Number.isFinite(report.meanAbsoluteError.beatAlignmentMs) ? report.meanAbsoluteError.beatAlignmentMs.toFixed(1) : "n/a";
      status.textContent = `Complete · held-out seeds ${report.seeds.join(", ")} · no tuning on these seeds`;
      const seedBrief = report.perSeed.map((result) => `${result.seed}: β̂ ${result.estimatedBeta.toFixed(2)}, τ̂ ${result.estimatedLagMs === null ? "n/a" : `${result.estimatedLagMs.toFixed(0)} ms`}, beats ${result.detectedBeatCount}/${result.truthBeatCount}`).join(" · ");
      byId("benchFootnote").textContent = `Ground truth: β = 0.36, τ = 180 ms, 72 BPM. Per-seed estimates: ${seedBrief}. Matched-beat MAE excludes missed beats (counts shown). Matched-model implementation check only: generation and fitting use the same synthetic beat-template family and known clock-offset corrections; not a blind estimator or evidence of EEG/ECG generalization.`;
    } catch (error) { status.textContent = `Bench failed: ${error instanceof Error ? error.message : "unknown error"}`; }
    finally { button.disabled = false; }
  }, 20);
});

byId("runMappingControlCheck").addEventListener("click", (event) => {
  const button = event.currentTarget; const status = byId("mappingControlStatus"); button.disabled = true; status.textContent = "Scoring conditions with randomized software codes…";
  window.setTimeout(() => {
    try {
      const report = runShuffledCodeMappingControlCheck({ fieldGain: settings.fieldGain, bpm: settings.bpm });
      const offscreen = document.createElement("canvas"); offscreen.width = 420; offscreen.height = 210;
      const context = offscreen.getContext("2d"); const measurements = [];
      // The same score-field renderer used above is timed for every browser-rendered control frame.
      for (const arm of report.arms) {
        const begin = performance.now();
        for (const frame of arm.frames) {
          const rrSeconds = frame.rrIntervalMs / 1000; const pulse = mapRrIntervalToPulse(frame.rrIntervalMs, settings.pulseGain);
          drawScoreScene(context, offscreen.width, offscreen.height, {
            time: frame.time, spread: frame.fieldSpread, feature: frame.feature,
            beatPhase: (((frame.time - 0.5) / rrSeconds) % 1 + 1) % 1, pulseDepth: pulse.pulseDepth,
            beta: arm.condition === "zero-input" ? 0 : .36, lag: .18, rrSeconds,
          });
        }
        measurements.push({ code: arm.code, condition: arm.condition, mappingError: arm.mappingError, renderLatencyMs: (performance.now() - begin) / arm.frames.length });
      }
      const resultHtml = measurements.map((result) => `<div class="mapping-control-arm"><span>CODE ${result.code} → ${result.condition.toUpperCase()}</span><strong>mapping error ${result.mappingError.toFixed(4)}</strong><small>mean score-frame draw ${result.renderLatencyMs.toFixed(3)} ms</small></div>`).join("");
      byId("mappingControlMetrics").innerHTML = resultHtml;
      status.textContent = "Scored · randomized software codes reported with condition names";
      byId("mappingControlFootnote").textContent = `Software-randomized condition labels: ${Object.entries(report.codeKey).map(([code, condition]) => `${code} = ${condition}`).join(" · ")}. Field-spread MAE is relative to the signal-driven target; the signal-driven arm is zero by construction (same mapper, same frames), so this is a matched-model software check, not independent validation. Draw latency is local browser canvas time per frame over ${report.frameCount} frames/arm, not end-to-end input latency. This is not a genuinely blinded or human-perception study.`;
    } catch (error) { status.textContent = `Control check failed: ${error instanceof Error ? error.message : "unknown error"}`; }
    finally { button.disabled = false; }
  }, 20);
});

syncOutputs();
requestAnimationFrame(animate);
