# Adaptive Eye Strain Dashboard — Web App

A fully **client-side** eye strain monitoring system that runs entirely in the browser.  
No Python, no backend, no server — just open `index.html` or deploy to Vercel.

## Features
- 10-second personalised calibration using EAR (Eye Aspect Ratio)
- Real-time blink detection with hysteresis thresholds
- Strain scoring: Low / Medium / High
- Live blink-rate chart (Chart.js)
- Audio + visual alert when strain is critical
- Works on any HTTPS host (Vercel, Netlify, GitHub Pages)

## Tech Stack
| Layer | Library |
|---|---|
| Face Tracking | [MediaPipe FaceMesh JS](https://google.github.io/mediapipe/solutions/face_mesh) |
| Charting | [Chart.js](https://www.chartjs.org/) |
| Camera | `navigator.mediaDevices.getUserMedia` |
| Styling | Vanilla CSS (Inter font) |

## Running Locally
```bash
# Requires a local server for camera access (no file:// protocol)
python -m http.server 8000
# then open → http://localhost:8000
```

## Deploy to Vercel
1. Push the **`web_app/`** folder contents to a GitHub repo.
2. Import the repo in [Vercel](https://vercel.com/new).
3. Set **Root Directory** → `web_app` (or leave blank if you pushed only web files).
4. Click Deploy — done!

> **Note:** Camera requires HTTPS. Vercel provides this automatically.
