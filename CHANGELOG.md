# Changelog

All notable changes to this project. Evidence tag: SYNTHETIC (everything here runs on generated data).

## 0.1.0 — unreleased

### Added
- Offline browser performance-art prototype: synthetic EEG-like and ECG-like streams drive an interactive visual score (`index.html`, `app.js`, `styles.css`).
- Signal core (`signal-model.js`): synthetic stream generation, ECG-like R-peak detection, β/τ injection and estimation, EEG slow-envelope feature.
- Feature-to-visual mappings (`mapping.js`) and held-out / shuffled-code mapping-control checks (`validation.js`).
- Node `--test` suite (`tests/signal-model.test.js`): no-link control, common-noise confound, held-out robustness, mapping-control comparison.
- Local static serve via `python3 -m http.server` (`npm start`); no npm dependencies.
- GitHub Actions CI (Node 18 / 20 / 22), `CITATION.cff`, `.zenodo.json`, AGPL-3.0-only `LICENSE`, `COMMERCIAL-LICENSE.md`, `SECURITY.md`, `.nojekyll` for GitHub Pages.
