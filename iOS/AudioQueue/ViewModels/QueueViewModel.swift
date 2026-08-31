import Combine
import Foundation

/// The queue: loads items from the backend, adds shared links, and keeps
/// the list in the order the user arranged it.
@MainActor
final class QueueViewModel: ObservableObject {
    @Published var items: [QueueItem] = []
    /// Number of links currently being resolved by the backend.
    @Published private(set) var addingCount = 0

    /// Items still to listen to, in queue order (the server orders by position).
    var queue: [QueueItem] { items.filter { !$0.isListened } }

    /// Items already listened to, most recently saved first.
    var archive: [QueueItem] {
        items.filter(\.isListened).sorted { $0.savedAt > $1.savedAt }
    }

    private let appGroupID = "group.com.theowu.audioqueue"
    private let pendingKey = "pendingURLs"
    private var cancellables = Set<AnyCancellable>()

    init() {
        // Finishing an episode archives it, so the queue is what is left to
        // hear rather than a list the user has to tidy by hand.
        AudioEngine.shared.finished
            .sink { [weak self] item in self?.setListened(item, true) }
            .store(in: &cancellables)
    }

    // MARK: - Loading

    func load() async {
        do {
            items = try await APIClient.shared.fetchQueue()
        } catch APIError.unauthorized {
            AuthService.shared.signOut()
        } catch {
            print("load error:", error)
        }
    }

    /// Adds links handed over by the share extension through the App Group.
    func drainSharedURLs() async {
        guard let defaults = UserDefaults(suiteName: appGroupID),
              let pending = defaults.stringArray(forKey: pendingKey), !pending.isEmpty else { return }
        defaults.removeObject(forKey: pendingKey)

        // Resolution happens server-side while the item is saved, so run the
        // shared links concurrently rather than waiting on each in turn.
        await withTaskGroup(of: Void.self) { group in
            for urlString in pending {
                group.addTask { await self.add(urlString) }
            }
        }
    }

    // MARK: - Mutations

    /// Saves a link. The backend resolves it before replying, so the item comes
    /// back either as a podcast episode or as a web item.
    func add(_ urlString: String) async {
        let cleaned = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty, URL(string: cleaned) != nil else { return }

        addingCount += 1
        defer { addingCount -= 1 }

        do {
            items.append(try await APIClient.shared.addToQueue(url: cleaned))
        } catch APIError.unauthorized {
            AuthService.shared.signOut()
        } catch {
            print("add error:", error)
        }
    }

    func setListened(_ item: QueueItem, _ isListened: Bool) {
        update(item.id) { $0.isListened = isListened }
        Task {
            do {
                _ = try await APIClient.shared.setListened(id: item.id, isListened: isListened)
            } catch {
                await load() // revert on error
            }
        }
    }

    func delete(_ item: QueueItem) {
        items.removeAll { $0.id == item.id }
        // The footer holds on to the last thing played; drop it when that very
        // item is deleted, rather than leaving a row that no longer exists.
        AudioEngine.shared.forget(item.id)
        Task {
            do {
                try await APIClient.shared.deleteFromQueue(id: item.id)
            } catch {
                await load()
            }
        }
    }

    /// Reorders the unlistened queue and persists the new positions.
    func move(from source: IndexSet, to destination: Int) {
        var reordered = queue
        reordered.move(fromOffsets: source, toOffset: destination)
        for (index, item) in reordered.enumerated() {
            update(item.id) { $0.position = index }
        }
        items.sort { $0.position < $1.position }

        let order = reordered.enumerated().map { (id: $0.element.id, position: $0.offset) }
        Task {
            do {
                try await APIClient.shared.reorderQueue(order: order)
            } catch {
                await load()
            }
        }
    }

    private func update(_ id: String, _ change: (inout QueueItem) -> Void) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        change(&items[index])
    }
}
