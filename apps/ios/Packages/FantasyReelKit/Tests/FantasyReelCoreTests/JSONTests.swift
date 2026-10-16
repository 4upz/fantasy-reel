import Foundation
import Testing
@testable import FantasyReelCore

struct PostgresTimestampTests {
    // 2026-10-16T01:29:13Z
    let base: TimeInterval = 1_792_114_153

    @Test func parsesPostgRESTMicroseconds() {
        #expect(approximatelyEqual(PostgresTimestamp.parse("2026-10-16T01:29:13.123456+00:00"), base + 0.123))
    }

    @Test func parsesZuluWithAndWithoutFraction() {
        #expect(approximatelyEqual(PostgresTimestamp.parse("2026-10-16T01:29:13Z"), base))
        #expect(approximatelyEqual(PostgresTimestamp.parse("2026-10-16T01:29:13.5Z"), base + 0.5))
        #expect(approximatelyEqual(PostgresTimestamp.parse("2026-10-16T01:29:13.123Z"), base + 0.123))
    }

    @Test func parsesOffsetsInEveryShape() {
        #expect(approximatelyEqual(PostgresTimestamp.parse("2026-10-16T01:29:13+00:00"), base))
        #expect(approximatelyEqual(PostgresTimestamp.parse("2026-10-16 01:29:13.123+00"), base + 0.123))
        #expect(approximatelyEqual(PostgresTimestamp.parse("2026-10-15T18:29:13-07:00"), base))
        #expect(approximatelyEqual(PostgresTimestamp.parse("2026-10-15T18:29:13-0700"), base))
        #expect(approximatelyEqual(PostgresTimestamp.parse("2026-10-16T06:59:13+05:30"), base))
        #expect(approximatelyEqual(PostgresTimestamp.parse("2026-10-16T03:29:13+02"), base))
    }

    @Test func treatsMissingOffsetAsUTC() {
        #expect(approximatelyEqual(PostgresTimestamp.parse("2026-10-16T01:29:13"), base))
    }

    @Test func handlesInstantsBeforeTheEpoch() {
        #expect(approximatelyEqual(PostgresTimestamp.parse("1969-12-31T23:59:59.5Z"), -0.5))
    }

    @Test func rejectsMalformedValues() {
        for value in [
            "", "2026-10-16", "2026-02-30T00:00:00Z", "2026-10-16T24:00:00Z",
            "2026-10-16T01:29:13.Z", "2026-10-16T01:29:13+5", "2026-10-16T01:29:13 extra",
            "not a date", "2026/10/16 01:29:13Z",
        ] {
            #expect(PostgresTimestamp.parse(value) == nil, "\(value)")
        }
    }

    @Test func formatsLikeToISOString() {
        let date = Date(timeIntervalSince1970: base + 0.123)
        #expect(PostgresTimestamp.format(date) == "2026-10-16T01:29:13.123Z")
        #expect(PostgresTimestamp.format(Date(timeIntervalSince1970: -0.5)) == "1969-12-31T23:59:59.500Z")
    }

    @Test func roundTripsThroughFRJSON() throws {
        struct Box: Codable, Equatable {
            var at: Date
        }
        let decoded = try decodeJSON(Box.self, #"{"at":"2026-10-16 01:29:13.123+00"}"#)
        let encoded = try #require(String(data: try FRJSON.encode(decoded), encoding: .utf8))
        #expect(encoded == #"{"at":"2026-10-16T01:29:13.123Z"}"#)
    }

    @Test func decoderRejectsUnknownTimestampShape() {
        struct Box: Decodable {
            var at: Date
        }
        #expect(throws: DecodingError.self) {
            _ = try decodeJSON(Box.self, #"{"at":"yesterday"}"#)
        }
    }
}

struct JSONValueTests {
    @Test func decodesEveryKindAndReadsAccessors() throws {
        let value = try decodeJSON(JSONValue.self, #"{"tmdb_id": 550, "bid_id": "x", "won": true, "ratio": 0.5, "tags": ["a"], "none": null}"#)
        #expect(value["tmdb_id"]?.intValue == 550)
        #expect(value["tmdb_id"]?.doubleValue == 550)
        #expect(value["bid_id"]?.stringValue == "x")
        #expect(value["won"]?.boolValue == true)
        #expect(value["ratio"]?.intValue == nil)
        #expect(value["tags"]?[0]?.stringValue == "a")
        #expect(value["tags"]?[1] == nil)
        #expect(value["none"]?.isNull == true)
        #expect(value["missing"] == nil)
        #expect(value.objectValue?.count == 6)
    }

    @Test func roundTrips() throws {
        let original: JSONValue = ["a": [1, "two", .null, false], "b": ["c": 1.5]]
        let data = try FRJSON.encode(original)
        #expect(try FRJSON.decode(JSONValue.self, from: data) == original)
    }
}
