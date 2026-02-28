import Foundation

/// Format seconds into a human-readable time string (e.g. "1:30", "1:01:01").
func formatTime(_ seconds: Double) -> String {
    guard seconds.isFinite && seconds > 0 else { return "0:00" }
    let s = Int(seconds)
    let h = s / 3600
    let m = (s % 3600) / 60
    let sec = s % 60
    if h > 0 {
        return String(format: "%d:%02d:%02d", h, m, sec)
    } else {
        return String(format: "%d:%02d", m, sec)
    }
}

/// Format a playback rate for display (e.g. "1×", "1.5×").
func formatRate(_ rate: Float) -> String {
    rate == 1.0 ? "1×" : String(format: "%.2g×", rate)
}

/// Format remaining seconds into a human-readable string (e.g. "1 hr 30 min left").
func formatRemaining(_ seconds: Double) -> String {
    let mins = Int(ceil(seconds / 60))
    if mins >= 60 {
        let h = mins / 60
        let m = mins % 60
        return m > 0 ? "\(h) hr \(m) min left" : "\(h) hr left"
    }
    return "\(mins) min left"
}
