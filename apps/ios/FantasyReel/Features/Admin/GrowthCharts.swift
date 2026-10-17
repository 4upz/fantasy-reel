import Charts
import FantasyReelCore
import SwiftUI

/// Weekly running totals of users and leagues (the web's `GrowthLineChart`).
/// Users are a solid gold line, leagues a dashed blue one, so the series
/// differ by more than color. Each point reads "Week of Oct 5, 2026: 1,234
/// users"; a visible summary under the chart states the overall change.
struct GrowthLineChart: View {
    let weeks: [GrowthStats.Week]

    private static let usersSeries = "Users"
    private static let leaguesSeries = "Leagues"

    var body: some View {
        if weeks.count < 2 {
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
                Text(summary)
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var chart: some View {
        Chart {
            ForEach(weeks) { week in
                LineMark(
                    x: .value("Week", week.week.date(in: .gmt)),
                    y: .value("Total", week.users),
                    series: .value("Series", Self.usersSeries)
                )
                .foregroundStyle(Color.frGold)
                .lineStyle(StrokeStyle(lineWidth: 2))
                .accessibilityLabel(Text(Self.weekLabel(week)))
                .accessibilityValue(Text(verbatim: "\(GrowthFormat.count(week.users)) users"))

                LineMark(
                    x: .value("Week", week.week.date(in: .gmt)),
                    y: .value("Total", week.leagues),
                    series: .value("Series", Self.leaguesSeries)
                )
                .foregroundStyle(Color.frInfo)
                .lineStyle(StrokeStyle(lineWidth: 2, dash: [6, 4]))
                .accessibilityLabel(Text(Self.weekLabel(week)))
                .accessibilityValue(Text(verbatim: "\(GrowthFormat.count(week.leagues)) leagues"))
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
            if let last = weeks.last {
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

    /// "From the week of September 7, 2026 to the week of October 5, 2026,
    /// users grew from 1,050 to 1,234 and leagues from 180 to 210."
    private var summary: String {
        guard let first = weeks.first, let last = weeks.last else { return "" }
        return "From the week of \(first.week.formattedFull) to the week of \(last.week.formattedFull), users grew from "
            + "\(GrowthFormat.count(first.users)) to \(GrowthFormat.count(last.users)) and leagues from "
            + "\(GrowthFormat.count(first.leagues)) to \(GrowthFormat.count(last.leagues))."
    }

    private static func weekLabel(_ week: GrowthStats.Week) -> String {
        "Week of \(week.week.formattedFull)"
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
    let months: [GrowthStats.Month]
    let field: Field

    private func value(_ month: GrowthStats.Month) -> Int {
        switch field {
        case .signups: month.signups
        case .leagues: month.leagues
        }
    }

    private var total: Int {
        months.reduce(0) { $0 + value($1) }
    }

    private var since: String {
        guard let first = months.first else { return "" }
        return GrowthFormat.bucket(first.month, GrowthFormat.utc.month(.abbreviated).year())
    }

    var body: some View {
        VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
            if months.isEmpty {
                SectionHeader(title)
            } else {
                SectionHeader(title, detail: "\(GrowthFormat.count(total)) since \(since)")
            }
            FRCard {
                if months.isEmpty {
                    Text("No months to show yet.")
                        .frFont(.bodySmall)
                        .foregroundStyle(Color.frTextSecondary)
                } else {
                    chart
                        .frame(height: 180)
                }
            }
        }
    }

    private var chart: some View {
        Chart(months) { month in
            BarMark(
                x: .value("Month", month.month.isoString),
                y: .value("Count", value(month))
            )
            .foregroundStyle(Color.frGold)
            .annotation(position: .top) {
                Text(verbatim: value(month) > 0 ? GrowthFormat.count(value(month)) : "")
                    .frFont(.caption)
                    .foregroundStyle(Color.frTextSecondary)
            }
            .accessibilityLabel(Text(GrowthFormat.bucket(month.month, GrowthFormat.utc.month(.wide).year())))
            .accessibilityValue(Text(GrowthFormat.count(value(month))))
        }
        .chartXAxis {
            AxisMarks { axisValue in
                AxisValueLabel {
                    Text(verbatim: Self.monthInitial(axisValue.as(String.self)))
                }
            }
        }
        .chartYAxis(.hidden)
    }

    /// "J" for a `YYYY-MM-DD` bucket, in UTC.
    private static func monthInitial(_ iso: String?) -> String {
        guard let iso, let date = DateOnly(iso) else { return "" }
        return GrowthFormat.bucket(date, GrowthFormat.utc.month(.narrow))
    }
}
