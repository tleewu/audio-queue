import AVFoundation
import Combine
import MediaPlayer

/// The single AVPlayer for the app. Owns the audio session, the lock-screen
/// controls, the play order, and playback-position memory.
@MainActor
final class AudioEngine: ObservableObject {
    static let shared = AudioEngine()

    // MARK: - Published State

    @Published private(set) var currentItem: QueueItem?
    @Published private(set) var isPlaying = false
    @Published private(set) var currentTime: Double = 0
    @Published private(set) var duration: Double = 0
    @Published private(set) var playbackRate: Float = 1.0

    let supportedRates: [Float] = [0.75, 1.0, 1.25, 1.5, 2.0]

    /// Fraction of the current item played, 0...1.
    var progress: Double {
        guard duration > 0 else { return 0 }
        return min(1, max(0, currentTime / duration))
    }

    // MARK: - Private

    private let player = AVPlayer()
    /// Items played automatically after the current one finishes.
    private var upNext: [QueueItem] = []
    private var timeObserver: Any?
    private var itemEndObserver: NSObjectProtocol?
    private var lastPositionSave: Date = .distantPast
    /// Lock-screen artwork, kept so rebuilding the info dictionary — which
    /// happens on every play, pause and seek — does not drop the image or
    /// refetch it. Keyed by url so a track change invalidates it.
    private var artwork: (url: URL, image: MPMediaItemArtwork)?
    private var artworkTask: Task<Void, Never>?

    private static let positionKey = "playbackPositions"
    /// The footer stays on the last thing played, across launches.
    private static let lastItemKey = "lastPlayedItem"

    private init() {
        player.automaticallyWaitsToMinimizeStalling = false
        setupAudioSession()
        setupRemoteCommands()
        setupTimeObserver()
        setupItemEndObserver()
        restoreLastPlayed()
    }

    // MARK: - Playback

    /// Plays `item`, then continues through `upNext` as each track ends.
    func play(_ item: QueueItem, upNext: [QueueItem] = []) {
        guard let url = item.playbackURL else { return }

        savePositionNow()
        self.upNext = upNext
        currentItem = item
        rememberLastPlayed(item)
        duration = Double(item.durationSeconds ?? 0)
        isPlaying = true
        lastPositionSave = Date()

        player.replaceCurrentItem(with: AVPlayerItem(url: url))
        player.playImmediately(atRate: playbackRate)

        let resumeAt = savedPosition(for: item.id) ?? 0
        currentTime = resumeAt
        if resumeAt > 0 {
            player.seek(to: CMTime(seconds: resumeAt, preferredTimescale: 600),
                        toleranceBefore: .zero, toleranceAfter: .zero)
        }

        observeDuration()
        updateNowPlaying()
    }

    func togglePlayPause() {
        isPlaying ? pause() : resume()
    }

    func pause() {
        player.pause()
        isPlaying = false
        savePositionNow()
        updateNowPlaying()
    }

    func resume() {
        player.play()
        player.rate = playbackRate
        isPlaying = true
        updateNowPlaying()
    }

