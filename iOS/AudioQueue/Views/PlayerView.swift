import SwiftUI

/// The footer bar. Tapping it opens the full player.
struct PlayerBar: View {
    @ObservedObject private var engine = AudioEngine.shared
    let onOpen: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(engine.currentItem?.title ?? "")
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

                Spacer(minLength: 8)

                Button { engine.skip(by: -15) } label: {
                    Image(systemName: "gobackward.15").font(.title3)
                }
                .buttonStyle(.plain)

                Button { engine.togglePlayPause() } label: {
                    Image(systemName: engine.isPlaying ? "pause.fill" : "play.fill")
                        .font(.title2)
                        .frame(width: 28)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            progressLine
        }
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .padding(.horizontal, 8)
        .padding(.bottom, 8)
        .shadow(radius: 4, y: 2)
        .contentShape(Rectangle())
        .onTapGesture(perform: onOpen)
    }

    private var progressLine: some View {
        GeometryReader { geo in
            Rectangle()
                .fill(Color.accentColor)
                .frame(width: geo.size.width * engine.progress)
        }
        .frame(height: 2)
    }
}

/// Full-screen player. Text plus transport controls — no artwork.
struct PlayerView: View {
    @ObservedObject var queueVM: QueueViewModel
    @ObservedObject private var engine = AudioEngine.shared
    @Environment(\.dismiss) private var dismiss

    private var item: QueueItem? { engine.currentItem }

    var body: some View {
        VStack(spacing: 0) {
            closeBar

            Spacer(minLength: 0)

            VStack(spacing: 8) {
                Text(item?.title ?? "")
                    .font(.title2)
                    .fontWeight(.semibold)
                    .multilineTextAlignment(.center)
                    .lineLimit(4)
                if let publisher = item?.publisher {
                    Text(publisher)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 28)

            Spacer(minLength: 0)

            progress
                .padding(.horizontal, 28)

            transport
                .padding(.top, 28)

            speedPicker
                .padding(.top, 28)

            actions
                .padding(.top, 24)
                .padding(.bottom, 32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground))
        .gesture(
            DragGesture().onEnded { value in
                if value.translation.height > 80 { dismiss() }
            }
        )
    }

    // MARK: - Sections

    private var closeBar: some View {
        HStack {
            Button { dismiss() } label: {
                Image(systemName: "chevron.down")
                    .font(.headline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text("Now Playing")
                .font(.footnote)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)
            Spacer()
            Image(systemName: "chevron.down").font(.headline).opacity(0)
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
    }

    private var progress: some View {
        VStack(spacing: 4) {
            Slider(
                value: Binding(
                    get: { engine.currentTime },
                    set: { engine.seek(to: $0) }
                ),
                in: 0...(engine.duration > 0 ? engine.duration : 1)
            )

            HStack {
                Text(formatTime(engine.currentTime))
                Spacer()
                Text(formatTime(engine.duration))
            }
            .font(.caption2)
            .monospacedDigit()
            .foregroundStyle(.secondary)
        }
    }

    private var transport: some View {
        HStack(spacing: 44) {
            Button { engine.skip(by: -15) } label: {
                Image(systemName: "gobackward.15").font(.system(size: 30))
            }
            Button { engine.togglePlayPause() } label: {
                Image(systemName: engine.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 64))
            }
            Button { engine.skip(by: 30) } label: {
                Image(systemName: "goforward.30").font(.system(size: 30))
            }
        }
        .foregroundStyle(.primary)
    }

    private var speedPicker: some View {
        HStack(spacing: 0) {
            ForEach(engine.supportedRates, id: \.self) { rate in
                let isSelected = engine.playbackRate == rate
                Button {
                    engine.setRate(rate)
                } label: {
                    Text(formatRate(rate))
                        .font(.caption)
                        .fontWeight(isSelected ? .bold : .regular)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Capsule().fill(isSelected ? Color.accentColor.opacity(0.15) : .clear))
                }
                .foregroundStyle(isSelected ? Color.accentColor : .secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
        .background(Capsule().fill(Color.secondary.opacity(0.08)))
    }

    private var actions: some View {
        HStack(spacing: 28) {
            Button("Archive") {
                guard let item else { return }
                queueVM.setListened(item, true)
                dismiss()
            }

            if let item, let url = item.webURL {
                ShareLink(item: url, subject: Text(item.title)) {
                    Text("Share")
                }
            }

            Button("Remove", role: .destructive) {
                guard let item else { return }
                queueVM.delete(item)
                engine.stop()
                dismiss()
            }
        }
        .font(.subheadline)
        .disabled(item == nil)
    }
}
