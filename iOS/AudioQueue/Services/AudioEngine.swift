import AVFoundation
import MediaPlayer
import Combine

/// Notification posted when the current track ends naturally.
extension Notification.Name {
    static let audioEngineNextTrack = Notification.Name("audioEngineNextTrack")
}

/// Single AVPlayer instance that handles all audio playback.
/// Owns the AVAudioSession, MPRemoteCommandCenter, and NowPlayingInfo.
@MainActor
final class AudioEngine: ObservableObject {
    static let shared = AudioEngine()

    // MARK: - Published State

    @Published var isPlaying = false
    @Published var currentItem: QueueItem?
    @Published var currentTime: Double = 0      // seconds
    @Published var duration: Double = 0         // seconds
    @Published var playbackRate: Float = 1.0

    // MARK: - Private

    private let player = AVPlayer()
    private var timeObserver: Any?
    private var itemEndObserver: NSObjectProtocol?
    private var cancellables = Set<AnyCancellable>()
    private var lastPositionSave: Date = .distantPast

    private static let positionKey = "playbackPositions"

    let supportedRates: [Float] = [0.75, 1.0, 1.25, 1.5, 2.0]

    // MARK: - Init

    private init() {
        player.automaticallyWaitsToMinimizeStalling = false
        setupAudioSession()
        setupRemoteCommands()
        setupTimeObserver()
        setupItemEndObserver()
    }

    // MARK: - Public API

