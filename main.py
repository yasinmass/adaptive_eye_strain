import cv2
from eye_tracker import EyeTracker
from strain_monitor import StrainMonitor
from notifier import Notifier
from brightness_control import adjust_brightness
import time

eye_tracker = EyeTracker()
strain_monitor = StrainMonitor()
notifier = Notifier()

cap = cv2.VideoCapture(0)

while True:
    ret, frame = cap.read()
    if not ret:
        break

    blink_detected, total_blinks = eye_tracker.detect_blink(frame)
    strain_monitor.update(total_blinks)
    strain_level = strain_monitor.get_strain_level()

    adjust_brightness(strain_level)

    if strain_level == "High":
        notifier.send_notification("Eye Strain Alert", "High strain detected! Take a break.")

    notifier.check_20_20_20()

    cv2.putText(frame, f"Blink: {total_blinks}", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0,255,0), 2)
    cv2.putText(frame, f"Strain: {strain_level}", (50, 100), cv2.FONT_HERSHEY_SIMPLEX, 1, (0,0,255), 2)
    cv2.imshow("Eye Strain Tracker", frame)

    if cv2.waitKey(1) & 0xFF == 27:  # ESC to quit
        break
    
    print("Blinks/min:", strain_monitor.blinks_per_minute)

cap.release()
cv2.destroyAllWindows()