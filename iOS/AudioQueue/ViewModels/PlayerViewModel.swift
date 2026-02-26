import Foundation
import SwiftData
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

    /// Start playing from the beginning of the scored queue.
    func playQueue(_ queue: [QueueItem], context: ModelContext, queueVM: QueueViewModel) async {
        guard !queue.isEmpty else { return }
        currentIndex = 0
        await playItem(queue[currentIndex], context: context, queueVM: queueVM)
    }

    func playItem(_ item: QueueItem, context: ModelContext, queueVM: QueueViewModel) async {
        // Re-resolve YouTube items at play time (URLs expire)
        await queueVM.reResolveIfNeeded(item: item, context: context)
        engine.play(item: item)
    }

    func advanceToNext() {
        // PlayerViewModel signals need to advance; QueueListView observes and acts.
        // We post a more specific notification that the view layer listens to.
        NotificationCenter.default.post(name: .playerViewModelAdvance, object: nil)
    }
}

extension Notification.Name {
    static let playerViewModelAdvance = Notification.Name("playerViewModelAdvance")
}
