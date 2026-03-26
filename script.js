// ====== DOM Interaction Setup ======
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('overlay');
const canvasCtx = canvasElement.getContext('2d');
const calibOverlay = document.getElementById('calibration-overlay');
const calibText = document.getElementById('calib-text');
const statusBadge = document.getElementById('status-badge');
const alertBox = document.getElementById('alert-box');
const alertSound = document.getElementById('alert-sound');

const elBlinks = document.getElementById('metric-blinks');
const elRate = document.getElementById('metric-rate');
const elStrain = document.getElementById('metric-strain');
const elTime = document.getElementById('metric-time');
const elEar = document.getElementById('tech-ear');
const elThreshold = document.getElementById('tech-threshold');
const chartContext = document.getElementById('blinkChart').getContext('2d');

// ====== Application State Tracking ======
let isCalibrated = false;
let calibStartTime = null;
let calibEarValues = [];

let EAR_THRESHOLD = 0.25; // Default overridden by calibration (LOW Threshold)
let EAR_HIGH = 0.27;      // High Threshold (Hysteresis Upper Bound)
const CONSEC_FRAMES = 2;  // Reduced to 2 allowing rapid blinks
const BLINK_COOLDOWN = 200; // ms between legitimate blinks

let prevEar = null;
let eyeClosedFrames = 0;
let blinkCount = 0;
let lastBlinkDetected = false;
let eyeIsClosed = false;
let lastBlinkTime = 0;

// Strain Monitor Engine variables
let sessionStartTime = null;
let blinkTimestamps = [];
let strainLevel = "Low";
let isHighStrainSoundPlayed = false;

// Chart.js Tracking Data Arrays
let timeLabels = [];
let rateData = [];
let chartInstance = null;

// ====== Sub-Component: Chart.js ======
function initChart() {
    chartInstance = new Chart(chartContext, {
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: [{
                label: 'Blink Rate (bpm)',
                data: rateData,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, suggestedMax: 20, grid: { color: 'rgba(255,255,255,0.05)' } },
                x: { grid: { display: false }, ticks: { display: false } }
            },
            plugins: {
                legend: { labels: { color: '#94a3b8' } }
            },
            animation: false // Optimized for rapid real-time updates without flickering
        }
    });
}
initChart();

// ====== Sub-Component: EAR Mathematic Operations ======
function euclideanDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

function calculateEAR(landmarks, indices) {
    const p0 = landmarks[indices[0]];
    const p1 = landmarks[indices[1]];
    const p2 = landmarks[indices[2]];
    const p3 = landmarks[indices[3]];
    const p4 = landmarks[indices[4]];
    const p5 = landmarks[indices[5]];

    const A = euclideanDistance(p1, p5); // Vertical dist 1
    const B = euclideanDistance(p2, p4); // Vertical dist 2
    const C = euclideanDistance(p0, p3); // Horizontal dist

    if (C === 0.0) return 0.0; // Prevent Math division crash
    return (A + B) / (2.0 * C);
}

// ====== Sub-Component: Dashboard Polling Loop ======
function updateChartData(bpm) {
    const now = new Date();
    const timeStr = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');
    
    timeLabels.push(timeStr);
    rateData.push(bpm);

    // Lock memory history buffer strictly to 60 indices
    if (timeLabels.length > 60) {
        timeLabels.shift();
        rateData.shift();
    }
    chartInstance.update();
}

// Global loop ticks every 1 second updating the HTML DOM directly
setInterval(() => {
    if (!isCalibrated || !sessionStartTime) return;
    
    const currentTime = Date.now();
    
    // Purge blink log occurrences older than 60 seconds 
    blinkTimestamps = blinkTimestamps.filter(t => currentTime - t <= 60000);
    let bpm = 0;
    let timeElapsedSec = (currentTime - sessionStartTime) / 1000;
    let screenTimeMin = timeElapsedSec / 60;
    
    // Extrapolate bpm accurately early in the session lifecycle
    if (timeElapsedSec > 0) {
        if (timeElapsedSec < 60) {
            bpm = Math.floor(blinkTimestamps.length * (60.0 / timeElapsedSec));
        } else {
            bpm = blinkTimestamps.length;
        }
    }

    // Determine long closure logic (~30 FPS rendering pipeline in Mediapipe)
    // 30 frames practically represents ~ 1 whole second of closing eyes
    let longClosure = eyeClosedFrames >= 30; 

    // STRAIN SENSING ALGORITHM
    if ((timeElapsedSec > 10 && bpm < 8) || longClosure || screenTimeMin > 60) {
        strainLevel = "High";
    } else if (timeElapsedSec > 10 && bpm >= 8 && bpm <= 15) {
        strainLevel = "Medium";
    } else {
        strainLevel = "Low";
    }

    // Update the dashboard HTML
    elBlinks.innerText = blinkCount;
    elRate.innerText = bpm;
    elTime.innerText = screenTimeMin.toFixed(1) + "m";
    elStrain.innerText = strainLevel;

    // Apply specific CSS color bindings depending on severity
    elStrain.className = "metric-value " + strainLevel.toLowerCase();

    // Spawn audible/visual warnings
    if (strainLevel === "High") {
        alertBox.classList.remove("hidden");
        // Only trigger alert sound once per high-strain event to avoid looping spam
        if (!isHighStrainSoundPlayed) {
            alertSound.play().catch(e => console.log("Sound autoplay blocked by browser policy"));
            isHighStrainSoundPlayed = true;
        }
    } else {
        alertBox.classList.add("hidden");
        isHighStrainSoundPlayed = false;
    }

    updateChartData(bpm);
}, 1000);

