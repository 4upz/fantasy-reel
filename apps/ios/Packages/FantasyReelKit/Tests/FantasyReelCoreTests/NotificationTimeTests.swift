import Foundation
import Testing
@testable import FantasyReelCore

struct NotificationTimeTests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let locale = Locale(identifier: "en_US")

    private func describe(secondsAgo: TimeInterval) -> NotificationTime {
        NotificationTime.describe(now.addingTimeInterval(-secondsAgo), now: now, locale: locale)
    }

    @Test func underAMinuteIsJustNow() {
        #expect(describe(secondsAgo: 0).short == "Just now")
        #expect(describe(secondsAgo: 59).short == "Just now")
        // A clock slightly ahead of the server never shows a negative time.
        #expect(describe(secondsAgo: -30).short == "Just now")
    }

    @Test func minutesHoursAndDaysAreAbbreviated() {
        #expect(describe(secondsAgo: 5 * 60) == NotificationTime(short: "5m ago", spoken: "5 minutes ago"))
        #expect(describe(secondsAgo: 3 * 3600 + 59) == NotificationTime(short: "3h ago", spoken: "3 hours ago"))
        #expect(describe(secondsAgo: 6 * 86_400) == NotificationTime(short: "6d ago", spoken: "6 days ago"))
    }

    @Test func aWeekOrMoreShowsTheDate() {
        let time = describe(secondsAgo: 7 * 86_400)
        #expect(!time.short.contains("ago"))
        #expect(time.short == time.spoken)
    }
}
