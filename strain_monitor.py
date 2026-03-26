import time

class StrainMonitor:
    def __init__(self):
        self.start_time = time.time()
        self.prev_blinks = 0
        self.blinks_per_minute = 0

    def update(self, total_blinks):
        current_time = time.time()
        elapsed = current_time - self.start_time

        if elapsed >= 60:  # every 60 sec
            self.blinks_per_minute = total_blinks - self.prev_blinks
            self.prev_blinks = total_blinks
            self.start_time = current_time

    def get_strain_level(self):
        bpm = self.blinks_per_minute

        if bpm > 15:
            return "Low"
        elif bpm > 8:
            return "Medium"
        else:
            return "High"