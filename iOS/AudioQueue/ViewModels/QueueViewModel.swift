import Foundation
import SwiftData
import SwiftUI

/// Manages the queue list: adding items, draining the App Group bridge,
/// triggering resolution, and computing the scored play order.
@MainActor
final class QueueViewModel: ObservableObject {
    @Published var sortedQueue: [QueueItem] = []
    @Published var isAddingURL = false

    private let appGroupID = "group.com.theowu.audioqueue"
    private let pendingKey = "pendingURLs"

    // MARK: - URL Add

    /// Add a URL manually (from AddURLView). Creates a pending QueueItem,
    /// triggers backend resolution, and inserts into the provided context.
    func addURL(_ urlString: String, context: ModelContext) async {
        let cleaned = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty, URL(string: cleaned) != nil else { return }

        let existingItems = try? context.fetch(FetchDescriptor<QueueItem>())
        let nextPosition = (existingItems?.map(\.position).max() ?? -1) + 1

        let item = QueueItem(url: cleaned, position: nextPosition)
        context.insert(item)
        try? context.save()

        await resolve(item: item, context: context)
    }

    // MARK: - App Group Bridge (Share Extension)

    /// Call this when the app enters the foreground.
    /// Drains pending URLs written by the Share Extension.
    func drainPendingURLs(context: ModelContext) async {
        guard let defaults = UserDefaults(suiteName: appGroupID) else { return }
        let pending = defaults.stringArray(forKey: pendingKey) ?? []
        guard !pending.isEmpty else { return }

        defaults.removeObject(forKey: pendingKey)

        let existingItems = try? context.fetch(FetchDescriptor<QueueItem>())
        var nextPosition = (existingItems?.map(\.position).max() ?? -1) + 1

        var newItems: [QueueItem] = []
        for urlString in pending {
            let item = QueueItem(url: urlString, position: nextPosition)
            context.insert(item)
            newItems.append(item)
            nextPosition += 1
        }
        try? context.save()

        // Resolve all in parallel
        await withTaskGroup(of: Void.self) { group in
            for item in newItems {
                group.addTask {
                    await self.resolve(item: item, context: context)
                }
            }
        }
    }

    // MARK: - Resolution

    func resolve(item: QueueItem, context: ModelContext) async {
        do {
            let resolved = try await MetadataService.shared.resolve(url: item.url)
            item.title = resolved.title.isEmpty ? item.url : resolved.title
            item.sourceType = resolved.sourceType
            item.audioURL = resolved.audioURL
            item.durationSeconds = resolved.durationSeconds
            item.thumbnailURL = resolved.thumbnailURL
            item.publisher = resolved.publisher
            item.resolveStatus = resolved.audioURL != nil ? "resolved" : "failed"
            item.resolveError = resolved.audioURL == nil ? "No audio stream found" : nil
        } catch {
            item.resolveStatus = "failed"
            item.resolveError = error.localizedDescription
        }
        try? context.save()
        refreshSortedQueue(context: context)
    }

    /// Re-resolve a YouTube item at play time (stream URLs expire in ~6 hours).
    func reResolveIfNeeded(item: QueueItem, context: ModelContext) async {
        guard item.sourceType == "youtube" else { return }
        await resolve(item: item, context: context)
    }

    // MARK: - Queue Order

    func refreshSortedQueue(context: ModelContext) {
        let all = (try? context.fetch(FetchDescriptor<QueueItem>())) ?? []
        sortedQueue = QueueAlgorithm.sorted(all)
    }

    // MARK: - Actions

    func markListened(_ item: QueueItem, context: ModelContext) {
        item.isListened = true
        try? context.save()
        refreshSortedQueue(context: context)
    }

    func delete(_ item: QueueItem, context: ModelContext) {
        context.delete(item)
        try? context.save()
        refreshSortedQueue(context: context)
    }

    func moveItems(from source: IndexSet, to destination: Int, context: ModelContext) {
        var reordered = sortedQueue
        reordered.move(fromOffsets: source, toOffset: destination)
        for (idx, item) in reordered.enumerated() {
            item.position = idx
        }
        try? context.save()
        sortedQueue = reordered
    }
}
