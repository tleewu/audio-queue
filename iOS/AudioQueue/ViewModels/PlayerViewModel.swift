import Foundation
import Combine

/// Bridges the QueueViewModel (queue order) with AudioEngine (playback).
/// Handles next-track advancement and YouTube re-resolution at play time.
@MainActor
final class PlayerViewModel: ObservableObject {
    @Published var currentIndex: Int = 0
    @Published var isExpanded = false

    private var nextTrackObserver: NSObjectProtocol?
    private var cancellables = Set<AnyCancellable>()

    let engine = AudioEngine.shared

    init() {
        nextTrackObserver = NotificationCenter.default.addObserver(
            forName: .audioEngineNextTrack,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.advanceToNext()
            }
        }
    }

    deinit {
        if let obs = nextTrackObserver {
            NotificationCenter.default.removeObserver(obs)
        }
    }

    // MARK: - Playback Control

    func playQueue(_ queue: [QueueItem], queueVM: QueueViewModel) async {
        guard !queue.isEmpty else { return }
        currentIndex = 0
        await playItem(queue[currentIndex], queueVM: queueVM)
    }

    func playItem(_ item: QueueItem, queueVM: QueueViewModel) async {
        // Re-resolve YouTube items at play time (URLs expire).
        // After loadQueue(), fetch the fresh struct from sortedQueue.
        let fresh = await queueVM.reResolveIfNeeded(item: item)
        engine.play(item: fresh)
    }

    func advanceToNext() {
        NotificationCenter.default.post(name: .playerViewModelAdvance, object: nil)
    }
}

extension Notification.Name {
    static let playerViewModelAdvance = Notification.Name("playerViewModelAdvance")
}