// ====== Sub-Component: MediaPipe Inference Engine Pipeline ======
function onResults(results) {
    // Boilerplate clearance to maintain canvas transparency
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.restore();

    let rawEar = null;
    lastBlinkDetected = false;

    // Valid Face Pipeline Processor
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const landmarks = results.multiFaceLandmarks[0];
        
        // Accurate vertex coordinate indices derived directly from python codebase requirements
        const leftEyeIdx = [33, 160, 158, 133, 153, 144];
        const rightEyeIdx = [362, 385, 387, 263, 373, 380];

        const leftEar = calculateEAR(landmarks, leftEyeIdx);
        const rightEar = calculateEAR(landmarks, rightEyeIdx);

        rawEar = (leftEar + rightEar) / 2.0;

        // Apply robust Exponential Data Smoothing formula
        if (prevEar === null) prevEar = rawEar;
        const smoothEar = 0.5 * prevEar + 0.5 * rawEar; // Fast Responsive 50/50 ratio
        prevEar = smoothEar;
        rawEar = smoothEar;
    }

    // Primary Control Flow
    if (rawEar !== null) {
        elEar.innerText = rawEar.toFixed(3);

        if (!isCalibrated) {
            // === INITIAL CALIBRATION LIFECYCLE Phase ===
            if (!calibStartTime) { calibStartTime = Date.now(); }
            
            let elapsedStr = ((Date.now() - calibStartTime) / 1000).toFixed(1);
            calibText.innerText = `Calibrating: ${Math.max(0, 10 - Math.floor(elapsedStr))}s`;

            // Filter out garbage EAR thresholds representing squinting instances
            if (rawEar > 0.22) {
                calibEarValues.push(rawEar);
            }

            // After exact 10 seconds triggers the transition
            if (elapsedStr >= 10.0) {
                if (calibEarValues.length > 0) {
                    const sum = calibEarValues.reduce((a, b) => a + b, 0);
                    const avg = sum / calibEarValues.length;
                    EAR_THRESHOLD = avg * 0.82; // Tightened scaling for tracking light closures
                } else {
                    EAR_THRESHOLD = 0.25; // Default Safety Fallback Value
                }
                
                EAR_HIGH = EAR_THRESHOLD + 0.02; // Hysteresis scaling
                isCalibrated = true;
                sessionStartTime = Date.now();
                
                // Finalize active visual UI status
                calibOverlay.classList.add('hidden');
                statusBadge.innerText = "Tracking Active";
                statusBadge.className = "badge active";
                elThreshold.innerText = EAR_THRESHOLD.toFixed(3);
                
                eyeClosedFrames = 0; // Fresh slate before tracking
            }
        } else {
            // === TRACKING LIFECYCLE Phase (Hysteresis) ===
            if (rawEar < EAR_THRESHOLD) {
                eyeIsClosed = true;
                eyeClosedFrames++;
            } else if (rawEar > EAR_HIGH) {
                if (eyeIsClosed) {
                    // Valid closure finished
                    if (eyeClosedFrames >= CONSEC_FRAMES) {
                        const currentTime = Date.now();
                        // Cooldown prevents double tagging a sluggish single blink
                        if (currentTime - lastBlinkTime >= BLINK_COOLDOWN) {
                            blinkCount++;
                            blinkTimestamps.push(currentTime);
                            lastBlinkDetected = true;
                            lastBlinkTime = currentTime;
                        }
                    }
                    // Reset properties upon reopening eye passing High Hysteresis barrier
                    eyeIsClosed = false;
                    eyeClosedFrames = 0;
                }
            } else {
                // Suspended Transition values falling straight between Thresholds
                if (eyeIsClosed) {
                    eyeClosedFrames++;
                }
            }
        }
    }
}

// Instantiate Web Assembly FaceMesh API
const faceMesh = new FaceMesh({locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
}});

faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: false,    // MediaPipe Performance Constraint Met
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});
faceMesh.onResults(onResults);

// Start streaming internal Webcam Media API Device Input strictly passing the data stream through MediaPipe
const camera = new Camera(videoElement, {
    onFrame: async () => {
        // Keeps geometry bounding boxes accurate ensuring the canvas tracks the source sizes exactly
        if(canvasElement.width !== videoElement.videoWidth){
            canvasElement.width = videoElement.videoWidth;
            canvasElement.height = videoElement.videoHeight;
        }
        await faceMesh.send({image: videoElement});
    },
    width: 640,
    height: 480
});

// Boot script immediately natively rendering feed inside the Browser exclusively!
camera.start();
