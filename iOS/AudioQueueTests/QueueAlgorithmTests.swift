import XCTest
@testable import AudioQueue

final class QueueAlgorithmTests: XCTestCase {

    private func makeItem(
        id: String = UUID().uuidString,
        sourceType: String = "podcast",
        audioURL: String? = "https://cdn.example.com/ep.mp3",
        resolveStatus: String = "resolved",
        isListened: Bool = false,
        savedAt: Date = Date()
    ) -> QueueItem {
        QueueItem(
            id: id,
            originalURL: "https://example.com",
            title: "Episode \(id)",
            sourceType: sourceType,
            audioURL: audioURL,
            durationSeconds: 1800,
            savedAt: savedAt,
            position: 0,
            isListened: isListened,
            thumbnailURL: nil,
            publisher: "Show",
            resolveStatus: resolveStatus,
            resolveError: nil
        )
    }

    func testRecentItemScoresHigherThanVeryOld() {
        // Very old item (14 days): recencyDecay = 1 - 336/168 = -1, waitBonus = 2 → score = 1.0
        // Recent item (0h): recencyDecay = 1.0, waitBonus = 0 → score = 1.0
        // They tie at 1.0 for 14 days, so use >14 days to get lower score
        let recent = makeItem(id: "recent", savedAt: Date())
        let veryOld = makeItem(id: "old", savedAt: Date(timeIntervalSinceNow: -86400 * 15))

        let recentScore = QueueAlgorithm.score(recent)
        let oldScore = QueueAlgorithm.score(veryOld)

        XCTAssertGreaterThan(recentScore, oldScore)
    }

    func testListenedItemsFilteredOut() {
        let listened = makeItem(id: "listened", isListened: true)
        let unlistened = makeItem(id: "unlistened", isListened: false)

        let result = QueueAlgorithm.sorted([listened, unlistened])

        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result.first?.id, "unlistened")
    }

    func testPlayableBeforePending() {
        let pending = makeItem(id: "pending", resolveStatus: "pending", savedAt: Date())
        let playable = makeItem(id: "playable", resolveStatus: "resolved", savedAt: Date(timeIntervalSinceNow: -86400))

        let result = QueueAlgorithm.sorted([pending, playable])

        XCTAssertEqual(result.first?.id, "playable")
    }

    func testEmptyArrayReturnsEmpty() {
        let result = QueueAlgorithm.sorted([])
        XCTAssertTrue(result.isEmpty)
    }

    func testAllListenedReturnsEmpty() {
        let items = [
            makeItem(id: "1", isListened: true),
            makeItem(id: "2", isListened: true),
        ]

        let result = QueueAlgorithm.sorted(items)
        XCTAssertTrue(result.isEmpty)
    }

    func testFailedItemsAfterPlayable() {
        let failed = makeItem(id: "failed", resolveStatus: "failed", savedAt: Date())
        let playable = makeItem(id: "playable", resolveStatus: "resolved", savedAt: Date(timeIntervalSinceNow: -86400))

        let result = QueueAlgorithm.sorted([failed, playable])

        XCTAssertEqual(result.first?.id, "playable")
    }

    func testScoreFormula() {
        // Brand new item: ageHours ≈ 0, recencyDecay ≈ 1.0, waitBonus ≈ 0 → score ≈ 1.0
        let fresh = makeItem(savedAt: Date())
        let score = QueueAlgorithm.score(fresh)
        XCTAssertEqual(score, 1.0, accuracy: 0.01)
    }

    func testScoreDecaysOverSevenDays() {
        // Item 7 days old: recencyDecay = 1 - 168/168 = 0, waitBonus = min(168/24, 2) = 2 → score ≈ 2.0
        let weekOld = makeItem(savedAt: Date(timeIntervalSinceNow: -168 * 3600))
        let score = QueueAlgorithm.score(weekOld)
        XCTAssertEqual(score, 2.0, accuracy: 0.01)
    }

    func testNegativeRecencyDecayForOldItem() {
        // Item >7 days old: recencyDecay goes negative, waitBonus caps at 2
        let veryOld = makeItem(savedAt: Date(timeIntervalSinceNow: -336 * 3600)) // 14 days
        let score = QueueAlgorithm.score(veryOld)
        // recencyDecay = 1 - 336/168 = -1, waitBonus = 2, score = 1.0
        XCTAssertEqual(score, 1.0, accuracy: 0.01)
    }

    func testTwoSameAgeItemsBothIncluded() {
        let now = Date()
        let a = makeItem(id: "a", savedAt: now)
        let b = makeItem(id: "b", savedAt: now)

        let result = QueueAlgorithm.sorted([a, b])
        XCTAssertEqual(result.count, 2)
    }
}
