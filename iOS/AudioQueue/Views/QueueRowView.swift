import SwiftUI

/// One card in the queue: artwork and title on top, then how much is left with
/// its progress, and the play control alone at the bottom right.
struct QueueRowView: View {
    let item: QueueItem
    var isCurrent: Bool = false
    var isPlaying: Bool = false
    var secondsRemaining: Double? = nil
    var onPlayPause: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                ArtworkView(url: item.artworkURL, size: 60)

                Text(item.title)
                    .font(.headline)
                    .fontWeight(isCurrent ? .bold : .semibold)
                    .foregroundStyle(.primary)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)

                Spacer(minLength: 0)
            }

            HStack(spacing: 10) {
                if let meta {
                    Text(meta)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .layoutPriority(1)
                }

                if let progress {
                    ProgressBar(fraction: progress)
                        .frame(height: 4)
                        .frame(maxWidth: 140)
                }

                Spacer(minLength: 8)

                action
            }
        }
        .padding(.vertical, 8)
    }

    // MARK: - Action

    @ViewBuilder
    private var action: some View {
        if item.isPodcast {
            Button(action: onPlayPause) {
                Image(systemName: isCurrent && isPlaying ? "pause.fill" : "play.fill")
                    .font(.subheadline)
                    .foregroundStyle(Color(.systemBackground))
                    .frame(width: 38, height: 38)
                    .background(Color.primary)
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isCurrent && isPlaying ? "Pause" : "Play")
        } else {
            Image(systemName: "arrow.up.forward")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
                .frame(width: 38, height: 38)
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
