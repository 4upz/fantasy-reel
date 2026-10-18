import FantasyReelCore
import SwiftUI

/// Settled bidding rounds, newest first: who won each movie, for how much,
/// and who else bid (F-12 History). Five rounds at a time.
struct BidHistoryContent: View {
    @Environment(LeagueSeasonStore.self) private var season
    @State private var visibleRounds = 5

    var body: some View {
        let bids = season.bids
        LoadStateView(
            bids.history,
            loadingLabel: "Loading results…",
            retry: { Task { await bids.loadHistory() } },
            content: { rounds in
                ForEach(rounds.prefix(visibleRounds)) { round in
                    SectionHeader(round.date.formatted(.full))
                    FRRowGroup {
                        ForEach(round.results) { result in
                            BidResultRow(result: result)
                        }
                    }
                }
                if rounds.count > visibleRounds {
                    Button("Show earlier rounds") { visibleRounds += 5 }
                        .buttonStyle(.fr(.secondary, size: .medium, fullWidth: true))
                }
                TMDbAttribution()
            },
            empty: {
                EmptyStateView(
                    title: "No results yet",
                    message: "Bids settle once a week. After the next round processes, this is where you'll see who won each movie, what they paid, and who they outbid.",
                    systemImage: "clock.arrow.circlepath"
                )
            }
        )
        .task { await bids.loadHistory() }
    }
}

private struct BidResultRow: View {
    let result: BidHistoryResult

    @Environment(LeagueSeasonStore.self) private var season

    var body: some View {
        let myTeamID = season.myTeam?.id
        let involved = result.winner?.teamID == myTeamID || result.losers.contains { $0.teamID == myTeamID }
        VStack(alignment: .leading, spacing: 0) {
            MovieRow(title: result.title, meta: headline, posterURL: result.posterURL) {
                VStack(alignment: .trailing, spacing: 4) {
                    TrailingValue(result.winner.map { SeasonFormat.budget($0.amount) } ?? "No winner", caption: result.winner == nil ? nil : "winning bid")
                    if involved {
                        FRBadge(result.winner?.teamID == myTeamID ? "You won" : "You lost", tone: result.winner?.teamID == myTeamID ? .success : .neutral)
                    }
                }
            }
            if !result.losers.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text(result.winner == nil ? "Bids" : "Also bid")
                        .frFont(.overline)
                        .foregroundStyle(Color.frTextMuted)
                    ForEach(result.losers, id: \.bidID) { entry in
                        HStack {
                            Text(teamName(entry.teamID) + (entry.teamID == myTeamID ? " (you)" : ""))
                                .foregroundStyle(entry.teamID == myTeamID ? Color.frGold : Color.frTextSecondary)
                            if let reason = entry.reason?.explanation(isCounterpick: result.kind == .counterpick), entry.reason != .outbid {
                                Text("· \(reason)")
                                    .foregroundStyle(Color.frTextMuted)
                            }
                            Spacer()
                            Text(SeasonFormat.budget(entry.amount))
                                .foregroundStyle(Color.frTextSecondary)
                                .monospacedDigit()
                        }
                        .frFont(.meta)
                        .accessibilityElement(children: .combine)
                    }
                }
                .padding(.leading, FRMetrics.separatorInset)
                .padding(.trailing, FRMetrics.rowPadding)
                .padding(.bottom, 10)
            }
        }
    }

    private var headline: String {
        var parts: [String] = []
        if result.kind == .counterpick, let target = result.targetTeamID {
            parts.append("Counterpick on \(teamName(target))")
        }
        if let winner = result.winner {
            parts.append(teamName(winner.teamID) + (result.marginText.map { " · \($0)" } ?? ""))
        }
        return parts.joined(separator: " · ")
    }

    private func teamName(_ id: TeamID) -> String {
        season.team(id)?.team.name ?? "Unknown team"
    }
}
