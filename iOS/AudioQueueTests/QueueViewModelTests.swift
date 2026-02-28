import XCTest
@testable import AudioQueue

@MainActor
final class QueueViewModelTests: XCTestCase {

    private func makeItem(
        id: String = UUID().uuidString,
        sourceType: String = "podcast",
        audioURL: String? = "https://cdn.example.com/ep.mp3",
        resolveStatus: String = "resolved",
        isListened: Bool = false,
        savedAt: Date = Date(),
        position: Int = 0
    ) -> QueueItem {
        QueueItem(
            id: id,
            originalURL: "https://example.com",
            title: "Episode \(id)",
            sourceType: sourceType,
            audioURL: audioURL,
            durationSeconds: 1800,
            savedAt: savedAt,
            position: position,
            isListened: isListened,
            thumbnailURL: nil,
            publisher: "Show",
            resolveStatus: resolveStatus,
            resolveError: nil
        )
    }

    // MARK: - sortedQueue

    func testSortedQueue_returnsUnlistenedOnly() {
        let vm = QueueViewModel()
        vm.allItems = [
            makeItem(id: "a", isListened: false),
            makeItem(id: "b", isListened: true),
            makeItem(id: "c", isListened: false),
        ]

        let sorted = vm.sortedQueue
        XCTAssertEqual(sorted.count, 2)
        XCTAssertTrue(sorted.allSatisfy { !$0.isListened })
    }

    func testSortedQueue_delegatesToQueueAlgorithm() {
        let vm = QueueViewModel()
        let recent = makeItem(id: "recent", savedAt: Date())
        let veryOld = makeItem(id: "old", savedAt: Date(timeIntervalSinceNow: -86400 * 15))
        vm.allItems = [veryOld, recent]

        let sorted = vm.sortedQueue
        XCTAssertEqual(sorted.first?.id, "recent")
    }

    // MARK: - archivedItems

    func testArchivedItems_returnsListenedOnly() {
        let vm = QueueViewModel()
        vm.allItems = [
            makeItem(id: "a", isListened: false),
            makeItem(id: "b", isListened: true),
            makeItem(id: "c", isListened: true),
        ]

        let archived = vm.archivedItems
        XCTAssertEqual(archived.count, 2)
        XCTAssertTrue(archived.allSatisfy { $0.isListened })
    }

    func testArchivedItems_sortedNewestFirst() {
        let vm = QueueViewModel()
        let older = makeItem(id: "older", isListened: true, savedAt: Date(timeIntervalSinceNow: -86400))
        let newer = makeItem(id: "newer", isListened: true, savedAt: Date())
        vm.allItems = [older, newer]

        let archived = vm.archivedItems
        XCTAssertEqual(archived.first?.id, "newer")
        XCTAssertEqual(archived.last?.id, "older")
    }

    // MARK: - moveItems

    func testMoveItems_preservesAllItems() {
        let vm = QueueViewModel()
        let a = makeItem(id: "a", savedAt: Date())
        let b = makeItem(id: "b", savedAt: Date(timeIntervalSinceNow: -1))
        let c = makeItem(id: "c", savedAt: Date(timeIntervalSinceNow: -2))
        let listened = makeItem(id: "listened", isListened: true)
        vm.allItems = [a, b, c, listened]

        let sorted = vm.sortedQueue
        XCTAssertEqual(sorted.count, 3)

        // Move first item to last position in the sorted subset
        vm.moveItems(from: IndexSet(integer: 0), to: 3)

        // allItems should still contain all 4 items (3 unlistened + 1 listened)
        XCTAssertEqual(vm.allItems.count, 4)
        XCTAssertTrue(vm.allItems.contains(where: { $0.id == "listened" }))
        XCTAssertTrue(vm.allItems.contains(where: { $0.id == "a" }))
        XCTAssertTrue(vm.allItems.contains(where: { $0.id == "b" }))
        XCTAssertTrue(vm.allItems.contains(where: { $0.id == "c" }))
    }
}
