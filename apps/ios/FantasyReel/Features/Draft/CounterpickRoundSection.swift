import FantasyReelCore
import SwiftUI

/// The draft's counterpick round (V2Counterpick): reverse-snake turn, how a
/// counterpick scores, opponents' eligible movies grouped by team, and the
/// commissioner's End control. Counterpicks made so far are listed below.
struct CounterpickRoundSection: View {
    let model: DraftRoomModel
    let snapshot: DraftSnapshot

    @State private var pendingPick: CounterpickOption?
    @State private var confirmEnd = false

    var body: some View {
        DraftTurnCard(
            turn: snapshot.currentCounterpickTurn,
            totalPicks: snapshot.totalCounterpicks,
            upNext: snapshot.upcomingCounterpickTurns(limit: 3),
            userID: model.userID,
            detail: "scores inverted"
        ) {
            if let teamID = model.me?.team?.id {
                let left = snapshot.counterpicksRemaining(for: teamID)
                Text(left == 1 ? "You have 1 counterpick left." : "You have \(left) counterpicks left.")
                    .frFont(.label)
                    .foregroundStyle(Color.frTextSecondary)
            }
        }
        DraftSubmissionNotice(model: model)
        CounterpickExplainer()
        options
        if !snapshot.draftCounterpicks.isEmpty {
            madeCounterpicks
        }
        if model.ownerActions.contains(.endCounterpicks) {
            VStack(spacing: 6) {
                Button("End Counterpick Round…") { confirmEnd = true }
                    .buttonStyle(.fr(.destructive, isLoading: model.phaseAction.isRunning))
                Text("Commissioner only. Asks to confirm; counterpicks already made are kept.")
                    .frFont(.label)
                    .foregroundStyle(Color.frTextSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let message = model.phaseAction.errorMessage {
                    Text(message)
                        .frFont(.label)
                        .foregroundStyle(Color.frError)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.top, 8)
        }
        TMDbAttribution()
            .confirmationDialog(
                "End the remaining counterpicks?",
                isPresented: $confirmEnd,
                titleVisibility: .visible
            ) {
                Button("End and Start Season", role: .destructive) { model.skipCounterpickRound() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("End the remaining counterpicks and activate the league? Existing counterpicks will be kept. This cannot be undone.")
            }
            .confirmationDialog(
                pendingPick.map { "Counterpick \($0.title)?" } ?? "",
                isPresented: Binding(get: { pendingPick != nil }, set: { if !$0 { pendingPick = nil } }),
                titleVisibility: .visible,
                presenting: pendingPick
            ) { option in
                Button("Counterpick") {
                    Task { await model.submit(.counterpick(option.movieID), title: option.title) }
                }
                Button("Cancel", role: .cancel) {}
            } message: { option in
                Text("You'll score the inverse of \(option.ownerTeamName)'s points for it. It uses no roster slot.")
            }
    }

    @ViewBuilder
    private var options: some View {
        switch model.counterpickOptions {
        case .idle, .loading:
            LoadingView(label: "Loading eligible movies…")
                .frame(minHeight: 120)
        case .failed(let message):
            ErrorStateView(title: "Couldn't load eligible movies", message: message, layout: .card) {
                Task { await model.refresh() }
            }
        case .empty:
            EmptyStateView(
                title: "No eligible movies",
                message: model.isOwner
                    ? "No opponent movie can be counterpicked. You can end the round below."
                    : "No opponent movie can be counterpicked. The commissioner can end the round.",
                systemImage: "arrow.uturn.down"
            )
        case .loaded(let options):
            ForEach(groups(options), id: \.teamID) { group in
                VStack(spacing: 8) {
                    SectionHeader(group.teamName, detail: "\(group.options.count) eligible")
                    FRRowGroup {
                        ForEach(group.options) { option in
                            optionRow(option)
                        }
                    }
                }
            }
        }
    }

    private func optionRow(_ option: CounterpickOption) -> some View {
        let round = option.draftPickID.flatMap(snapshot.draftRound(ofHolding:))
        let meta = [
            DateOnly.display(option.releaseDate, style: .short),
            round.map { "Round \($0)" },
            option.fantasyPoints.map { "\(FantasyPoints.signed(-$0)) for you" },
        ].compactMap { $0 }.joined(separator: " · ")
        return MovieRow(title: option.title, meta: meta, posterURL: option.posterURL) {
            Button("Pick") { pendingPick = option }
                .buttonStyle(.fr(.secondary, size: .compact))
                .disabled(!model.canSubmit || model.myTurn?.kind != .counterpick)
                .accessibilityLabel("Counterpick \(option.title)")
        }
    }

    private var madeCounterpicks: some View {
        VStack(spacing: 8) {
            SectionHeader("Counterpicks", detail: "\(snapshot.counterpicksMade) of \(snapshot.totalCounterpicks)")
            FRRowGroup {
                ForEach(snapshot.draftCounterpicks.sorted { $0.pickOrder < $1.pickOrder }) { counterpick in
                    MovieRow(
                        title: counterpick.movie?.title ?? "Movie",
                        meta: "\(snapshot.teamName(counterpick.counterpickerTeamID)) against \(snapshot.teamName(counterpick.targetTeamID))",
                        posterURL: counterpick.movie?.posterURL
                    )
                }
            }
        }
    }

    private struct TeamOptions {
        let teamID: TeamID
        let teamName: String
        let options: [CounterpickOption]
    }

    /// Grouped by owning team, in draft order.
    private func groups(_ options: [CounterpickOption]) -> [TeamOptions] {
        let byTeam = Dictionary(grouping: options, by: \.ownerTeamID)
        return snapshot.orderedParticipants.compactMap { member in
            guard let teamID = member.team?.id, let options = byTeam[teamID], !options.isEmpty else { return nil }
            return TeamOptions(teamID: teamID, teamName: options[0].ownerTeamName, options: options)
        }
    }
}

/// "A −16 movie scores +16 for you. Uses no roster slot."
private struct CounterpickExplainer: View {
    var body: some View {
        HStack(spacing: 10) {
            PointsText(-16, role: .numberSmall)
            Text("movie scores")
                .frFont(.bodySmall)
                .foregroundStyle(Color.frTextSecondary)
            PointsText(16, role: .numberSmall)
            Text("for you. Uses no roster slot.")
                .frFont(.bodySmall)
                .foregroundStyle(Color.frTextSecondary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, FRMetrics.cardPadding)
        .padding(.vertical, 12)
        .frCardBackground()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("A counterpick scores the inverse: a movie that scores minus 16 earns you plus 16. It uses no roster slot.")
    }
}
