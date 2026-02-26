import SwiftUI

struct QueueRowView: View {
    let item: QueueItem

    var body: some View {
        HStack(spacing: 12) {
            thumbnail
            info
            Spacer()
            statusBadge
        }
        .padding(.vertical, 6)
        .opacity(item.isListened ? 0.4 : 1.0)
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
        .frame(width: 56, height: 56)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var placeholderIcon: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
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
