import XCTest
@testable import AudioQueue

@MainActor
final class QueueViewModelTests: XCTestCase {

    private func makeItem(
        id: String = UUID().uuidString,
        audioURL: String? = "https://cdn.example.com/ep.mp3",
        isListened: Bool = false,
        position: Int = 0,
        savedAt: Date = Date()
    ) -> QueueItem {
        QueueItem(
            id: id,
            originalURL: "https://example.com",
            title: "Episode \(id)",
            publisher: "Show",
            audioURL: audioURL,
            durationSeconds: 1800,
            isListened: isListened,
            position: position,
            savedAt: savedAt
        )
    }

    private func makeVM(_ items: [QueueItem]) -> QueueViewModel {
        let vm = QueueViewModel()
        vm.items = items
        return vm
    }

    // MARK: - queue

    func testQueueReturnsUnlistenedInPositionOrder() {
        let vm = makeVM([
            makeItem(id: "a", position: 0),
            makeItem(id: "b", isListened: true, position: 1),
            makeItem(id: "c", position: 2),
        ])

        XCTAssertEqual(vm.queue.map(\.id), ["a", "c"])
    }

    // MARK: - archive

    func testArchiveReturnsListenedNewestFirst() {
        let vm = makeVM([
            makeItem(id: "older", isListened: true, savedAt: Date(timeIntervalSinceNow: -86400)),
            makeItem(id: "newer", isListened: true, savedAt: Date()),
            makeItem(id: "unlistened"),
        ])

        XCTAssertEqual(vm.archive.map(\.id), ["newer", "older"])
    }

    // MARK: - move

    func testMoveReordersQueueAndKeepsArchivedItems() {
        let vm = makeVM([
            makeItem(id: "a", position: 0),
            makeItem(id: "b", position: 1),
            makeItem(id: "c", position: 2),
            makeItem(id: "listened", isListened: true, position: 3),
        ])

        vm.move(from: IndexSet(integer: 0), to: 3) // a to the end

        XCTAssertEqual(vm.queue.map(\.id), ["b", "c", "a"])
        XCTAssertEqual(vm.items.count, 4)
        XCTAssertTrue(vm.items.contains { $0.id == "listened" })
    }

    // MARK: - setListened

    func testSetListenedMovesItemToArchiveImmediately() {
        let vm = makeVM([makeItem(id: "a"), makeItem(id: "b")])

        vm.setListened(vm.queue[0], true)

        XCTAssertEqual(vm.queue.map(\.id), ["b"])
        XCTAssertEqual(vm.archive.map(\.id), ["a"])
    }

    // MARK: - delete

    func testDeleteRemovesItemImmediately() {
        let vm = makeVM([makeItem(id: "a"), makeItem(id: "b")])

        vm.delete(vm.queue[0])

        XCTAssertEqual(vm.items.map(\.id), ["b"])
    }
}
