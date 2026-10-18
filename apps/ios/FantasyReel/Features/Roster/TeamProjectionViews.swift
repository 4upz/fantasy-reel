import FantasyReelCore
import SwiftUI

/// Where my team is projected to finish (Beta, F-19; mockup V2Roster), with
/// the sum behind it a tap away. Renders nothing unless the league has
/// projections on and some movie still to come rests on one.
struct ProjectedFinishCard: View {
    let teamID: TeamID

    @Environment(LeagueSeasonStore.self) private var store
    @Environment(ShellRouter.self) private var router

    var body: some View {
        if store.season.status == .active, let standings = store.projectedStandings,
           let team = standings.first(where: { $0.teamID == teamID }) {
            FRCard(padding: EdgeInsets(top: 16, leading: 16, bottom: 6, trailing: 16)) {
                VStack(alignment: .leading, spacing: 0) {
                    summary(team, of: standings.count)
                    FRHairline()
                        .padding(.top, 12)
                    Button {
                        router.present(.teamProjection(teamID))
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "plus.forwardslash.minus")
                                .font(.subheadline.weight(.semibold))
                                .accessibilityHidden(true)
                            Text("How it adds up")
                                .frFont(.rowTitle)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            RowChevron()
                        }
                        .foregroundStyle(Color.frGold)
                        .frame(minHeight: FRMetrics.minTapTarget)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Shows each movie still to count")
                }
            }
            .transition(.opacity)
        }
    }

    private func summary(_ team: ProjectedStandings.Standing, of count: Int) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text("Projected finish")
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
                    .accessibilityAddTraits(.isHeader)
                BetaBadge()
            }
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(ProjectedStandings.positionLabel(team))
                    .frFont(.numberLarge)
                    .foregroundStyle(Color.frGold)
                Text("≈ \(FantasyPoints.whole(team.projected)) pts")
                    .frFont(.number)
                    .foregroundStyle(Color.frTextSecondary)
            }
            .padding(.top, 4)
            Text("of \(count) · \(team.remaining) still to count · official rank uses real points only")
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "Projected finish, Beta: \(ProjectedStandings.spokenPosition(team)) of \(count), "
                + "about \(FantasyPoints.whole(team.projected)) points. "
                + "\(team.remaining) still to count. Official rank uses real points only."
        )
    }
}

/// "How it adds up" (mockup V2TeamProjection, web `TeamProjectionSheet`): a
/// team's earned points, then each movie still to come at its most likely
/// points, and the projected total. Opened from the roster's Projected finish
/// card and from a projected standings row.
struct TeamProjectionView: View {
    let teamID: TeamID

    @Environment(LeagueSeasonStore.self) private var store
    @Environment(ShellRouter.self) private var router

    var body: some View {
        Group {
            if let standings = store.projectedStandings,
               let index = standings.firstIndex(where: { $0.teamID == teamID }) {
                content(standings[index], standings: standings, index: index)
            } else {
                // Projections went off (or the season ended) while this was open.
                EmptyStateView(
                    title: "No projection right now",
                    message: "Projected finishes show once this season's movies have projections.",
                    systemImage: "chart.line.uptrend.xyaxis"
                )
            }
        }
        .background(Color.frSheetBackground)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { router.dismissSheet() }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func content(_ team: ProjectedStandings.Standing, standings: [ProjectedStandings.Standing], index: Int) -> some View {
        let nextClosest = standings.indices.contains(index == 0 ? 1 : index - 1) ? standings[index == 0 ? 1 : index - 1] : nil
        let pending = team.pendingLegs
        let earnedCount = team.earnedLegs.count
        return ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                FRRowGroup {
                    ListRow(
                        title: "Earned so far",
                        meta: earnedCount == 0 ? "Nothing has counted yet" : "\(earnedCount) \(earnedCount == 1 ? "movie has" : "movies have") counted",
                        accessibilityLabel: "Earned so far, \(FantasyPoints.whole(team.earned)) points, from \(earnedCount) \(earnedCount == 1 ? "movie" : "movies")"
                    ) {
                        TrailingValue(FantasyPoints.whole(team.earned), tone: team.earned < 0 ? .negative : .neutral)
                    }
                }

                SectionHeader("Still to release", detail: String(pending.count))
                if pending.isEmpty {
                    EmptyRowsCard(message: "Every movie has counted.")
                } else {
                    FRRowGroup {
                        ForEach(pending) { leg in
                            PendingLegRow(leg: leg)
                        }
                    }
                }

                FRCard {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Projected total")
                            .frFont(.rowTitle)
                            .foregroundStyle(Color.frText)
                        Spacer()
                        Text("≈ \(FantasyPoints.whole(team.projected))")
                            .frFont(.numberLarge)
                            .foregroundStyle(Color.frGold)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Projected total, about \(FantasyPoints.whole(team.projected)) points")
                }

                Text(footnote(nextClosest))
                    .frFont(.caption)
                    .foregroundStyle(Color.frTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 16)
                TMDbAttribution()
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 0) {
                    Text(team.teamName)
                        .font(.headline)
                        .foregroundStyle(Color.frText)
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        Text("Projected \(ProjectedStandings.positionLabel(team)) of \(standings.count)")
                            .frFont(.meta)
                            .foregroundStyle(Color.frTextSecondary)
                        BetaBadge()
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityAddTraits(.isHeader)
                .accessibilityLabel("\(team.teamName), projected \(ProjectedStandings.spokenPosition(team)) of \(standings.count), Beta")
            }
        }
    }

    private func footnote(_ nextClosest: ProjectedStandings.Standing?) -> String {
        var text = "Each unreleased movie counts at its most likely score."
        if let nextClosest {
            text += " Next closest: \(nextClosest.teamName) at about \(FantasyPoints.whole(nextClosest.projected))."
        }
        return text + " Rank and champions still come from real points only. " + ProjectionText.disclaimer
    }
}

/// One movie still to count, at its most likely points for this team.
private struct PendingLegRow: View {
    let leg: ProjectedStandings.Leg

    var body: some View {
        let accessory: ProjectionAccessory? = leg.basis == .projection ? ProjectionAccessory(leg.projection) : nil
        MovieRow(
            title: leg.title,
            meta: meta,
            posterURL: leg.posterURL,
            accessibilityLabel: accessibilityText(accessory),
            accessory: accessory?.view
        ) {
            if leg.basis == .none {
                TrailingValue("—", tone: .muted)
            } else {
                TrailingValue("≈ \(FantasyPoints.signed(leg.points))", tone: leg.points < 0 ? .negative : .gold)
            }
        }
    }

    private var meta: String {
        var parts: [String] = []
        if leg.counterpick { parts.append("Counterpick") }
        if let date = leg.releaseDate { parts.append(DateOnly.display(date, style: .short)) }
        switch leg.basis {
        case .preRelease: parts.append("Pre-release score")
        case .none: parts.append("No projection yet")
        default: break
        }
        return parts.joined(separator: " · ")
    }

    private func accessibilityText(_ accessory: ProjectionAccessory?) -> String {
        var parts = [leg.title, meta]
        if let accessory { parts.append(accessory.spokenLabel) }
        parts.append(leg.basis == .none ? "adds nothing yet" : "about \(FantasyPoints.spokenLabel(leg.points, preRelease: false))")
        return parts.filter { !$0.isEmpty }.joined(separator: ", ")
    }
}
