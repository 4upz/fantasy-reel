import FantasyReelCore
import SwiftUI

/// The live snake draft (V2Draft): the turn card with Choose a Movie, owner
/// controls once the board is full, then the board by round, newest first.
struct LiveDraftSection: View {
    let model: DraftRoomModel
    let snapshot: DraftSnapshot

    @Environment(ShellRouter.self) private var router

    var body: some View {
        DraftTurnCard(
            turn: snapshot.currentDraftTurn,
            totalPicks: snapshot.totalDraftPicks,
            upNext: snapshot.upcomingDraftTurns(limit: 3),
            userID: model.userID
        ) {
            if snapshot.currentDraftTurn != nil {
                Button(model.myTurn == nil ? "Browse Movies" : "Choose a Movie") {
                    router.present(.draftMoviePicker(DraftRoomHandle(model)))
                }
                .buttonStyle(.fr(model.myTurn == nil ? .secondary : .primary, isLoading: model.submissionStatus == .submitting))
                .accessibilityHint(model.myTurn == nil ? "Research movies while you wait for your turn." : "")
            }
        }
        DraftSubmissionNotice(model: model)
        if snapshot.isDraftBoardFull {
            DraftCompleteOwnerControls(model: model, snapshot: snapshot)
        }
        DraftBoardList(snapshot: snapshot, userID: model.userID)
        TMDbAttribution()
    }
}

/// The board is full but the phase hasn't moved: the owner opens the
/// counterpick round or skips it; everyone else waits.
private struct DraftCompleteOwnerControls: View {
    let model: DraftRoomModel
    let snapshot: DraftSnapshot
    @State private var confirmSkip = false

    var body: some View {
        let actions = model.ownerActions
        FRCard {
            VStack(alignment: .leading, spacing: 12) {
                Text("Every pick is in")
                    .frFont(.cardTitle)
                    .foregroundStyle(Color.frText)
                Text(actions.isEmpty
                    ? "Waiting for the commissioner to start the counterpick round or begin the season."
                    : "Start the counterpick round, or skip it and begin the season.")
                    .frFont(.bodySmall)
                    .foregroundStyle(Color.frTextSecondary)
                if actions.contains(.startCounterpicks) {
                    Button("Start Counterpick Round") { model.startCounterpickRound() }
                        .buttonStyle(.fr(.primary, isLoading: model.phaseAction.isRunning))
                }
                if actions.contains(.skipCounterpicks) {
                    Button("Skip Counterpicks…") { confirmSkip = true }
                        .buttonStyle(.fr(actions.contains(.startCounterpicks) ? .neutral : .primary))
                        .disabled(model.phaseAction.isRunning)
                }
                if let message = model.phaseAction.errorMessage {
                    Text(message)
                        .frFont(.label)
                        .foregroundStyle(Color.frError)
                }
            }
        }
        .confirmationDialog("Skip the counterpick round?", isPresented: $confirmSkip, titleVisibility: .visible) {
            Button("Skip and Start Season", role: .destructive) { model.skipCounterpickRound() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Teams won't be able to claim draft-phase counterpicks.")
        }
    }
}

/// Every round of the board, newest first. Open slots of the round in
/// progress show whose they are; this user's are labelled.
struct DraftBoardList: View {
    let snapshot: DraftSnapshot
    let userID: UserID

    @Environment(ShellRouter.self) private var router

    var body: some View {
        let rounds = snapshot.draftBoardRounds
        if rounds.isEmpty {
            EmptyStateView(title: "No picks yet", message: "Picks appear here as they're made.", systemImage: "list.number")
        }
        ForEach(rounds) { round in
            VStack(spacing: 8) {
                SectionHeader("Round \(round.round)", detail: round.pickRange.map { "Picks \($0.lowerBound)–\($0.upperBound)" } ?? "")
                FRRowGroup(separatorInset: 108) {
                    ForEach(round.slots) { slot in
                        slotRow(slot)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func slotRow(_ slot: DraftBoardSlot) -> some View {
        if let pick = slot.pick, let movie = pick.movie {
            Button {
                router.push(.movie(movie.tmdbID))
            } label: {
                BoardRow(label: slot.label) {
                    MovieRow(
                        title: movie.title,
                        meta: [DateOnly.display(movie.releaseDate, style: .medium), teamLabel(pick.teamID)].joined(separator: " · "),
                        posterURL: movie.posterURL,
                        showsChevron: true
                    )
                }
            }
            .buttonStyle(.frRow)
        } else {
            let isCurrent = snapshot.currentDraftTurn?.overallPick == slot.overallPick
            let member = slot.turn?.participant
            let isMine = member?.userID == userID
            BoardRow(label: slot.label) {
                ListRow(
                    title: isMine ? "Your pick" : member?.teamName ?? "Open pick",
                    meta: [
                        isMine ? member?.teamName : member?.displayName,
                        isCurrent ? "on the clock" : nil,
                    ].compactMap { $0 }.joined(separator: " · ")
                ) {
                    Avatar(name: member?.teamName ?? "?", imageURL: member?.team?.avatarURL, size: .custom(36), corners: .rounded, fill: isCurrent ? .brand : .neutral)
                } trailing: {
                    if isCurrent {
                        FRBadge("Now", tone: .gold)
                    }
                }
            }
        }
    }

    private func teamLabel(_ teamID: TeamID) -> String {
        let member = snapshot.participant(forTeam: teamID)
        let name = snapshot.teamName(teamID)
        return member?.userID == userID ? "\(name) (you)" : name
    }
}

/// A board row: the "2.9" slot label, then the row.
private struct BoardRow<Content: View>: View {
    let label: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        HStack(spacing: 0) {
            Text(label)
                .frFont(.number)
                .foregroundStyle(Color.frTextSecondary)
                .frame(width: 44)
                .padding(.leading, 8)
                .accessibilityLabel("Pick \(label)")
            content()
                .padding(.leading, -8)
        }
        .accessibilityElement(children: .combine)
    }
}
