import Foundation
import SwiftUI

/// Manages the queue list: adding items via the API, draining the App Group bridge,
/// and computing the scored play order.
@MainActor
final class QueueViewModel: ObservableObject {
    @Published var allItems: [QueueItem] = []
    @Published var isAddingURL = false

    /// Unlistened items, scored and sorted for playback
    var sortedQueue: [QueueItem] {
        QueueAlgorithm.sorted(allItems)
    }

    /// Listened items, most recently saved first
    var archivedItems: [QueueItem] {
        allItems
            .filter { $0.isListened }
            .sorted { $0.savedAt > $1.savedAt }
    }

    private let appGroupID = "group.com.theowu.audioqueue"
    private let pendingKey = "pendingURLs"

    // MARK: - Load

    func loadQueue() async {
        do {
            let items = try await APIClient.shared.fetchQueue()
            allItems = items
        } catch APIError.unauthorized {
            AuthService.shared.signOut()
        } catch {
            print("loadQueue error:", error)
        }
    }

    // MARK: - URL Add

    func addURL(_ urlString: String) async {
        let cleaned = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty, URL(string: cleaned) != nil else { return }

        do {
            let item = try await APIClient.shared.addToQueue(url: cleaned)
            allItems.append(item)
            startPolling(for: item.id)
        } catch APIError.unauthorized {
            AuthService.shared.signOut()
        } catch {
            print("addURL error:", error)
        }
    }

    // MARK: - App Group Bridge (Share Extension)

    func drainPendingURLs() async {
        guard let defaults = UserDefaults(suiteName: appGroupID) else { return }
        let pending = defaults.stringArray(forKey: pendingKey) ?? []
        guard !pending.isEmpty else { return }
        defaults.removeObject(forKey: pendingKey)

        await withTaskGroup(of: Void.self) { group in
            for urlString in pending {
                group.addTask { await self.addURL(urlString) }
            }
        }
    }

    // MARK: - Polling

    private func startPolling(for itemId: String) {
        Task {
            for _ in 0..<20 {
                try? await Task.sleep(nanoseconds: 3_000_000_000) // 3 s
                await loadQueue()
                if let item = sortedQueue.first(where: { $0.id == itemId }),
                   !item.isPending { break }
            }
        }
    }

    // MARK: - Re-resolve YouTube at play time

    func reResolveIfNeeded(item: QueueItem) async -> QueueItem {
        guard item.sourceType == "youtube" else { return item }
        await loadQueue()
        return sortedQueue.first(where: { $0.id == item.id }) ?? item
    }

    // MARK: - Actions

    func markListened(_ item: QueueItem) {
        Task {
            do {
                _ = try await APIClient.shared.markListened(id: item.id)
                await loadQueue()
            } catch APIError.unauthorized {
                AuthService.shared.signOut()
            } catch {
                print("markListened error:", error)
            }
        }
    }

    func markUnlistened(_ item: QueueItem) {
        Task {
            do {
                _ = try await APIClient.shared.markUnlistened(id: item.id)
                await loadQueue()
            } catch APIError.unauthorized {
                AuthService.shared.signOut()
            } catch {
                print("markUnlistened error:", error)
            }
        }
    }

    func delete(_ item: QueueItem) {
        // Optimistic remove
        allItems.removeAll { $0.id == item.id }
        Task {
            do {
                try await APIClient.shared.deleteFromQueue(id: item.id)
            } catch APIError.unauthorized {
                AuthService.shared.signOut()
            } catch {
                await loadQueue() // revert on error
            }
        }
    }

    func moveItems(from source: IndexSet, to destination: Int) {
        // Work on the sorted (unlistened) subset
        var reordered = sortedQueue
        reordered.move(fromOffsets: source, toOffset: destination)
        // Update positions in allItems to match new order
        let reorderedIDs = Set(reordered.map(\.id))
        allItems = allItems.filter { !reorderedIDs.contains($0.id) } + reordered

        Task {
            let order = reordered.enumerated().map { ($0.element.id, $0.offset) }
            do {
                try await APIClient.shared.reorderQueue(order: order)
            } catch APIError.unauthorized {
                AuthService.shared.signOut()
            } catch {
                await loadQueue() // revert on error
            }
        }
    }
}
