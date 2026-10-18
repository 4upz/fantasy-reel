import Foundation

/// A calendar date with no time or zone: `release_date`, `season_end`,
/// `trade_deadline`. Wire format `YYYY-MM-DD`.
///
/// Never convert one through `Date` to compare or display it: local midnight
/// read back in UTC shifts the day, the bug the web fixed in `utils/date.ts`.
public struct DateOnly: Hashable, Comparable, Codable, Sendable, CustomStringConvertible {
    public let year: Int
    public let month: Int
    public let day: Int

    /// Nil unless year/month/day is a real Gregorian date.
    public init?(year: Int, month: Int, day: Int) {
        guard (1...9999).contains(year), CivilDate.isValid(year: year, month: month, day: day) else {
            return nil
        }
        self.year = year
        self.month = month
        self.day = day
    }

    /// Strict `YYYY-MM-DD`; rejects other shapes and impossible dates (2026-02-30),
    /// like the web's `parseReleaseDate`.
    public init?(_ string: String) {
        let bytes = Array(string.utf8)
        guard bytes.count == 10, bytes[4] == 45, bytes[7] == 45 else { return nil }
        func number(_ range: Range<Int>) -> Int? {
            var value = 0
            for index in range {
                let byte = bytes[index]
                guard byte >= 48, byte <= 57 else { return nil }
                value = value * 10 + Int(byte - 48)
            }
            return value
        }
        guard let year = number(0..<4), let month = number(5..<7), let day = number(8..<10) else {
            return nil
        }
        self.init(year: year, month: month, day: day)
    }

    private init(daysSinceEpoch days: Int) {
        let civil = CivilDate.civilFromDays(days)
        self.year = civil.year
        self.month = civil.month
        self.day = civil.day
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        let string = try container.decode(String.self)
        guard let date = DateOnly(string) else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Expected a YYYY-MM-DD date, got \(string)"
            )
        }
        self = date
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(isoString)
    }

    /// `2026-10-16`.
    public var isoString: String {
        CivilDate.pad(year, width: 4) + "-" + CivilDate.pad(month, width: 2) + "-" + CivilDate.pad(day, width: 2)
    }

    public var description: String { isoString }

    public static func < (lhs: DateOnly, rhs: DateOnly) -> Bool {
        (lhs.year, lhs.month, lhs.day) < (rhs.year, rhs.month, rhs.day)
    }

    var daysSinceEpoch: Int {
        CivilDate.daysFromCivil(year: year, month: month, day: day)
    }

    /// The calendar date it is at `now` in `timeZone` (UTC by default: the
    /// server's calendar for release and eligibility rules).
    public static func today(now: Date = Date(), timeZone: TimeZone = .gmt) -> DateOnly {
        let offset = timeZone.secondsFromGMT(for: now)
        let seconds = Int64((now.timeIntervalSince1970).rounded(.down)) + Int64(offset)
        return DateOnly(daysSinceEpoch: Int(CivilDate.floorDiv(seconds, 86_400)))
    }

    public func adding(days: Int) -> DateOnly {
        DateOnly(daysSinceEpoch: daysSinceEpoch + days)
    }

    /// Whole days from `self` to `other` (negative when `other` is earlier).
    public func days(until other: DateOnly) -> Int {
        other.daysSinceEpoch - daysSinceEpoch
    }

    /// Midnight at the start of this date in `timeZone`.
    public func date(in timeZone: TimeZone = .gmt) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let components = DateComponents(year: year, month: month, day: day)
        if let date = calendar.date(from: components) { return date }
        return Date(timeIntervalSince1970: Double(daysSinceEpoch) * 86_400)
    }

    /// Whether a movie is out: on or after its UTC calendar date, the same rule
    /// as the server's `movie_has_released()` and the web's `hasReleased`, which
    /// decides when a score starts counting toward team totals. Nil has not released.
    public static func hasReleased(_ releaseDate: DateOnly?, now: Date = Date()) -> Bool {
        guard let releaseDate else { return false }
        return releaseDate <= today(now: now, timeZone: .gmt)
    }
}

// MARK: - Display

extension DateOnly {
    public enum DisplayStyle: Sendable, Hashable {
        /// "Oct 16"
        case short
        /// "Oct 16, 2026"
        case medium
        /// "October 16, 2026"
        case full
    }

    /// Formats the calendar date in the user's locale. The date is rendered in
    /// UTC from UTC midnight, so it never moves to a neighbouring day.
    public func formatted(_ style: DisplayStyle, locale: Locale = .autoupdatingCurrent) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        let base = Date.FormatStyle(locale: locale, calendar: calendar, timeZone: .gmt)
        let format: Date.FormatStyle
        switch style {
        case .short: format = base.month(.abbreviated).day()
        case .medium: format = base.month(.abbreviated).day().year()
        case .full: format = base.month(.wide).day().year()
        }
        return date(in: .gmt).formatted(format)
    }

    /// "Oct 16" in the current locale.
    public var formattedShort: String { formatted(.short) }

    /// "October 16, 2026" in the current locale.
    public var formattedFull: String { formatted(.full) }

    /// The display string for an optional date; a missing date reads "TBA",
    /// as on the web.
    public static func display(
        _ date: DateOnly?,
        style: DisplayStyle,
        locale: Locale = .autoupdatingCurrent
    ) -> String {
        date?.formatted(style, locale: locale) ?? "TBA"
    }
}
