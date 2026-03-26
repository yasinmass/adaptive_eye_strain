// ============================================================
//  Adaptive Eye Strain Protection System — Browser Edition
//  Tech: MediaPipe FaceMesh JS · Chart.js · navigator.mediaDevices
//  No Python / No backend required
// ============================================================

// ====== DOM References ======
const videoElement   = document.getElementById('webcam');
const canvasElement  = document.getElementById('overlay');
const canvasCtx      = canvasElement.getContext('2d');
const calibOverlay   = document.getElementById('calibration-overlay');
const calibText      = document.getElementById('calib-text');
const statusBadge    = document.getElementById('status-badge');
const alertBox       = document.getElementById('alert-box');
const alertSound     = document.getElementById('alert-sound');

const elBlinks       = document.getElementById('metric-blinks');
const elRate         = document.getElementById('metric-rate');
const elStrain       = document.getElementById('metric-strain');
const elTime         = document.getElementById('metric-time');
const strainBadge    = document.getElementById('strain-badge');
const eyeStatus      = document.getElementById('eye-status');
const elEar          = document.getElementById('tech-ear');
const elThreshold    = document.getElementById('tech-threshold');
const chartCtx       = document.getElementById('blinkChart').getContext('2d');

// ====== State Variables ======
let isCalibrated     = false;
let calibStartTime   = null;
let calibEarValues   = [];

// EAR thresholds (updated after calibration)
let EAR_THRESHOLD    = 0.25;   // LOW bound
let EAR_HIGH         = 0.27;   // HIGH bound (hysteresis)

const CONSEC_FRAMES  = 2;      // min frames below threshold to count as closure
const BLINK_COOLDOWN = 200;    // ms — prevents double-counting one blink

let prevEar          = null;
let eyeClosedFrames  = 0;
let blinkCount       = 0;
let lastBlinkDetected= false;
let eyeIsClosed      = false;
let lastBlinkTime    = 0;

// Strain monitor
let sessionStartTime = null;
let blinkTimestamps  = [];
let strainLevel      = 'Low';
let isHighStrainPlayed = false;

// Chart data buffers
const timeLabels = [];
const rateData   = [];
let   chartInst  = null;