    func seek(to seconds: Double) {
        let target = max(0, seconds)
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600),
                    toleranceBefore: .zero, toleranceAfter: .zero)
        currentTime = target
        updateNowPlaying()
    }

    func skip(by seconds: Double) {
        seek(to: currentTime + seconds)
    }

    func setRate(_ rate: Float) {
        playbackRate = rate
        if isPlaying { player.rate = rate }
        updateNowPlaying()
    }

    /// Stops playback and dismisses the player bar entirely. Only for when the
    /// item is gone — ordinary end-of-queue keeps the footer, see finish().
    func stop() {
        savePositionNow()
        UserDefaults.standard.removeObject(forKey: Self.lastItemKey)
        player.replaceCurrentItem(with: nil)
        upNext = []
        currentItem = nil
        currentTime = 0
        duration = 0
        isPlaying = false
        updateNowPlaying()
    }

    // MARK: - Setup

    private func setupAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .spokenAudio, options: [.allowBluetoothA2DP, .allowAirPlay])
            try session.setActive(true)
        } catch {
            try? session.setCategory(.playback)
            try? session.setActive(true)
        }
    }

    private func setupRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.resume() }
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.pause() }
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.togglePlayPause() }
            return .success
        }

        // Skip buttons instead of next/previous track in Control Center
        center.nextTrackCommand.isEnabled = false
        center.previousTrackCommand.isEnabled = false

        center.skipBackwardCommand.preferredIntervals = [15]
        center.skipBackwardCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.skip(by: -15) }
            return .success
        }
        center.skipForwardCommand.preferredIntervals = [30]
        center.skipForwardCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.skip(by: 30) }
            return .success
        }
    }

    private func setupTimeObserver() {
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.5, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            guard let self, time.seconds.isFinite else { return }
            MainActor.assumeIsolated {
                self.currentTime = time.seconds
                self.updateNowPlayingTime()
                self.savePositionThrottled()
            }
        }
    }

    private func setupItemEndObserver() {
        itemEndObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.advance() }
        }
    }

    /// AVPlayer reports the real duration once the asset loads; podcast feeds
    /// often disagree with it by a few seconds.
    private func observeDuration() {
        guard let playerItem = player.currentItem else { return }
        Task { [weak self] in
            for await status in playerItem.publisher(for: \.status).values where status != .unknown {
                guard let self, status == .readyToPlay else { return }
                let seconds = playerItem.duration.seconds
                if seconds.isFinite, seconds > 0 {
                    self.duration = seconds
                    self.updateNowPlaying()
                }
                return
            }
        }
    }

    /// Called when a track finishes: clear its saved position and start the next.
    private func advance() {
        if let finished = currentItem { clearPosition(for: finished.id) }
        currentTime = 0

        guard !upNext.isEmpty else {
            finish()
            return
        }
        let next = upNext.removeFirst()
        play(next, upNext: upNext)
    }

    /// Playback ran out with nothing queued behind it. Come to rest at the
    /// start but keep currentItem, so the footer still offers the last thing
    /// played instead of vanishing.
    private func finish() {
        player.replaceCurrentItem(with: nil)
        upNext = []
        currentTime = 0
        isPlaying = false
        updateNowPlaying()
    }

    /// Drops the footer when the item behind it leaves the queue.
    func forget(_ itemId: String) {
        guard currentItem?.id == itemId else { return }
        stop()
    }

    // MARK: - Last Played

    private func rememberLastPlayed(_ item: QueueItem) {
        guard let data = try? JSONEncoder().encode(item) else { return }
        UserDefaults.standard.set(data, forKey: Self.lastItemKey)
    }

    /// Restores the footer on launch, paused at wherever it was left. Now
    /// Playing is deliberately not published here — nothing is loaded yet, so
    /// the lock screen should stay empty until the user actually starts it.
    private func restoreLastPlayed() {
        guard
            let data = UserDefaults.standard.data(forKey: Self.lastItemKey),
            let item = try? JSONDecoder().decode(QueueItem.self, from: data)
        else { return }
        currentItem = item
        duration = Double(item.durationSeconds ?? 0)
        currentTime = savedPosition(for: item.id) ?? 0
        isPlaying = false
    }

    // MARK: - Now Playing

    private func updateNowPlaying() {
        guard let item = currentItem else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }

        var info: [String: Any] = [
            MPMediaItemPropertyTitle: item.title,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? playbackRate : 0.0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: playbackRate,
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: currentTime,
        ]
        if let publisher = item.publisher {
            info[MPMediaItemPropertyArtist] = publisher
        }
        if let artwork, artwork.url == item.artworkURL {
            info[MPMediaItemPropertyArtwork] = artwork.image
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info

        loadArtworkIfNeeded(for: item)
    }

    /// Fetches the episode image once per item and re-publishes the info
    /// dictionary with it. No-ops when it is already loaded or unavailable.
    private func loadArtworkIfNeeded(for item: QueueItem) {
        guard let url = item.artworkURL else {
            artworkTask?.cancel()
            artwork = nil
            return
        }
        guard artwork?.url != url else { return }

        artworkTask?.cancel()
        artworkTask = Task { [weak self] in
            guard
                let (data, _) = try? await URLSession.shared.data(from: url),
                let image = UIImage(data: data),
                !Task.isCancelled
            else { return }

            await MainActor.run {
                guard let self else { return }
                // The track may have moved on while this was in flight.
                guard self.currentItem?.artworkURL == url else { return }
                self.artwork = (
                    url,
                    MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                )
                self.updateNowPlaying()
            }
        }
    }

    private func updateNowPlayingTime() {
        guard var info = MPNowPlayingInfoCenter.default().nowPlayingInfo else { return }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentTime
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    // MARK: - Position Memory

    private func savePositionThrottled() {
        guard Date().timeIntervalSince(lastPositionSave) >= 5 else { return }
        savePositionNow()
    }

    private func savePositionNow() {
        guard let id = currentItem?.id, currentTime > 0 else { return }
        lastPositionSave = Date()
        var positions = UserDefaults.standard.dictionary(forKey: Self.positionKey) as? [String: Double] ?? [:]
        positions[id] = currentTime
        UserDefaults.standard.set(positions, forKey: Self.positionKey)
    }

    func savedPosition(for itemId: String) -> Double? {
        (UserDefaults.standard.dictionary(forKey: Self.positionKey) as? [String: Double])?[itemId]
    }

    private func clearPosition(for itemId: String) {
        var positions = UserDefaults.standard.dictionary(forKey: Self.positionKey) as? [String: Double] ?? [:]
        positions.removeValue(forKey: itemId)
        UserDefaults.standard.set(positions, forKey: Self.positionKey)
    }
}
