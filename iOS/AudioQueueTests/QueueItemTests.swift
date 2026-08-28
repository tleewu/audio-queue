import XCTest
@testable import AudioQueue

final class QueueItemTests: XCTestCase {

    private func makeItem(
        audioURL: String? = "https://cdn.example.com/ep.mp3",
        durationSeconds: Int? = 3661,
        isListened: Bool = false
    ) -> QueueItem {
        QueueItem(
            id: "test-1",
            originalURL: "https://example.com/episode",
            title: "Test Episode",
            publisher: "Test Show",
            audioURL: audioURL,
            durationSeconds: durationSeconds,
            isListened: isListened,
            position: 0,
            savedAt: Date()
        )
    }

    // MARK: - Podcast vs web

    func testIsPodcastWhenAudioURLPresent() {
        XCTAssertTrue(makeItem().isPodcast)
        XCTAssertFalse(makeItem(audioURL: nil).isPodcast)
    }

    func testPlaybackURL() {
        XCTAssertEqual(makeItem().playbackURL?.absoluteString, "https://cdn.example.com/ep.mp3")
        XCTAssertNil(makeItem(audioURL: nil).playbackURL)
    }

    func testWebURL() {
        XCTAssertEqual(makeItem().webURL?.absoluteString, "https://example.com/episode")
    }

    // MARK: - Duration

    func testFormattedDurationWithHours() {
        XCTAssertEqual(makeItem(durationSeconds: 3661).formattedDuration, "1:01:01")
    }

    func testFormattedDurationMinutesOnly() {
        XCTAssertEqual(makeItem(durationSeconds: 90).formattedDuration, "1:30")
    }

    func testFormattedDurationNilWhenUnknown() {
        XCTAssertNil(makeItem(durationSeconds: nil).formattedDuration)
        XCTAssertNil(makeItem(durationSeconds: 0).formattedDuration)
    }

    // MARK: - Decoding

    func testDecodesBackendPayload() throws {
        let json = """
        {
          "id": "abc",
          "originalURL": "https://example.com/episode",
          "title": "Episode 42",
          "publisher": "The Show",
          "audioURL": "https://cdn.example.com/ep.mp3",
          "durationSeconds": 1800,
          "isListened": false,
          "position": 3,
          "savedAt": "2026-08-01T12:00:00.000Z"
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let item = try decoder.decode(QueueItem.self, from: json)

        XCTAssertEqual(item.id, "abc")
        XCTAssertEqual(item.title, "Episode 42")
        XCTAssertEqual(item.publisher, "The Show")
        XCTAssertEqual(item.position, 3)
        XCTAssertTrue(item.isPodcast)
    }

    func testDecodesWebItemWithNullFields() throws {
        let json = """
        {
          "id": "def",
          "originalURL": "https://example.com/essay",
          "title": "An essay",
          "publisher": null,
          "audioURL": null,
          "durationSeconds": null,
          "isListened": false,
          "position": 0,
          "savedAt": "2026-08-01T12:00:00.000Z"
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let item = try decoder.decode(QueueItem.self, from: json)

        XCTAssertFalse(item.isPodcast)
        XCTAssertNil(item.publisher)
        XCTAssertEqual(item.webURL?.absoluteString, "https://example.com/essay")
    }
}
