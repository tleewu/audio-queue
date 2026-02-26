import Foundation
import SwiftData

@Model
final class QueueItem {
    @Attribute(.unique) var id: UUID
    var url: String
    var title: String
    var sourceType: String      // "podcast" | "youtube" | "soundcloud" | "substack" | "other" | "unknown"
    var audioURL: String?       // direct stream URL — nil until resolved
    var durationSeconds: Int?
    var savedAt: Date
    var position: Int           // for manual reordering
    var isListened: Bool
    var thumbnailURL: String?
    var publisher: String?
    var resolveStatus: String   // "pending" | "resolved" | "failed"
    var resolveError: String?

    init(
        url: String,
        title: String = "",
        position: Int = 0
    ) {
        self.id = UUID()
        self.url = url
        self.title = title.isEmpty ? url : title
        self.sourceType = "unknown"
        self.audioURL = nil
        self.durationSeconds = nil
        self.savedAt = Date()
        self.position = position
        self.isListened = false
        self.thumbnailURL = nil
        self.publisher = nil
        self.resolveStatus = "pending"
        self.resolveError = nil
    }
}

// MARK: - Convenience

extension QueueItem {
    var isResolved: Bool { resolveStatus == "resolved" }
    var isFailed: Bool   { resolveStatus == "failed" }
    var isPending: Bool  { resolveStatus == "pending" }
    var isPlayable: Bool { isResolved && audioURL != nil }

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
