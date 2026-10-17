import Foundation

/// When a notification arrived, as the web bell writes it (F-17): "Just now",
/// "5m ago", "3h ago", "2d ago", then the date from a week on. `spoken` is the
/// full form for VoiceOver, which would read "5m" as "5 meters".
public struct NotificationTime: Sendable, Equatable {
    public let short: String
    public let spoken: String

    public init(short: String, spoken: String) {
        self.short = short
        self.spoken = spoken
    }

    public static func describe(_ date: Date, now: Date = Date(), locale: Locale = .current) -> NotificationTime {
        let seconds = max(0, Int(now.timeIntervalSince(date)))
        if seconds < 60 { return NotificationTime(short: "Just now", spoken: "Just now") }
        if seconds >= 7 * 86_400 {
            let day = date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted, locale: locale))
            return NotificationTime(short: day, spoken: day)
        }
        let (count, abbreviation, unit): (Int, String, Calendar.Component) = switch seconds {
        case 86_400...: (seconds / 86_400, "d", .day)
        case 3_600...: (seconds / 3_600, "h", .hour)
        default: (seconds / 60, "m", .minute)
        }
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = locale
        formatter.unitsStyle = .full
        var components = DateComponents()
        components.setValue(-count, for: unit)
        return NotificationTime(short: "\(count)\(abbreviation) ago", spoken: formatter.localizedString(from: components))
    }
}
