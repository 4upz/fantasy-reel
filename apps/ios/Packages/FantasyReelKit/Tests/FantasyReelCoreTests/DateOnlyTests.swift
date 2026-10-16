import Foundation
import Testing
@testable import FantasyReelCore

struct DateOnlyTests {
    @Test func parsesStrictCalendarDates() {
        #expect(DateOnly("2026-10-16")?.isoString == "2026-10-16")
        #expect(DateOnly("2028-02-29") != nil)
        for invalid in ["2026-02-29", "2026-02-30", "2026-13-01", "2026-00-10", "2026-04-31",
                        "2026-4-01", "2026-10-16T00:00:00Z", "", "20261016", "2026-10-1a", " 2026-10-16"] {
            #expect(DateOnly(invalid) == nil, "\(invalid)")
        }
    }

    @Test func codesAsBareString() throws {
        struct Row: Codable {
            var release_date: DateOnly?
        }
        let row = try decodeJSON(Row.self, #"{"release_date":"2026-08-13"}"#)
        #expect(row.release_date == DateOnly(year: 2026, month: 8, day: 13))
        let encoded = try #require(String(data: try FRJSON.encode(row), encoding: .utf8))
        #expect(encoded == #"{"release_date":"2026-08-13"}"#)
        #expect(try decodeJSON(Row.self, #"{"release_date":null}"#).release_date == nil)
        #expect(throws: DecodingError.self) {
            _ = try decodeJSON(Row.self, #"{"release_date":"2026-02-30"}"#)
        }
    }

    @Test func comparesAndAddsDays() throws {
        let date = try #require(DateOnly("2026-12-31"))
        #expect(date.adding(days: 1).isoString == "2027-01-01")
        #expect(date.adding(days: -365).isoString == "2025-12-31")
        #expect(try #require(DateOnly("2028-02-28")).adding(days: 1).isoString == "2028-02-29")
        #expect(date > date.adding(days: -1))
        #expect(date.days(until: date.adding(days: 10)) == 10)
    }

    @Test func todayFollowsTheRequestedZone() throws {
        let now = instant("2026-10-16T01:29:13Z")
        #expect(DateOnly.today(now: now).isoString == "2026-10-16")
        let losAngeles = try #require(TimeZone(identifier: "America/Los_Angeles"))
        #expect(DateOnly.today(now: now, timeZone: losAngeles).isoString == "2026-10-15")
    }

    @Test func hasReleasedFlipsAtUTCMidnight() throws {
        let release = try #require(DateOnly("2026-10-16"))
        #expect(!DateOnly.hasReleased(release, now: instant("2026-10-15T23:59:59.999Z")))
        #expect(DateOnly.hasReleased(release, now: instant("2026-10-16T00:00:00Z")))
        #expect(DateOnly.hasReleased(release, now: instant("2026-11-01T12:00:00Z")))
        // 8pm in Los Angeles on the 15th is already the 16th in UTC.
        #expect(DateOnly.hasReleased(release, now: instant("2026-10-15T20:00:00-07:00")))
        #expect(!DateOnly.hasReleased(nil, now: instant("2030-01-01T00:00:00Z")))
    }

    @Test func midnightInZone() throws {
        let date = try #require(DateOnly("2026-10-16"))
        #expect(approximatelyEqual(date.date(in: .gmt), 1_792_108_800))
        let tokyo = try #require(TimeZone(identifier: "Asia/Tokyo"))
        #expect(approximatelyEqual(date.date(in: tokyo), 1_792_108_800 - 9 * 3600))
    }

    @Test func displaysWithoutShiftingTheDay() throws {
        let locale = Locale(identifier: "en_US")
        let date = try #require(DateOnly("2026-10-16"))
        #expect(date.formatted(.short, locale: locale) == "Oct 16")
        #expect(date.formatted(.full, locale: locale) == "October 16, 2026")
        #expect(DateOnly.display(nil, style: .short, locale: locale) == "TBA")
        #expect(DateOnly.display(DateOnly("2026-01-01"), style: .full, locale: locale) == "January 1, 2026")
    }
}