// ====== Chart.js Setup ======
function initChart() {
    chartInst = new Chart(chartCtx, {
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: [{
                label: 'Blink Rate (bpm)',
                data: rateData,
                borderColor: '#06b6d4',
                backgroundColor: 'rgba(6,182,212,0.12)',
                borderWidth: 2,
                fill: true,
                tension: 0.35,
                pointRadius: 0,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,   // real-time — skip transitions
            scales: {
                y: { beginAtZero: true, suggestedMax: 20, grid: { color: 'rgba(255,255,255,0.04)' } },
                x: { grid: { display: false }, ticks: { display: false } }
            },
            plugins: { legend: { display: false } }
        }
    });
}
initChart();

// ====== EAR Maths ======
function dist(p1, p2) {
    return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
}

function calcEAR(landmarks, idx) {
    const A = dist(landmarks[idx[1]], landmarks[idx[5]]);
    const B = dist(landmarks[idx[2]], landmarks[idx[4]]);
    const C = dist(landmarks[idx[0]], landmarks[idx[3]]);
    if (C === 0) return 0;
    return (A + B) / (2 * C);
}

// ====== Dashboard Polling (1 Hz) ======
function pushChart(bpm) {
    const now = new Date();
    const ts  = `${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    timeLabels.push(ts);
    rateData.push(bpm);
    if (timeLabels.length > 60) { timeLabels.shift(); rateData.shift(); }
    chartInst.update();
}

setInterval(() => {
    if (!isCalibrated || !sessionStartTime) return;

    const now   = Date.now();
    // Remove blink timestamps older than 60 s
    blinkTimestamps = blinkTimestamps.filter(t => now - t <= 60_000);

    const elapsedSec = (now - sessionStartTime) / 1000;
    const screenMin  = elapsedSec / 60;

    // Extrapolate bpm (scale up early readings)
    let bpm = 0;
    if (elapsedSec > 0) {
        bpm = elapsedSec < 60
            ? Math.floor(blinkTimestamps.length * (60 / elapsedSec))
            : blinkTimestamps.length;
    }

    // Long-closure flag: ~30 fps × 1 s = 30 frames
    const longClosure = eyeClosedFrames >= 30;

    // Strain algorithm
    if ((elapsedSec > 10 && bpm < 8) || longClosure || screenMin > 60) {
        strainLevel = 'High';
    } else if (elapsedSec > 10 && bpm >= 8 && bpm <= 15) {
        strainLevel = 'Medium';
    } else {
        strainLevel = 'Low';
    }

    // Update metrics DOM
    elBlinks.innerText = blinkCount;
    elRate.innerText   = bpm;
    elTime.innerText   = screenMin.toFixed(1);
    elStrain.innerText = strainLevel;

    // Strain colour + badge
    if (strainLevel === 'High') {
        elStrain.style.color         = '#ef4444';
        strainBadge.style.background = '#7f1d1d';
        strainBadge.style.color      = '#fca5a5';
        strainBadge.innerText        = 'Warning';
        alertBox.classList.remove('hidden');
        if (!isHighStrainPlayed) {
            alertSound.play().catch(() => {}); // autoplay blocked silently
            isHighStrainPlayed = true;
        }
    } else if (strainLevel === 'Medium') {
        elStrain.style.color         = '#f59e0b';
        strainBadge.style.background = '#78350f';
        strainBadge.style.color      = '#fcd34d';
        strainBadge.innerText        = 'Moderate';
        alertBox.classList.add('hidden');
        isHighStrainPlayed = false;
    } else {
        elStrain.style.color         = '#34d399';
        strainBadge.style.background = '#064e3b';
        strainBadge.style.color      = '#6ee7b7';
        strainBadge.innerText        = 'Healthy';
        alertBox.classList.add('hidden');
        isHighStrainPlayed = false;
    }

    pushChart(bpm);
}, 1000);

// ====== MediaPipe FaceMesh Results Handler ======
function onResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.restore();

    let rawEar = null;
    lastBlinkDetected = false;

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const lm = results.multiFaceLandmarks[0];

        // MediaPipe FaceMesh landmark indices for each eye
        const LEFT  = [33, 160, 158, 133, 153, 144];
        const RIGHT = [362, 385, 387, 263, 373, 380];

        const leftEAR  = calcEAR(lm, LEFT);
        const rightEAR = calcEAR(lm, RIGHT);
        rawEar = (leftEAR + rightEAR) / 2;

        // Exponential smoothing — 50/50 for fast response
        if (prevEar === null) prevEar = rawEar;
        rawEar = 0.5 * prevEar + 0.5 * rawEar;
        prevEar = rawEar;
    }

    if (rawEar === null) return;
    elEar.innerText = rawEar.toFixed(3);

    if (!isCalibrated) {
        // ── Calibration phase ──
        if (!calibStartTime) calibStartTime = Date.now();
        const elapsed = (Date.now() - calibStartTime) / 1000;
        calibText.innerText = `Calibrating: ${Math.max(0, 10 - Math.floor(elapsed))}s`;

        if (rawEar > 0.22) calibEarValues.push(rawEar);   // discard squints

        if (elapsed >= 10) {
            if (calibEarValues.length > 0) {
                const avg  = calibEarValues.reduce((a, b) => a + b, 0) / calibEarValues.length;
                EAR_THRESHOLD = avg * 0.82;
            } else {
                EAR_THRESHOLD = 0.25;   // safe fallback
            }
            EAR_HIGH = EAR_THRESHOLD + 0.02;
            elThreshold.innerText = EAR_THRESHOLD.toFixed(3);

            isCalibrated    = true;
            sessionStartTime = Date.now();
            eyeClosedFrames  = 0;

            calibOverlay.classList.add('hidden');
            statusBadge.innerText   = 'TRACKING ACTIVE';
            statusBadge.className   = 'badge';
        }
    } else {
        // ── Tracking phase (dual-threshold hysteresis) ──
        if (rawEar < EAR_THRESHOLD) {
            eyeIsClosed = true;
            eyeClosedFrames++;
            eyeStatus.innerText    = 'Closed';
            eyeStatus.style.color  = '#ef4444';

        } else if (rawEar > EAR_HIGH) {
            eyeStatus.innerText    = 'Open';
            eyeStatus.style.color  = '#34d399';

            if (eyeIsClosed) {
                if (eyeClosedFrames >= CONSEC_FRAMES) {
                    const now = Date.now();
                    if (now - lastBlinkTime >= BLINK_COOLDOWN) {
                        blinkCount++;
                        blinkTimestamps.push(now);
                        lastBlinkDetected = true;
                        lastBlinkTime     = now;
                    }
                }
                eyeIsClosed     = false;
                eyeClosedFrames = 0;
            }
        } else {
            // Transition zone — keep counting closure frames if already closed
            if (eyeIsClosed) eyeClosedFrames++;
        }
    }
}

// ====== MediaPipe FaceMesh Initialisation ======
const faceMesh = new FaceMesh({
    locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
});

faceMesh.setOptions({
    maxNumFaces:            1,
    refineLandmarks:        false,   // disabled for performance
    minDetectionConfidence: 0.5,
    minTrackingConfidence:  0.5
});
faceMesh.onResults(onResults);

// ====== Camera Startup (with permission error handling) ======
// The MediaPipe Camera helper calls navigator.mediaDevices.getUserMedia internally.
// We wrap it to surface a friendly message on denial or HTTPS issues.
const camera = new Camera(videoElement, {
    onFrame: async () => {
        // Sync canvas size with actual video dimensions on every frame
        if (canvasElement.width  !== videoElement.videoWidth)
            canvasElement.width  = videoElement.videoWidth;
        if (canvasElement.height !== videoElement.videoHeight)
            canvasElement.height = videoElement.videoHeight;

        await faceMesh.send({ image: videoElement });
    },
    width:  640,
    height: 480
});

camera.start().catch(err => {
    // Friendly error displayed in the calibration overlay
    calibText.innerText = '📷 Camera access denied';
    calibOverlay.querySelector('p').innerText =
        err.name === 'NotAllowedError'
            ? 'Please allow camera permission and reload the page.'
            : `Error: ${err.message}. Make sure you are on HTTPS or localhost.`;
    calibOverlay.style.opacity = '1';
    calibOverlay.style.pointerEvents = 'all';
});
