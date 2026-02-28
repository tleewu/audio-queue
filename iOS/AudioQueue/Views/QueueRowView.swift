import SwiftUI

struct QueueRowView: View {
    let item: QueueItem
    var isCurrentItem: Bool = false
    var isPlaying: Bool = false
    var progress: Double? = nil
    var secondsRemaining: Double? = nil
    var onPlayPause: (() -> Void)? = nil
    var onOpenInApp: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 14) {
            thumbnail
            info
            Spacer()
            if item.isPlayable, let onPlayPause = onPlayPause {
                Button(action: onPlayPause) {
                    Image(systemName: isCurrentItem && isPlaying ? "pause.fill" : "play.fill")
                        .font(.subheadline)
                        .foregroundStyle(.white)
                        .frame(width: 32, height: 32)
                        .background(Color.accentColor)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
            } else {
                statusBadge
            }
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .onTapGesture {
            onOpenInApp?()
        }
    }

    // MARK: - Thumbnail

    private var thumbnail: some View {
        Group {
            if let urlStr = item.thumbnailURL, let url = URL(string: urlStr) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        placeholderIcon
                    }
                }
            } else {
                placeholderIcon
            }
        }
        .frame(width: 72, height: 72)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private var placeholderIcon: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.secondary.opacity(0.15))
            Text(item.sourceEmoji)
                .font(.title2)
        }
    }

    // MARK: - Info

    private var info: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(item.title)
                .font(.subheadline)
                .fontWeight(.medium)
                .lineLimit(2)

            if let publisher = item.publisher {
                Text(publisher)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            durationOrProgress
        }
    }

    @ViewBuilder
    private var durationOrProgress: some View {
        if let progress, progress > 0, let remaining = secondsRemaining {
            HStack(spacing: 8) {
                Text(formatRemaining(remaining))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .fixedSize()
                progressCapsule(fraction: progress)
                    .frame(width: 50, height: 12)
            }
        } else if let duration = item.formattedDuration {
            Text(duration)
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }

    private func progressCapsule(fraction: Double) -> some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.secondary.opacity(0.3))
                    .frame(height: 3)
                Capsule()
                    .fill(Color.accentColor)
                    .frame(width: geo.size.width * min(fraction, 1.0), height: 3)
            }
            .frame(maxHeight: .infinity, alignment: .center)
        }
    }

    // MARK: - Helpers

    private func formatRemaining(_ seconds: Double) -> String {
        let mins = Int(ceil(seconds / 60))
        if mins >= 60 {
            let h = mins / 60
            let m = mins % 60
            return m > 0 ? "\(h) hr \(m) min left" : "\(h) hr left"
        }
        return "\(mins) min left"
    }

    @ViewBuilder
    private var statusBadge: some View {
        if item.sourceType == "youtube" && item.audioURL == nil && item.isResolved {
            Image(systemName: "play.rectangle")
                .foregroundStyle(.red)
                .font(.caption)
        } else if item.isUnsupported {
            Image(systemName: "safari")
                .foregroundStyle(.blue)
                .font(.caption)
        } else {
            switch item.resolveStatus {
            case "pending":
                ProgressView()
                    .scaleEffect(0.7)
            case "failed":
                Image(systemName: "exclamationmark.triangle")
                    .foregroundStyle(.orange)
                    .font(.caption)
            default:
                EmptyView()
            }
        }
    }
}
