import cv2
import mediapipe as mp
import time

class EyeTracker:
    def __init__(self):
        import mediapipe as mp
        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh = self.mp_face_mesh.FaceMesh(refine_landmarks=True)

        self.blink_count = 0
        self.eye_closed_frames = 0

        self.EAR_THRESHOLD = 0.20   # adjust later
        self.CONSEC_FRAMES = 3      # frames required to count blink

    def calculate_ear(self, eye):
        import numpy as np
        A = np.linalg.norm(eye[1] - eye[5])
        B = np.linalg.norm(eye[2] - eye[4])
        C = np.linalg.norm(eye[0] - eye[3])
        ear = (A + B) / (2.0 * C)
        return ear

    def detect_blink(self, frame):
        import cv2
        import numpy as np

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.face_mesh.process(rgb)

        if results.multi_face_landmarks:
            for face_landmarks in results.multi_face_landmarks:
                h, w, _ = frame.shape

                # Left eye landmarks (MediaPipe)
                left_eye_idx = [33, 160, 158, 133, 153, 144]
                right_eye_idx = [362, 385, 387, 263, 373, 380]

                left_eye = np.array([
                    [face_landmarks.landmark[i].x * w,
                     face_landmarks.landmark[i].y * h]
                    for i in left_eye_idx
                ])

                right_eye = np.array([
                    [face_landmarks.landmark[i].x * w,
                     face_landmarks.landmark[i].y * h]
                    for i in right_eye_idx
                ])

                left_ear = self.calculate_ear(left_eye)
                right_ear = self.calculate_ear(right_eye)

                ear = (left_ear + right_ear) / 2.0

                # 🔴 Blink logic (fixed)
                if ear < self.EAR_THRESHOLD:
                    self.eye_closed_frames += 1
                else:
                    if self.eye_closed_frames >= self.CONSEC_FRAMES:
                        self.blink_count += 1
                    self.eye_closed_frames = 0

                return True, self.blink_count

        return False, self.blink_count