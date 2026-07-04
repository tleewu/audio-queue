import XCTest
@testable import AudioQueue

final class QueueItemTests: XCTestCase {

    private func makeItem(
        sourceType: String = "podcast",
        audioURL: String? = "https://example.com/ep.mp3",
        resolveStatus: String = "resolved",
        durationSeconds: Int? = 3661,
        isListened: Bool = false,
        playbackType: String? = nil
    ) -> QueueItem {
        QueueItem(
            id: "test-1",
            originalURL: "https://example.com",
            title: "Test Episode",
            sourceType: sourceType,
            audioURL: audioURL,
            durationSeconds: durationSeconds,
            savedAt: Date(),
            position: 0,
            isListened: isListened,
            thumbnailURL: nil,
            publisher: "Test Show",
            resolveStatus: resolveStatus,
            resolveError: nil,
            playbackType: playbackType
        )
    }

    // MARK: - Status

    func testIsResolved() {
        XCTAssertTrue(makeItem(resolveStatus: "resolved").isResolved)
        XCTAssertFalse(makeItem(resolveStatus: "pending").isResolved)
        XCTAssertFalse(makeItem(resolveStatus: "failed").isResolved)
    }

    func testIsFailed() {
        XCTAssertTrue(makeItem(resolveStatus: "failed").isFailed)
        XCTAssertFalse(makeItem(resolveStatus: "resolved").isFailed)
    }

    func testIsPending() {
        XCTAssertTrue(makeItem(resolveStatus: "pending").isPending)
        XCTAssertFalse(makeItem(resolveStatus: "resolved").isPending)
    }

    // MARK: - Playability

    func testIsPlayable() {
        XCTAssertTrue(makeItem(audioURL: "https://cdn.example.com/ep.mp3", resolveStatus: "resolved").isPlayable)
        XCTAssertFalse(makeItem(audioURL: nil, resolveStatus: "resolved").isPlayable)
        XCTAssertFalse(makeItem(audioURL: "https://cdn.example.com/ep.mp3", resolveStatus: "pending").isPlayable)
    }

    func testIsUnsupported() {
        XCTAssertTrue(makeItem(sourceType: "unsupported").isUnsupported)
        XCTAssertFalse(makeItem(sourceType: "podcast").isUnsupported)
    }

    func testIsOpenInApp_unsupported() {
        XCTAssertTrue(makeItem(sourceType: "unsupported").isOpenInApp)
    }

    func testIsOpenInApp_youtubeNoAudio() {
        XCTAssertTrue(makeItem(sourceType: "youtube", audioURL: nil).isOpenInApp)
    }

    func testIsOpenInApp_youtubeWithAudio() {
        XCTAssertFalse(makeItem(sourceType: "youtube", audioURL: "https://cdn.example.com/audio.mp3").isOpenInApp)
    }

    func testIsOpenInApp_podcast() {
        XCTAssertFalse(makeItem(sourceType: "podcast").isOpenInApp)
    }

    // MARK: - Playback Type

    func testEffectivePlaybackType_legacyFallback() {
        // Pre-playbackType server rows: infer from audioURL presence
        XCTAssertEqual(makeItem(audioURL: "https://cdn.example.com/a.mp3", playbackType: nil).effectivePlaybackType, "direct")
        XCTAssertEqual(makeItem(audioURL: nil, playbackType: nil).effectivePlaybackType, "external")
    }

    func testProxyItemIsPlayable() {
        let item = makeItem(sourceType: "youtube", audioURL: "https://upstream.example.com/a.m4a", playbackType: "proxy")
        XCTAssertTrue(item.isPlayable)
        XCTAssertTrue(item.isProxied)
        XCTAssertFalse(item.isOpenInApp)
    }

    func testExternalItemOpensInApp() {
        let item = makeItem(sourceType: "x", audioURL: nil, playbackType: "external")
        XCTAssertFalse(item.isPlayable)
        XCTAssertTrue(item.isOpenInApp)
    }

    func testDirectItemIsNotProxied() {
        XCTAssertFalse(makeItem(playbackType: "direct").isProxied)
    }

    // MARK: - Formatted Duration

    func testFormattedDuration_hoursMinutesSeconds() {
        XCTAssertEqual(makeItem(durationSeconds: 3661).formattedDuration, "1:01:01")
    }

    func testFormattedDuration_minutesSeconds() {
        XCTAssertEqual(makeItem(durationSeconds: 150).formattedDuration, "2:30")
    }

    func testFormattedDuration_nil() {
        XCTAssertNil(makeItem(durationSeconds: nil).formattedDuration)
    }

    func testFormattedDuration_zero() {
        XCTAssertNil(makeItem(durationSeconds: 0).formattedDuration)
    }

    // MARK: - Source Emoji

    func testSourceEmoji() {
        XCTAssertEqual(makeItem(sourceType: "youtube").sourceEmoji, "▶️")
        XCTAssertEqual(makeItem(sourceType: "soundcloud").sourceEmoji, "☁️")
        XCTAssertEqual(makeItem(sourceType: "podcast").sourceEmoji, "🎙")
        XCTAssertEqual(makeItem(sourceType: "substack").sourceEmoji, "📧")
        XCTAssertEqual(makeItem(sourceType: "other").sourceEmoji, "🎵")
        XCTAssertEqual(makeItem(sourceType: "unsupported").sourceEmoji, "🎵")
    }
}
