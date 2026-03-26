import streamlit as st
import cv2
import threading
import time

from eye_tracker import EyeTracker
from strain_monitor import StrainMonitor
from brightness_control import adjust_brightness
from dashboard import render_dashboard

# Create a small class to hold thread-specific state
class ThreadState:
    def __init__(self):
        self.last_strain_level = None

def main():
    # Initialize trackers if not present
    if "tracker" not in st.session_state:
        st.session_state.tracker = EyeTracker()
        st.session_state.monitor = StrainMonitor()
        st.session_state.thread_state = ThreadState()
        
        # Track camera state to fix threading issues
        st.session_state.camera_started = False

    # Start the background thread only once to prevent Streamlit rerun multi-threads
    if not st.session_state.camera_started:
        st.session_state.camera_started = True
        
        # Grab references to pass directly into the thread
        # This prevents the Thread from raising `ScriptRunContext` or `session_state` KeyError
        t_tracker = st.session_state.tracker
        t_monitor = st.session_state.monitor
        t_state = st.session_state.thread_state
        
        def camera_loop(tracker, monitor, state):
            cap = cv2.VideoCapture(0)
            target_fps = 15
            frame_time = 1.0 / target_fps
            
            while tracker.running:
                start_t = time.time()
                
                ret, frame = cap.read()
                if not ret:
                    break
                    
                frame = tracker.process_frame(frame)
                
                # Check for updates and brightness adjustments
                if tracker.state == "TRACKING":
                    strain_level = monitor.update(
                        tracker.last_blink_detected,
                        tracker.eye_closed_frames
                    )
                    
                    # Brightness Optimization: Only adjust brightness when strain changes
                    if strain_level != state.last_strain_level:
                        adjust_brightness(strain_level)
                        state.last_strain_level = strain_level
                else:
                    monitor.start_time = time.time() # Reset clock during calibration
                
                cv2.imshow("Adaptive Eye Strain Tracker - Camera", frame)
                
                # Safe Thread Shutdown using ESC key
                if cv2.waitKey(1) & 0xFF == 27: 
                    tracker.running = False
                    break
                    
                elapsed = time.time() - start_t
                sleep_time = frame_time - elapsed
                if sleep_time > 0:
                    time.sleep(sleep_time)
            
            # Release resources gracefully
            cap.release()
            cv2.destroyAllWindows()
            
        # Spawn daemon thread so it guarantees exit when Streamlit terminates
        # Pass the variables directly into args to solve the background context scope issue
        threading.Thread(target=camera_loop, args=(t_tracker, t_monitor, t_state), daemon=True).start()

    # Pass instances to render the live UI
    render_dashboard(st.session_state.tracker, st.session_state.monitor)

if __name__ == "__main__":
    main()