    func play(item: QueueItem) {
        guard let urlString = item.audioURL, let url = URL(string: urlString) else {
            print("AudioEngine: no audioURL on item \(item.title)")
            return
        }

        savePositionNow()
        let savedPos = savedPosition(for: item.id)
        print("AudioEngine: loading \(url.absoluteString) savedPos=\(savedPos ?? 0)")
        let playerItem = AVPlayerItem(url: url)
        player.replaceCurrentItem(with: playerItem)
        player.playImmediately(atRate: playbackRate)
        currentItem = item
        isPlaying = true
        lastPositionSave = Date()
        if let secs = item.durationSeconds, secs > 0 {
            duration = Double(secs)
        } else {
            duration = 0
        }

        // Seek to saved position immediately (AVPlayer queues it internally)
        if let savedPos, savedPos > 0 {
            currentTime = savedPos
            let target = CMTime(seconds: savedPos, preferredTimescale: 600)
            player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] finished in
                guard let self, finished else { return }
                print("AudioEngine: restored to \(savedPos)s (immediate seek)")
            }
        }

        // Log status transitions and errors
        Task {
            for await status in playerItem.publisher(for: \.status).values {
                if status == .readyToPlay {
                    print("AudioEngine: readyToPlay duration=\(playerItem.duration.seconds)s")
                    let secs = playerItem.duration.seconds
                    await MainActor.run {
                        if secs.isFinite && secs > 0 {
                            self.duration = secs
                        }
                        self.updateNowPlaying()
                    }
                    break
                } else if status == .failed {
                    let err = playerItem.error as NSError?
                    print("AudioEngine: FAILED url=\(url.absoluteString) error=\(err?.localizedDescription ?? "nil") code=\(err?.code ?? -1) domain=\(err?.domain ?? "nil")")
                    break
                }
            }
        }

        // Log why AVPlayer is waiting (buffering vs error)
        Task {
            for await tcs in player.publisher(for: \.timeControlStatus).values {
                switch tcs {
                case .playing:
                    print("AudioEngine: timeControlStatus=playing")
                    return
                case .waitingToPlayAtSpecifiedRate:
                    print("AudioEngine: timeControlStatus=waiting reason=\(player.reasonForWaitingToPlay?.rawValue ?? "nil")")
                case .paused:
                    print("AudioEngine: timeControlStatus=paused")
                @unknown default:
                    break
                }
            }
        }

        updateNowPlaying()
    }

    func togglePlayPause() {
        if isPlaying {
            player.pause()
        } else {
            player.play()
            player.rate = playbackRate
        }
        isPlaying.toggle()
        updateNowPlaying()
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
        let time = CMTime(seconds: seconds, preferredTimescale: 600)
        player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero)
        currentTime = seconds
        updateNowPlaying()
    }

    func skip(by seconds: Double) {
        let target = max(0, currentTime + seconds)
        seek(to: target)
    }

    func setRate(_ rate: Float) {
        playbackRate = rate
        if isPlaying {
            player.rate = rate
        }
        updateNowPlaying()
    }

    /// Clears the current item and stops playback (e.g. when removing from queue).
    func clearCurrentItem() {
        savePositionNow()
        player.replaceCurrentItem(with: nil)
        currentItem = nil
        currentTime = 0
        duration = 0
        isPlaying = false
        updateNowPlaying()
    }

    // MARK: - Audio Session

    private func setupAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .spokenAudio, options: [.allowBluetoothA2DP, .allowAirPlay])
            try session.setActive(true)
            print("AudioEngine: AVAudioSession active (full)")
        } catch {
            print("AudioEngine: full session setup failed (\(error)), retrying minimal")
            do {
                try session.setCategory(.playback)
                try session.setActive(true)
                print("AudioEngine: AVAudioSession active (minimal)")
            } catch {
                print("AudioEngine: AVAudioSession setup completely failed: \(error)")
            }
        }
    }

    // MARK: - Remote Commands (Lock Screen)

    private func setupRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.addTarget { [weak self] _ in
            self?.resume()
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            self?.pause()
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.togglePlayPause()
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            NotificationCenter.default.post(name: .audioEngineNextTrack, object: nil)
            return .success
        }
        center.skipBackwardCommand.preferredIntervals = [15]
        center.skipBackwardCommand.addTarget { [weak self] _ in
            self?.skip(by: -15)
            return .success
        }
        center.skipForwardCommand.preferredIntervals = [30]
        center.skipForwardCommand.addTarget { [weak self] _ in
            self?.skip(by: 30)
            return .success
        }
    }

    // MARK: - Time Observer

    private func setupTimeObserver() {
        let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            guard let self else { return }
            let secs = time.seconds
            if secs.isFinite {
                self.currentTime = secs
                self.updateNowPlayingTime()
                self.savePositionThrottled()
            }
        }
    }

    // MARK: - Item End Observer

    private func setupItemEndObserver() {
        itemEndObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            if let id = self?.currentItem?.id {
                self?.clearPosition(for: id)
            }
            self?.isPlaying = false
            self?.currentTime = 0
            NotificationCenter.default.post(name: .audioEngineNextTrack, object: nil)
        }
    }

    // MARK: - Now Playing Info

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

        if let thumbnailURL = item.thumbnailURL, let url = URL(string: thumbnailURL) {
            Task {
                if let (data, _) = try? await URLSession.shared.data(from: url),
                   let image = UIImage(data: data) {
                    let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                    var updatedInfo = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? info
                    updatedInfo[MPMediaItemPropertyArtwork] = artwork
                    MPNowPlayingInfoCenter.default().nowPlayingInfo = updatedInfo
                }
            }
        }

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func updateNowPlayingTime() {
        guard var info = MPNowPlayingInfoCenter.default().nowPlayingInfo else { return }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentTime
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    // MARK: - Position Persistence

    private func savePositionThrottled() {
        let now = Date()
        guard now.timeIntervalSince(lastPositionSave) >= 5 else { return }
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
        let positions = UserDefaults.standard.dictionary(forKey: Self.positionKey) as? [String: Double]
        return positions?[itemId]
    }

    private func clearPosition(for itemId: String) {
        var positions = UserDefaults.standard.dictionary(forKey: Self.positionKey) as? [String: Double] ?? [:]
        positions.removeValue(forKey: itemId)
        UserDefaults.standard.set(positions, forKey: Self.positionKey)
    }
}
