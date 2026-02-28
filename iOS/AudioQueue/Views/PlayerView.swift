import SwiftUI

struct PlayerView: View {
    @ObservedObject var playerVM: PlayerViewModel
    @ObservedObject var queueVM: QueueViewModel

    @State private var isExpanded = false
    @GestureState private var dragOffset: CGFloat = 0
    @State private var showAddedToQueueFeedback = false
    @State private var isDownloading = false
    @State private var downloadMessage: String? = nil

    private var engine: AudioEngine { playerVM.engine }
    private var currentItem: QueueItem? { engine.currentItem }

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
                .padding(.bottom, 16)

            // Skip controls (small)
            skipControls
                .padding(.bottom, 20)

            // Spotify-style action row (+ download share more play)
            actionRow
                .padding(.horizontal, 24)
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

    // MARK: - Skip Controls

    private var skipControls: some View {
        HStack(spacing: 40) {
            Button { engine.skip(by: -15) } label: {
                Image(systemName: "gobackward.15")
                    .font(.system(size: 22))
            }
            Button { engine.skip(by: 30) } label: {
                Image(systemName: "goforward.30")
                    .font(.system(size: 22))
            }
        }
        .foregroundStyle(.primary)
    }

    // MARK: - Spotify-style Action Row

    private var actionRow: some View {
        HStack(spacing: 0) {
            Button { addCurrentToQueue() } label: {
                Image(systemName: "plus.circle")
                    .font(.system(size: 28))
            }
            .disabled(currentItem == nil)

            Spacer()

            Button { downloadCurrent() } label: {
                ZStack {
                    Image(systemName: "arrow.down.circle")
                        .font(.system(size: 28))
                    if isDownloading {
                        ProgressView()
                            .scaleEffect(0.7)
                    }
                }
                .frame(width: 32, height: 32)
            }
            .disabled(currentItem == nil || currentItem?.audioURL == nil || isDownloading)

            Spacer()

            shareButton

            Spacer()

            Menu {
                Button { addCurrentToQueue() } label: {
                    Label("Add to queue", systemImage: "plus.circle")
                }
                .disabled(currentItem == nil)

                Button { downloadCurrent() } label: {
                    Label("Download", systemImage: "arrow.down.circle")
                }
                .disabled(currentItem == nil || currentItem?.audioURL == nil || isDownloading)

                if let item = currentItem, let url = URL(string: item.originalURL) {
                    ShareLink(item: url, subject: Text(item.title), message: Text(item.publisher ?? "")) {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }
                }

                Divider()

                Button(role: .destructive) { removeCurrentFromQueue() } label: {
                    Label("Remove from queue", systemImage: "trash")
                }
                .disabled(currentItem == nil)

                if let item = currentItem {
                    if item.isListened {
                        Button { queueVM.markUnlistened(item) } label: {
                            Label("Mark as unlistened", systemImage: "arrow.uturn.backward")
                        }
                    } else {
                        Button { queueVM.markListened(item) } label: {
                            Label("Mark as listened", systemImage: "checkmark.circle")
                        }
                    }
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 24, weight: .semibold))
            }

            Spacer()

            Button { engine.togglePlayPause() } label: {
                Image(systemName: engine.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 56))
            }
        }
        .foregroundStyle(.primary)
        .alert("Download", isPresented: Binding(
            get: { downloadMessage != nil },
            set: { if !$0 { downloadMessage = nil } }
        )) {
            Button("OK") { downloadMessage = nil }
        } message: {
            if let msg = downloadMessage { Text(msg) }
        }
        .overlay(alignment: .top) {
            if showAddedToQueueFeedback {
                Text("Added to queue")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.regularMaterial)
                    .clipShape(Capsule())
                    .transition(.opacity.combined(with: .scale(scale: 0.9)))
            }
        }
        .animation(.easeOut(duration: 0.2), value: showAddedToQueueFeedback)
        .task(id: showAddedToQueueFeedback) {
            guard showAddedToQueueFeedback else { return }
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            showAddedToQueueFeedback = false
        }
    }

    @ViewBuilder
    private var shareButton: some View {
        if let item = currentItem, let url = URL(string: item.originalURL) {
            ShareLink(item: url, subject: Text(item.title), message: Text(item.publisher ?? "")) {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 26))
            }
        } else {
            Image(systemName: "square.and.arrow.up")
                .font(.system(size: 26))
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Action Handlers

    private func addCurrentToQueue() {
        guard let item = currentItem else { return }
        Task {
            await queueVM.addURL(item.originalURL)
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(.success)
            showAddedToQueueFeedback = true
        }
    }

    private func downloadCurrent() {
        guard let item = currentItem, let audioURLString = item.audioURL, let url = URL(string: audioURLString) else { return }
        isDownloading = true
        Task {
            do {
                let (location, _) = try await URLSession.shared.download(from: url)
                let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
                let downloads = docs.appendingPathComponent("Downloads", isDirectory: true)
                try FileManager.default.createDirectory(at: downloads, withIntermediateDirectories: true)
                let safeTitle = item.title
                    .components(separatedBy: .punctuationCharacters)
                    .joined()
                    .components(separatedBy: .whitespaces)
                    .filter { !$0.isEmpty }
                    .prefix(4)
                    .joined(separator: "_")
                let ext = (url.pathExtension as String).isEmpty ? "mp3" : url.pathExtension
                let dest = downloads.appendingPathComponent("\(safeTitle).\(ext)")
                if FileManager.default.fileExists(atPath: dest.path) {
                    try FileManager.default.removeItem(at: dest)
                }
                try FileManager.default.moveItem(at: location, to: dest)
                await MainActor.run {
                    isDownloading = false
                    downloadMessage = "Saved to Downloads folder"
                }
            } catch {
                await MainActor.run {
                    isDownloading = false
                    downloadMessage = "Download failed: \(error.localizedDescription)"
                }
            }
        }
    }

    private func removeCurrentFromQueue() {
        guard let item = currentItem else { return }
        queueVM.delete(item)
        engine.clearCurrentItem()
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
