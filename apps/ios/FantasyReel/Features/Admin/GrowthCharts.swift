import Charts
import FantasyReelCore
import SwiftUI

/// Everything the growth charts plot, derived once per load (dates, labels,
/// spoken values, summaries) so a re-render doesn't reformat every point.
struct GrowthChartData: Equatable {
    struct WeekPoint: Identifiable, Equatable {
        let id: DateOnly
        let date: Date
        let users: Int
        let leagues: Int
        /// "Week of Sunday, October 5, 2026".
        let label: String
        let usersValue: String
        let leaguesValue: String
    }

    struct MonthBar: Identifiable, Equatable {
        let id: DateOnly
        /// `YYYY-MM-DD`, the bar's x value.
        let iso: String
        let signups: Int
        let leagues: Int
        /// "October 2026", for VoiceOver.
        let spokenMonth: String
        /// "O", the axis label.
        let initial: String
    }

    let weeks: [WeekPoint]
    let months: [MonthBar]
    /// Axis initial per bar, keyed by `iso`.
    let initials: [String: String]
    /// The visible sentence under the line chart.
    let growthSummary: String
    /// "Nov 2025", the first month shown.
    let monthsSince: String

    init(stats: GrowthStats) {
        weeks = stats.growth.map { week in
            WeekPoint(
                id: week.id,
                date: week.week.date(in: .gmt),
                users: week.users,
                leagues: week.leagues,
                label: "Week of \(week.week.formattedFull)",
                usersValue: "\(GrowthFormat.count(week.users)) users",
                leaguesValue: "\(GrowthFormat.count(week.leagues)) leagues"
            )
        }
        months = stats.monthly.map { month in
            MonthBar(
                id: month.id,
                iso: month.month.isoString,
                signups: month.signups,
                leagues: month.leagues,
                spokenMonth: GrowthFormat.bucket(month.month, GrowthFormat.utc.month(.wide).year()),
                initial: GrowthFormat.bucket(month.month, GrowthFormat.utc.month(.narrow))
            )
        }
        initials = Dictionary(months.map { ($0.iso, $0.initial) }, uniquingKeysWith: { first, _ in first })
        if let first = stats.growth.first, let last = stats.growth.last {
            // "From the week of September 7, 2026 to the week of October 5,
            // 2026, users grew from 1,050 to 1,234 and leagues from 180 to 210."
            let span = "From the week of \(first.week.formattedFull) to the week of \(last.week.formattedFull)"
            let users = "users grew from \(GrowthFormat.count(first.users)) to \(GrowthFormat.count(last.users))"
            let leagues = "leagues from \(GrowthFormat.count(first.leagues)) to \(GrowthFormat.count(last.leagues))"
            growthSummary = "\(span), \(users) and \(leagues)."
        } else {
            growthSummary = ""
        }
        monthsSince = stats.monthly.first.map {
            GrowthFormat.bucket($0.month, GrowthFormat.utc.month(.abbreviated).year())
        } ?? ""
    }
}

/// Weekly running totals of users and leagues (the web's `GrowthLineChart`).
/// Users are a solid gold line, leagues a dashed blue one, so the series
/// differ by more than color. Each point reads "Week of Oct 5, 2026: 1,234
/// users"; a visible summary under the chart states the overall change.
struct GrowthLineChart: View {
    let data: GrowthChartData

    private static let usersSeries = "Users"
    private static let leaguesSeries = "Leagues"

    var body: some View {
        if data.weeks.count < 2 {
            Text("Not enough history for a trend yet.")
                .frFont(.bodySmall)
                .foregroundStyle(Color.frTextSecondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 32)
        } else {
            VStack(alignment: .leading, spacing: 12) {
                chart
                    .frame(height: 220)
                legend
                Text(data.growthSummary)
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var chart: some View {
        Chart {
            ForEach(data.weeks) { week in
                LineMark(
                    x: .value("Week", week.date),
                    y: .value("Total", week.users),
                    series: .value("Series", Self.usersSeries)
                )
                .foregroundStyle(Color.frGold)
                .lineStyle(StrokeStyle(lineWidth: 2))
                .accessibilityLabel(Text(week.label))
                .accessibilityValue(Text(verbatim: week.usersValue))

                LineMark(
                    x: .value("Week", week.date),
                    y: .value("Total", week.leagues),
                    series: .value("Series", Self.leaguesSeries)
                )
                .foregroundStyle(Color.frInfo)
                .lineStyle(StrokeStyle(lineWidth: 2, dash: [6, 4]))
                .accessibilityLabel(Text(week.label))
                .accessibilityValue(Text(verbatim: week.leaguesValue))
            }
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                AxisGridLine()
                AxisValueLabel(format: GrowthFormat.utc.month(.abbreviated).year(.twoDigits))
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading)
        }
    }

    private var legend: some View {
        HStack(spacing: 16) {
            if let last = data.weeks.last {
                legendItem(Self.usersSeries, value: last.users, color: .frGold, dashed: false)
                legendItem(Self.leaguesSeries, value: last.leagues, color: .frInfo, dashed: true)
            }
        }
    }

    private func legendItem(_ name: String, value: Int, color: Color, dashed: Bool) -> some View {
        HStack(spacing: 6) {
            Path { path in
                path.move(to: CGPoint(x: 0, y: 1))
                path.addLine(to: CGPoint(x: 16, y: 1))
            }
            .stroke(color, style: StrokeStyle(lineWidth: 2, dash: dashed ? [4, 3] : []))
            .frame(width: 16, height: 2)
            .accessibilityHidden(true)
            Text(verbatim: "\(name) \(GrowthFormat.count(value))")
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
        }
        .accessibilityElement(children: .combine)
    }
}

/// New signups or leagues per calendar month (UTC), as gold bars with the
/// count above each (the web's `MonthlyBars`).
struct GrowthMonthlyBars: View {
    enum Field {
        case signups
        case leagues
    }

    let title: String
    let data: GrowthChartData
    let field: Field

    private func value(_ month: GrowthChartData.MonthBar) -> Int {
        switch field {
        case .signups: month.signups
        case .leagues: month.leagues
        }
    }

    var body: some View {
        let months = data.months
        VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
            if months.isEmpty {
                SectionHeader(title)
            } else {
                let total = months.reduce(0) { $0 + value($1) }
                SectionHeader(title, detail: "\(GrowthFormat.count(total)) since \(data.monthsSince)")
            }
            FRCard {
                if months.isEmpty {
                    Text("No months to show yet.")
                        .frFont(.bodySmall)
                        .foregroundStyle(Color.frTextSecondary)
                } else {
                    chart(months)
                        .frame(height: 180)
                }
            }
        }
    }

    private func chart(_ months: [GrowthChartData.MonthBar]) -> some View {
        Chart(months) { month in
            let count = value(month)
            BarMark(
                x: .value("Month", month.iso),
                y: .value("Count", count)
            )
            .foregroundStyle(Color.frGold)
            .annotation(position: .top) {
                Text(verbatim: count > 0 ? GrowthFormat.count(count) : "")
                    .frFont(.caption)
                    .foregroundStyle(Color.frTextSecondary)
            }
            .accessibilityLabel(Text(month.spokenMonth))
            .accessibilityValue(Text(GrowthFormat.count(count)))
        }
        .chartXAxis {
            AxisMarks { axisValue in
                AxisValueLabel {
                    Text(verbatim: axisValue.as(String.self).flatMap { data.initials[$0] } ?? "")
                }
            }
        }
        .chartYAxis(.hidden)
    }
}
