# Changelog

All notable changes to this project. Evidence tag: SYNTHETIC (everything here runs on generated data).

## 0.1.1 — 2026-10-05

Archived on Zenodo: version DOI [10.5281/zenodo.23173943](https://doi.org/10.5281/zenodo.23173943).

Independent-review fixes. Evidence remains SYNTHETIC; results are matched-model software checks, not neuroscience validation. License remains MIT. Cite all versions via the concept DOI [10.5281/zenodo.23173453](https://doi.org/10.5281/zenodo.23173453).

### Fixed
- UI label: the R–R interval sets pulse spacing only; the separate pulse gain sets pulse depth (previously mislabeled as R–R controlling "pulse depth + spacing").
- Primary stream labels are now "synthetic EEG-like feature" and "synthetic ECG-like beat stream"; "mind/heart projection" is tagged as metaphor only.
- README/UI: the mapping-control signal-driven arm is zero by construction (same mapper, same frames) — a matched-model software check, not independent validation.
- `npm test` uses an explicit `tests/*.test.js` glob so the Node 22 test runner finds the suite.
- CHANGELOG: license line corrected to MIT (the 0.1.0 entry previously said AGPL-3.0-only).

### Added
- Tests for the R–R/gain mapping split and the UI label wording (14 cases total).

## 0.1.0 — 2026-10-05

### Added
- Offline browser performance-art prototype: synthetic EEG-like and ECG-like streams drive an interactive visual score (`index.html`, `app.js`, `styles.css`).
- Signal core (`signal-model.js`): synthetic stream generation, ECG-like R-peak detection, β/τ injection and estimation, EEG slow-envelope feature.
- Feature-to-visual mappings (`mapping.js`) and held-out / shuffled-code mapping-control checks (`validation.js`).
- Node `--test` suite (`tests/signal-model.test.js`): no-link control, common-noise confound, held-out robustness, mapping-control comparison.
- Local static serve via `python3 -m http.server` (`npm start`); no npm dependencies.
- GitHub Actions CI (Node 18 / 20 / 22), `CITATION.cff`, `.zenodo.json`, MIT `LICENSE`, `SECURITY.md`, `.nojekyll` for GitHub Pages.
