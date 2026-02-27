import SwiftUI

struct PlayerView: View {
    @ObservedObject var playerVM: PlayerViewModel
    @ObservedObject var queueVM: QueueViewModel

    @State private var isExpanded = false
    @GestureState private var dragOffset: CGFloat = 0

    private var engine: AudioEngine { playerVM.engine }

    var body: some View {
        if isExpanded {
            expandedPlayer
        } else {
            miniPlayer
        }
    }

    // MARK: - Mini Player

    private var miniPlayer: some View {
        HStack(spacing: 12) {
            miniThumbnail

            VStack(alignment: .leading, spacing: 2) {
                Text(engine.currentItem?.title ?? "Nothing playing")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(1)
                if let publisher = engine.currentItem?.publisher {
                    Text(publisher)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer()

            Button {
                engine.skip(by: -15)
            } label: {
                Image(systemName: "gobackward.15")
                    .font(.title3)
            }

            Button {
                engine.togglePlayPause()
            } label: {
                Image(systemName: engine.isPlaying ? "pause.fill" : "play.fill")
                    .font(.title2)
            }

            Button {
                engine.skip(by: 30)
            } label: {
                Image(systemName: "goforward.30")
                    .font(.title3)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .padding(.horizontal, 8)
        .padding(.bottom, 8)
        .shadow(radius: 4, y: 2)
        .onTapGesture { isExpanded = true }
    }

    // MARK: - Expanded Player

    private var expandedPlayer: some View {
        VStack(spacing: 0) {
            // Drag handle
            Capsule()
                .fill(Color.secondary.opacity(0.4))
                .frame(width: 40, height: 5)
                .padding(.top, 12)
                .padding(.bottom, 20)

            // Artwork
            expandedArtwork
                .padding(.horizontal, 32)
                .padding(.bottom, 28)

            // Title + publisher
            VStack(spacing: 4) {
                Text(engine.currentItem?.title ?? "")
                    .font(.title3)
                    .fontWeight(.semibold)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)

                if let publisher = engine.currentItem?.publisher {
                    Text(publisher)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)

            // Progress bar
            progressBar
                .padding(.horizontal, 24)
                .padding(.bottom, 20)

            // Transport controls
            transportControls
                .padding(.bottom, 24)

            // Speed picker
            speedPicker
                .padding(.bottom, 32)
        }
        .frame(maxWidth: .infinity)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .padding(.horizontal, 4)
        .shadow(radius: 12, y: -4)
        .gesture(
            DragGesture()
                .onEnded { value in
                    if value.translation.height > 60 { isExpanded = false }
                }
        )
    }

    // MARK: - Artwork

    private var miniThumbnail: some View {
        Group {
            if let urlStr = engine.currentItem?.thumbnailURL, let url = URL(string: urlStr) {
                AsyncImage(url: url) { phase in
                    if case .success(let img) = phase { img.resizable().scaledToFill() }
                    else { placeholderBox }
                }
            } else {
                placeholderBox
            }
        }
        .frame(width: 40, height: 40)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private var expandedArtwork: some View {
        Group {
            if let urlStr = engine.currentItem?.thumbnailURL, let url = URL(string: urlStr) {
                AsyncImage(url: url) { phase in
                    if case .success(let img) = phase {
                        img.resizable().scaledToFit()
                    } else {
                        placeholderBox
                    }
                }
            } else {
                placeholderBox
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(radius: 16, y: 8)
    }

    private var placeholderBox: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.secondary.opacity(0.15))
            Text(engine.currentItem?.sourceEmoji ?? "🎵")
                .font(.largeTitle)
        }
    }

    // MARK: - Progress Bar

    private var progressBar: some View {
        VStack(spacing: 6) {
            Slider(
                value: Binding(
                    get: { engine.currentTime },
                    set: { engine.seek(to: $0) }
                ),
                in: 0...(engine.duration > 0 ? engine.duration : 1)
            )

            HStack {
                Text(formatTime(engine.currentTime))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                Spacer()
                Text(formatTime(engine.duration))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
        }
    }

    // MARK: - Transport Controls

    private var transportControls: some View {
        HStack(spacing: 40) {
            Button { engine.skip(by: -15) } label: {
                Image(systemName: "gobackward.15")
                    .font(.system(size: 28))
            }

            Button { engine.togglePlayPause() } label: {
                Image(systemName: engine.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 60))
            }

            Button { engine.skip(by: 30) } label: {
                Image(systemName: "goforward.30")
                    .font(.system(size: 28))
            }
        }
        .foregroundStyle(.primary)
    }

    // MARK: - Speed Picker

    private var speedPicker: some View {
        HStack(spacing: 0) {
            ForEach(engine.supportedRates, id: \.self) { rate in
                Button {
                    engine.setRate(rate)
                } label: {
                    speedRateLabel(rate)
                }
                .foregroundStyle(engine.playbackRate == rate ? Color.accentColor : .secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
        .background(Color.secondary.opacity(0.08))
        .clipShape(Capsule())
    }

    private func speedRateLabel(_ rate: Float) -> some View {
        let isSelected = engine.playbackRate == rate
        let bg: Color = isSelected ? Color.accentColor.opacity(0.15) : Color.clear
        return Text(formatRate(rate))
            .font(.caption)
            .fontWeight(isSelected ? .bold : .regular)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(bg)
            .clipShape(Capsule())
    }

    // MARK: - Helpers

    private func formatTime(_ seconds: Double) -> String {
        guard seconds.isFinite && seconds > 0 else { return "0:00" }
        let s = Int(seconds)
        let h = s / 3600
        let m = (s % 3600) / 60
        let sec = s % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, sec)
        } else {
            return String(format: "%d:%02d", m, sec)
        }
    }

    private func formatRate(_ rate: Float) -> String {
        rate == 1.0 ? "1×" : String(format: "%.2g×", rate)
    }
}
