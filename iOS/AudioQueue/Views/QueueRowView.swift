import SwiftUI

struct QueueRowView: View {
    let item: QueueItem
    var showPlayButton: Bool = true

    var body: some View {
        HStack(spacing: 14) {
            thumbnail
            info
            Spacer()
            statusBadge
        }
        .padding(.vertical, 10)
    }

    // MARK: - Thumbnail

    private var thumbnail: some View {
        ZStack {
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

            // Play button overlay
            if showPlayButton && item.isPlayable {
                Image(systemName: "play.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(.white)
                    .shadow(radius: 4)
            }
        }
        .frame(width: 72, height: 72)
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

            if let duration = item.formattedDuration {
                Text(duration)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    // MARK: - Status Badge

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
