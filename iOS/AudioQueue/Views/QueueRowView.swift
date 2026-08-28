import SwiftUI

/// One line in the queue: title, publisher, and how much is left. Text only.
struct QueueRowView: View {
    let item: QueueItem
    var isCurrent: Bool = false
    var isPlaying: Bool = false
    var secondsRemaining: Double? = nil
    var onPlayPause: () -> Void = {}

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.subheadline)
                    .fontWeight(isCurrent ? .semibold : .medium)
                    .foregroundStyle(isCurrent ? Color.accentColor : .primary)
                    .lineLimit(3)

                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            if item.isPodcast {
                Button(action: onPlayPause) {
                    Image(systemName: isCurrent && isPlaying ? "pause.fill" : "play.fill")
                        .font(.footnote)
                        .foregroundStyle(.white)
                        .frame(width: 30, height: 30)
                        .background(Color.accentColor)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
            } else {
                Text("Web")
                    .font(.caption2)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(Color.secondary.opacity(0.15)))
            }
        }
        .padding(.vertical, 8)
    }

    /// "Publisher · 42 min left" — whichever parts we know.
    private var subtitle: String {
        var parts: [String] = []
        if let publisher = item.publisher, !publisher.isEmpty { parts.append(publisher) }
        if let secondsRemaining {
            parts.append(formatRemaining(secondsRemaining))
        } else if let duration = item.formattedDuration {
            parts.append(duration)
        }
        return parts.joined(separator: " · ")
    }
}
