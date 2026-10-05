# Security Policy

Please report potential vulnerabilities privately to the repository owner rather than opening a public issue. Include a minimal reproduction, the affected commit, and the impact.

Signal Loom is an offline browser prototype: `index.html` and its local modules make no network requests and load no external resources by design; any change that introduces one is in scope. There is no live sensor, device, audio, camera, or remote data path.

This is a performance-art research prototype that uses **synthetic** EEG-like and ECG-like streams only. It is not a medical device; do not use it with real patient data or for diagnosis.
