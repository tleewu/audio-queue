import SwiftUI

/// Episode artwork, with a placeholder that keeps the layout stable while the
/// image loads and when an item has none. Monochrome like the rest of the app —
/// the artwork is the only colour on screen, which is the point.
struct ArtworkView: View {
    let url: URL?
    var size: CGFloat
    var cornerRadius: CGFloat = 6

    var body: some View {
        Group {
            if let url {
                AsyncImage(url: url, transaction: Transaction(animation: .easeInOut(duration: 0.2))) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().aspectRatio(contentMode: .fill)
                    case .empty:
                        placeholder
                    case .failure:
                        placeholder
                    @unknown default:
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.12), lineWidth: 0.5)
        )
        .accessibilityHidden(true)
    }

    private var placeholder: some View {
        Color.secondary.opacity(0.12)
    }
}
