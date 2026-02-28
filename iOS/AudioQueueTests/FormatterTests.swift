import XCTest
@testable import AudioQueue

final class FormatterTests: XCTestCase {

    // MARK: - formatTime

    func testFormatTime_zero() {
        XCTAssertEqual(formatTime(0), "0:00")
    }

    func testFormatTime_negative() {
        XCTAssertEqual(formatTime(-5), "0:00")
    }

    func testFormatTime_90seconds() {
        XCTAssertEqual(formatTime(90), "1:30")
    }

    func testFormatTime_hoursMinutesSeconds() {
        XCTAssertEqual(formatTime(3661), "1:01:01")
    }

    func testFormatTime_exactHour() {
        XCTAssertEqual(formatTime(3600), "1:00:00")
    }

    func testFormatTime_nan() {
        XCTAssertEqual(formatTime(Double.nan), "0:00")
    }

    func testFormatTime_infinity() {
        XCTAssertEqual(formatTime(Double.infinity), "0:00")
    }

    // MARK: - formatRate

    func testFormatRate_one() {
        XCTAssertEqual(formatRate(1.0), "1×")
    }

    func testFormatRate_075() {
        XCTAssertEqual(formatRate(0.75), "0.75×")
    }

    func testFormatRate_15() {
        XCTAssertEqual(formatRate(1.5), "1.5×")
    }

    func testFormatRate_2() {
        XCTAssertEqual(formatRate(2.0), "2×")
    }

    // MARK: - formatRemaining

    func testFormatRemaining_30seconds() {
        XCTAssertEqual(formatRemaining(30), "1 min left")
    }

    func testFormatRemaining_5400seconds() {
        XCTAssertEqual(formatRemaining(5400), "1 hr 30 min left")
    }

    func testFormatRemaining_exactHour() {
        XCTAssertEqual(formatRemaining(3600), "1 hr left")
    }

    func testFormatRemaining_twoHours() {
        XCTAssertEqual(formatRemaining(7200), "2 hr left")
    }

    func testFormatRemaining_90seconds() {
        XCTAssertEqual(formatRemaining(90), "2 min left")
    }
}
