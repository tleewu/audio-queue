import Foundation

/// A saved link. Listen Notes either matched it to a podcast episode — in which
/// case `audioURL` is set and the app plays it — or it didn't, and the app opens
/// `originalURL` in a web view.
struct QueueItem: Identifiable, Codable, Equatable {
    var id: String
    var originalURL: String
    var title: String
    var publisher: String?
    var audioURL: String?
    var imageURL: String?
    var durationSeconds: Int?
    var isListened: Bool
    var position: Int
    var savedAt: Date
}

extension QueueItem {
    var isPodcast: Bool { audioURL != nil }

    var playbackURL: URL? {
        guard let audioURL else { return nil }
        return URL(string: audioURL)
    }

    var webURL: URL? { URL(string: originalURL) }

    var artworkURL: URL? {
        guard let imageURL, !imageURL.isEmpty else { return nil }
        return URL(string: imageURL)
    }

    var formattedDuration: String? {
        guard let seconds = durationSeconds, seconds > 0 else { return nil }
        return formatTime(Double(seconds))
    }
}
