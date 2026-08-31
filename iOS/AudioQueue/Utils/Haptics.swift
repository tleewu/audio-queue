import UIKit

/// Touch feedback for actions that change the queue. A swipe that makes a row
/// disappear should be felt as well as seen — without it the row simply blinks
/// out and the gesture reads as a glitch.
enum Haptics {
    static func light() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    static func medium() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }
}
