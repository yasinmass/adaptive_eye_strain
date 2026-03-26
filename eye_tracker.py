import cv2
import mediapipe as mp
import numpy as np
import time

class EyeTracker:
    def __init__(self):
        # Initialize MediaPipe FaceMesh
        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=False,  # Optimized performance
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )

        self.blink_count = 0
        self.eye_closed_frames = 0
        self.state = "CALIBRATING"
        
        self.EAR_THRESHOLD = 0.25 # Lower bound (EAR_LOW), updated after calibration
        self.EAR_HIGH = 0.27      # Upper bound (updated dynamically)
        self.CONSEC_FRAMES = 2    # Avoid false positives while allowing fast natural blinks
        self.BLINK_COOLDOWN = 0.2 # Minimum time in seconds between blinks
        
        self.calib_start_time = None
        self.calib_ear_values = []
        self.is_calibrated = False

        self.last_blink_detected = False
        self.last_blink_time = 0
        self.eye_is_closed = False
        self.running = True
        
        # Stored previous EAR for smoothing
        self.prev_ear = None

    def calculate_ear(self, eye):
        """Compute the Eye Aspect Ratio (EAR)"""
        # Distance between vertical eye landmarks
        A = np.linalg.norm(eye[1] - eye[5])
        B = np.linalg.norm(eye[2] - eye[4])
        # Distance between horizontal eye landmarks
        C = np.linalg.norm(eye[0] - eye[3])
        
        # Prevent Division Error
        if C == 0.0:
            return 0.0
            
        # EAR approximation
        ear = (A + B) / (2.0 * C)
        return ear

    def process_frame(self, frame):
        """Processes a single frame for EAR calculation and blink detection"""
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.face_mesh.process(rgb)

        ear = None
        self.last_blink_detected = False

        if results.multi_face_landmarks:
            face_landmarks = results.multi_face_landmarks[0]
            h, w, _ = frame.shape

            # Extract MediaPipe eye landmarks
            left_eye_idx = [33, 160, 158, 133, 153, 144]
            right_eye_idx = [362, 385, 387, 263, 373, 380]

            left_eye = np.array([[face_landmarks.landmark[i].x * w, face_landmarks.landmark[i].y * h] for i in left_eye_idx])
            right_eye = np.array([[face_landmarks.landmark[i].x * w, face_landmarks.landmark[i].y * h] for i in right_eye_idx])

            # Calculate individual and average EAR
            left_ear = self.calculate_ear(left_eye)
            right_ear = self.calculate_ear(right_eye)
            raw_ear = (left_ear + right_ear) / 2.0
            
            # Improved EAR Smoothing (Faster Response)
            if self.prev_ear is None:
                self.prev_ear = raw_ear
                
            smooth_ear = 0.5 * self.prev_ear + 0.5 * raw_ear
            self.prev_ear = smooth_ear
            ear = smooth_ear

        if ear is not None:
            if not self.is_calibrated:
                # Calibration Phase
                if self.calib_start_time is None:
                    self.calib_start_time = time.time()
                
                elapsed = time.time() - self.calib_start_time
                
                # Calibration Improvement: Only collect EAR values when EAR > 0.22
                if ear > 0.22:
                    self.calib_ear_values.append(ear)
                
                cv2.putText(frame, f"Calibrating: {max(0, 10 - int(elapsed))}s", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 165, 255), 2)
                cv2.putText(frame, "Keep eyes open natively", (50, 100), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 165, 255), 2)
                
                if elapsed >= 10:
                    # Fallback if no valid EAR collected
                    if len(self.calib_ear_values) > 0:
                        avg_ear = np.mean(self.calib_ear_values)
                        self.EAR_THRESHOLD = avg_ear * 0.82
                    else:
                        self.EAR_THRESHOLD = 0.25
                    
                    self.EAR_HIGH = self.EAR_THRESHOLD + 0.02
                    self.is_calibrated = True
                    self.state = "TRACKING"
            else:
                # Tracking Phase (Hysteresis Logic)
                if ear < self.EAR_THRESHOLD:
                    self.eye_is_closed = True
                    self.eye_closed_frames += 1
                elif ear > self.EAR_HIGH:
                    if self.eye_is_closed:
                        # Eye effectively reopened, validate length
                        if self.eye_closed_frames >= self.CONSEC_FRAMES:
                            current_time = time.time()
                            # Check system cooldown
                            if (current_time - self.last_blink_time) >= self.BLINK_COOLDOWN:
                                self.blink_count += 1
                                self.last_blink_detected = True
                                self.last_blink_time = current_time
                        
                        # Reset tracking state naturally
                        self.eye_is_closed = False
                        self.eye_closed_frames = 0
                else:
                    # Hysteresis Transition Phase (values between LOW and HIGH)
                    if self.eye_is_closed:
                        self.eye_closed_frames += 1
                        
                cv2.putText(frame, f"Blinks: {self.blink_count}", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
                cv2.putText(frame, f"EAR: {ear:.2f}", (50, 100), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 0, 0), 2)
                cv2.putText(frame, f"Threshold: {self.EAR_THRESHOLD:.2f}", (50, 150), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 0, 0), 2)

        return frame