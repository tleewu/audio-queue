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

    let supportedRates: [Float] = [0.75, 1.0, 1.25, 1.5, 2.0]

    // MARK: - Init

    private init() {
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

        let playerItem = AVPlayerItem(url: url)
        player.replaceCurrentItem(with: playerItem)
        player.rate = playbackRate
        currentItem = item
        isPlaying = true

        // Read actual duration once it's known
        Task {
            for await status in playerItem.publisher(for: \.status).values {
                if status == .readyToPlay {
                    let secs = playerItem.duration.seconds
                    if secs.isFinite && secs > 0 {
                        await MainActor.run { self.duration = secs }
                    }
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

    // MARK: - Audio Session

    private func setupAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio, options: [.allowBluetooth, .allowAirPlay])
            try session.setActive(true)
        } catch {
            print("AudioEngine: AVAudioSession setup failed: \(error)")
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
}
