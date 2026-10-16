import Foundation

/// Reads and writes the instants PostgREST and Edge Functions send.
///
/// The backend is not consistent about shape: PostgREST renders `timestamptz`
/// as `2026-10-16T01:29:13.123456+00:00`, Edge Functions use JavaScript's
/// `toISOString()` (`…13.123Z`), and SQL text or older rows can arrive as
/// `2026-10-16 01:29:13.123+00`. `ISO8601DateFormatter` rejects several of
/// these depending on its options, so this is a small strict parser instead.
public enum PostgresTimestamp {
    /// Parses `YYYY-MM-DD[T| ]HH:MM:SS[.fraction][Z|±HH|±HHMM|±HH:MM]`.
    ///
    /// Fractional seconds are kept to the millisecond (JavaScript's precision,
    /// so comparisons match the web). A missing offset is read as UTC, which is
    /// what Postgres means for a `timestamp` column. Returns nil for anything
    /// else, including impossible dates such as February 30.
    public static func parse(_ string: String) -> Date? {
        let bytes = Array(string.trimmingCharacters(in: .whitespaces).utf8)
        guard bytes.count >= 19 else { return nil }

        func number(_ start: Int, _ count: Int) -> Int? {
            guard start + count <= bytes.count else { return nil }
            var value = 0
            for index in start..<(start + count) {
                let byte = bytes[index]
                guard byte >= 48, byte <= 57 else { return nil }
                value = value * 10 + Int(byte - 48)
            }
            return value
        }

        let dash: UInt8 = 45, colon: UInt8 = 58
        guard let year = number(0, 4), bytes[4] == dash,
              let month = number(5, 2), bytes[7] == dash,
              let day = number(8, 2),
              bytes[10] == 84 || bytes[10] == 116 || bytes[10] == 32, // T, t, space
              let hour = number(11, 2), bytes[13] == colon,
              let minute = number(14, 2), bytes[16] == colon,
              let second = number(17, 2),
              CivilDate.isValid(year: year, month: month, day: day),
              hour < 24, minute < 60, second < 60
        else { return nil }

        var index = 19
        var milliseconds = 0
        if index < bytes.count, bytes[index] == 46 || bytes[index] == 44 { // . or ,
            index += 1
            var digits = 0
            while index < bytes.count, bytes[index] >= 48, bytes[index] <= 57 {
                if digits < 3 { milliseconds = milliseconds * 10 + Int(bytes[index] - 48) }
                digits += 1
                index += 1
            }
            guard digits > 0 else { return nil }
            if digits < 3 {
                for _ in digits..<3 { milliseconds *= 10 }
            }
        }

        var offsetSeconds = 0
        if index < bytes.count {
            let sign = bytes[index]
            if sign == 90 || sign == 122 { // Z, z
                index += 1
            } else if sign == 43 || sign == dash { // + or -
                guard let offsetHours = number(index + 1, 2), offsetHours <= 23 else { return nil }
                index += 3
                var offsetMinutes = 0
                if index < bytes.count {
                    if bytes[index] == colon { index += 1 }
                    guard let minutes = number(index, 2), minutes < 60 else { return nil }
                    offsetMinutes = minutes
                    index += 2
                }
                offsetSeconds = (offsetHours * 3600 + offsetMinutes * 60) * (sign == dash ? -1 : 1)
            } else {
                return nil
            }
        }
        guard index == bytes.count else { return nil }

        let days = CivilDate.daysFromCivil(year: year, month: month, day: day)
        let seconds = days * 86_400 + hour * 3600 + minute * 60 + second - offsetSeconds
        return Date(timeIntervalSince1970: Double(seconds) + Double(milliseconds) / 1000)
    }

    /// `2026-10-16T01:29:13.123Z`: what JavaScript's `toISOString()` produces,
    /// so a value round-trips to the server the way the web sends it.
    public static func format(_ date: Date) -> String {
        // Nearest, not down: 1760577753.123 is stored as …752.99998 and must not print as .122.
        let totalMilliseconds = Int64((date.timeIntervalSince1970 * 1000).rounded())
        let days = CivilDate.floorDiv(totalMilliseconds, 86_400_000)
        let msOfDay = Int(totalMilliseconds - days * 86_400_000)
        let civil = CivilDate.civilFromDays(Int(days))

        let hour = msOfDay / 3_600_000
        let minute = (msOfDay / 60_000) % 60
        let second = (msOfDay / 1000) % 60
        let millisecond = msOfDay % 1000

        return CivilDate.pad(civil.year, width: 4) + "-" + CivilDate.pad(civil.month, width: 2) + "-"
            + CivilDate.pad(civil.day, width: 2) + "T" + CivilDate.pad(hour, width: 2) + ":"
            + CivilDate.pad(minute, width: 2) + ":" + CivilDate.pad(second, width: 2) + "."
            + CivilDate.pad(millisecond, width: 3) + "Z"
    }
}
