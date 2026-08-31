import SwiftUI

/// One row in the queue: artwork, title, and how much is left underneath it,
/// with the play control on the right in line with the artwork.
struct QueueRowView: View {
    let item: QueueItem
    var isCurrent: Bool = false
    var isPlaying: Bool = false
    var secondsRemaining: Double? = nil
    var isLoading: Bool = false
    var onPlayPause: () -> Void = {}

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            ArtworkView(url: item.artworkURL, size: 56)

            VStack(alignment: .leading, spacing: 6) {
                Text(item.title)
                    .font(.subheadline)
                    .fontWeight(isCurrent ? .semibold : .medium)
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 8) {
                    if let meta {
                        Text(meta)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .layoutPriority(1)
                    }

                    if let progress {
                        ProgressBar(fraction: progress)
                            .frame(height: 3)
                            .frame(maxWidth: 96)
                    }
                }
            }

            Spacer(minLength: 8)

            action
        }
        .padding(.vertical, 8)
    }

    // MARK: - Action

    @ViewBuilder
    private var action: some View {
        if item.isPodcast {
            Button(action: onPlayPause) {
                Group {
                    if isCurrent && isLoading {
                        ProgressView()
                            .controlSize(.small)
                            .tint(Color(.systemBackground))
                    } else {
                        Image(systemName: isCurrent && isPlaying ? "pause.fill" : "play.fill")
                            .font(.footnote)
                            .foregroundStyle(Color(.systemBackground))
                    }
                }
                .frame(width: 34, height: 34)
                .background(Color.primary)
                .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isCurrent && isPlaying ? "Pause" : "Play")
        } else {
            Image(systemName: "arrow.up.forward")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.primary)
                .frame(width: 34, height: 34)
                .overlay(Circle().strokeBorder(Color.primary.opacity(0.25), lineWidth: 1))
                .accessibilityLabel("Opens in a web view")
        }
    }

    // MARK: - Meta

    /// "7 min left" once started, otherwise the run time, otherwise the show.
    private var meta: String? {
        if let secondsRemaining { return formatRemaining(secondsRemaining) }
        if let total = item.durationSeconds, total > 0 { return formatRunTime(Double(total)) }
        guard let publisher = item.publisher, !publisher.isEmpty else { return nil }
        return publisher
    }

    /// Only present once playback has actually started.
    private var progress: Double? {
        guard
            let total = item.durationSeconds, total > 0,
            let secondsRemaining
        else { return nil }
        let played = (Double(total) - secondsRemaining) / Double(total)
        guard played > 0 else { return nil }
        return min(max(played, 0), 1)
    }
}

/// Monochrome play-progress track.
private struct ProgressBar: View {
    let fraction: Double

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.secondary.opacity(0.25))
                Capsule()
                    .fill(Color.primary)
                    .frame(width: geo.size.width * fraction)
            }
        }
        .accessibilityHidden(true)
    }
}
