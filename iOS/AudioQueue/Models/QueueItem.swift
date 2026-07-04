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
    /// "direct" (play audioURL as-is), "proxy" (stream via backend), or
    /// "external" (open originalURL in the source app). Optional for
    /// backwards compatibility with pre-playbackType server responses.
    var playbackType: String?
}

// MARK: - Convenience

extension QueueItem {
    var isResolved: Bool { resolveStatus == "resolved" }
    var isFailed:   Bool { resolveStatus == "failed" }
    var isPending:  Bool { resolveStatus == "pending" }
    var isUnsupported: Bool { sourceType == "unsupported" }

    /// playbackType with legacy fallback for rows resolved before the field existed
    var effectivePlaybackType: String {
        if let playbackType { return playbackType }
        return audioURL == nil ? "external" : "direct"
    }

    /// Streams through the backend relay (expiring/IP-locked sources like YouTube/X)
    var isProxied: Bool { effectivePlaybackType == "proxy" }
    var isPlayable: Bool { isResolved && audioURL != nil && effectivePlaybackType != "external" }
    /// Resolved but has no in-app audio: opens originalURL in the source app instead
    var isOpenInApp: Bool { isUnsupported || (isResolved && effectivePlaybackType == "external") }

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
        case "x":          return "🐦"
        case "soundcloud": return "☁️"
        case "podcast":    return "🎙"
        case "substack":   return "📧"
        default:           return "🎵"
        }
    }
}
