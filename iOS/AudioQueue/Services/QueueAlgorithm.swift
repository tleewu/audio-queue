import Foundation

/// Scores and sorts queue items using recency decay + wait bonus (anti-starvation).
///
/// Formula per item:
///   score = (1 - age_hours/168)   ← recency decay over 7 days
///           + min(age_hours/24, 2) ← wait bonus caps at 2 after 48 hours
///
/// Items with higher scores are played first.
enum QueueAlgorithm {
    static func sorted(_ items: [QueueItem]) -> [QueueItem] {
        items
            .filter { !$0.isListened }
            .sorted { lhs, rhs in
                // Resolved items always before pending/failed
                if lhs.isPlayable != rhs.isPlayable { return lhs.isPlayable }
                return score(lhs) > score(rhs)
            }
    }

    static func score(_ item: QueueItem) -> Double {
        let ageHours = -item.savedAt.timeIntervalSinceNow / 3600
        let recencyDecay = 1.0 - (ageHours / 168.0)
        let waitBonus = min(ageHours / 24.0, 2.0)
        return recencyDecay + waitBonus
    }
}
