import Foundation

struct QueueItem: Identifiable, Codable, Equatable {
    var id: String
    var originalURL: String
    var title: String
    var sourceType: String
    var audioURL: String?
    var durationSeconds: Int?
    var savedAt: Date
    var position: Int
    var isListened: Bool
    var thumbnailURL: String?
    var publisher: String?
    var resolveStatus: String
    var resolveError: String?
}

// MARK: - Convenience

extension QueueItem {
    var isResolved: Bool { resolveStatus == "resolved" }
    var isFailed:   Bool { resolveStatus == "failed" }
    var isPending:  Bool { resolveStatus == "pending" }
    var isPlayable: Bool { isResolved && audioURL != nil }
    var isUnsupported: Bool { sourceType == "unsupported" }
    /// YouTube items with no RSS audio match: resolved but opens in YouTube app instead of playing in-app
    var isOpenInApp: Bool { isUnsupported || (sourceType == "youtube" && audioURL == nil) }

    var formattedDuration: String? {
        guard let secs = durationSeconds, secs > 0 else { return nil }
        let h = secs / 3600
        let m = (secs % 3600) / 60
        let s = secs % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, s)
        } else {
            return String(format: "%d:%02d", m, s)
        }
    }

    var sourceEmoji: String {
        switch sourceType {
        case "youtube":    return "▶️"
        case "soundcloud": return "☁️"
        case "podcast":    return "🎙"
        case "substack":   return "📧"
        default:           return "🎵"
        }
    }
}
