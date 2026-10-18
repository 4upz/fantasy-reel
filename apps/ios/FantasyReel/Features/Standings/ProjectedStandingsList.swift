import FantasyReelCore
import SwiftUI

/// Projected standings (Beta, F-19; mockup V2StandingsProjected): every team
/// ranked as if each unreleased movie lands at its most likely score. Shown
/// beside the real table, never instead of it: rank and champions come from
/// real points only. A row opens "How it adds up".
struct ProjectedStandingsList: View {
    let standings: [ProjectedStandings.Standing]

    @Environment(LeagueSeasonStore.self) private var store

    var body: some View {
        let toRelease = ProjectedStandings.moviesToRelease(standings)
        Text("If every unreleased movie lands at its most likely score. \(toRelease) \(toRelease == 1 ? "movie" : "movies") still to release, counting a counterpicked movie once. Tap a team to see how it adds up.")
            .frFont(.caption)
            .foregroundStyle(Color.frTextSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 4)

        HStack {
            Text("Proj.").frame(width: 48, alignment: .leading)
            Text("Team").frame(maxWidth: .infinity, alignment: .leading)
            Text("Proj. pts").padding(.trailing, 20)
        }
        .frFont(.overline)
        .foregroundStyle(Color.frTextSecondary)
        .padding(.horizontal, 16)
        .padding(.bottom, -4)
        .accessibilityHidden(true)

        FRRowGroup(separatorInset: 64) {
            ForEach(standings) { team in
                ProjectedStandingRow(team: team, isMe: store.team(team.teamID)?.userID == store.userID)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Projected standings, Beta")

        Text((standings.contains(where: \.tossUp) ? "Toss-up: the gap is smaller than the uncertainty in what's left. " : "")
            + "Rank and champions still come from real points only.")
            .frFont(.caption)
            .foregroundStyle(Color.frTextSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 16)
    }
}

private struct ProjectedStandingRow: View {
    let team: ProjectedStandings.Standing
    let isMe: Bool

    @Environment(ShellRouter.self) private var router

    var body: some View {
        Button {
            router.present(.teamProjection(team.teamID))
        } label: {
            ListRow(
                title: team.teamName,
                meta: (isMe ? "You · " : "") + "Now \(FantasyPoints.whole(team.earned)) · \(team.remaining) left",
                showsChevron: true,
                accessibilityLabel: accessibilityText
            ) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(CompetitionRank.label(rank: team.projectedRank, isTied: team.isTied))
                        .frFont(.number)
                        .foregroundStyle(rankColor)
                    RankChangeLabel(change: team.rankChange)
                }
                .frame(minWidth: 36, alignment: .leading)
                .fixedSize()
            } trailing: {
                VStack(alignment: .trailing, spacing: 2) {
                    Text(FantasyPoints.whole(team.projected))
                        .frFont(.number)
                        .foregroundStyle(Color.frText)
                    if team.tossUp {
                        Text("Toss-up")
                            .frFont(.captionStrong)
                            .foregroundStyle(Color.frWarning)
                    }
                }
                .frame(minWidth: FRMetrics.trailingColumn, alignment: .trailing)
            }
            .background(isMe ? Color.frGoldTint : Color.clear)
        }
        .buttonStyle(.frRow)
        .accessibilityHint("Shows how it adds up")
    }

    private var rankColor: Color {
        switch team.projectedRank {
        case 1: .frGold
        case 2: .frSilver
        case 3: .frBronze
        default: .frTextSecondary
        }
    }

    private var accessibilityText: String {
        var parts = [
            team.isTied ? "Tied for projected rank \(team.projectedRank)" : "Projected rank \(team.projectedRank)",
            RankChangeLabel.spoken(team.rankChange),
            team.teamName,
        ]
        if isMe { parts.append("your team") }
        if team.tossUp { parts.append("toss-up") }
        parts.append("about \(FantasyPoints.whole(team.projected)) projected points")
        parts.append("now \(FantasyPoints.whole(team.earned))")
        parts.append("\(team.remaining) left")
        return parts.joined(separator: ", ")
    }
}

/// "▲1" up, "▼2" down, "–" level. The arrow, not the color, carries the
/// direction, and VoiceOver hears it in words.
private struct RankChangeLabel: View {
    let change: Int

    var body: some View {
        Group {
            if change > 0 {
                Text("▲\(change)").foregroundStyle(Color.frSuccess)
            } else if change < 0 {
                Text("▼\(-change)").foregroundStyle(Color.frError)
            } else {
                Text("–").foregroundStyle(Color.frTextSecondary)
            }
        }
        .frFont(change == 0 ? .caption : .captionStrong)
    }

    static func spoken(_ change: Int) -> String {
        if change > 0 { return "up \(change) from the current standings" }
        if change < 0 { return "down \(-change) from the current standings" }
        return "same as the current standings"
    }
}
