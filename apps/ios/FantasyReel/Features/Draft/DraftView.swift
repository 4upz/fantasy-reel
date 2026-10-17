import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// The Draft tab (F-08, F-09): the setup room, the live snake draft, or the
/// counterpick round, by the season's saved phase.
struct DraftView: View {
    @Environment(\.leagueSelection) private var selection

    var body: some View {
        if let selection {
            DraftRoomView(selection: selection)
                .id(selection.season.id)
        }
    }
}

/// Owns the room model for one season and keeps it current.
private struct DraftRoomView: View {
    let selection: LeagueSelection

    @Environment(AppEnvironment.self) private var environment
    @Environment(\.scenePhase) private var scenePhase
    @State private var model: DraftRoomModel?

    var body: some View {
        Group {
            if let model {
                DraftRoomContent(model: model)
                    .task { await model.watchChanges() }
                    .task(id: scenePhase == .active) {
                        guard scenePhase == .active else { return }
                        await model.reconcileLoop()
                    }
                    .refreshOnForeground { await model.refresh() }
            } else {
                LoadingView(label: "Loading the draft…")
            }
        }
        .background(Color.frBackground)
        .task {
            guard model == nil else { return }
            let model = DraftRoomModel(
                selection: selection,
                leagues: environment.leagues,
                lifecycle: environment.leagueLifecycle,
                draft: environment.draft,
                changeFeed: environment.changeFeed
            )
            self.model = model
            await model.refresh()
        }
    }
}

/// The room's screen for whatever phase the latest read shows. Screenshot
/// scenes render this directly with a seeded model.
struct DraftRoomContent: View {
    let model: DraftRoomModel

    var body: some View {
        switch model.state {
        case .idle, .loading:
            LoadingView(label: "Loading the draft…")
        case .failed(let message):
            ScrollView {
                VStack(spacing: FRMetrics.sectionSpacing) {
                    DraftHeader(model: model)
                    ErrorStateView(title: "Draft didn't load", message: message, layout: .card) {
                        Task { await model.refresh() }
                    }
                }
                .padding(.horizontal, FRMetrics.pageMargin)
            }
        case .empty:
            EmptyView()
        case .loaded(let snapshot):
            ScrollView {
                VStack(spacing: FRMetrics.sectionSpacing) {
                    DraftHeader(model: model)
                    DraftConnectionNotice(model: model)
                    switch snapshot.league.status {
                    case .setup:
                        DraftSetupSection(model: model, snapshot: snapshot)
                    case .drafting:
                        LiveDraftSection(model: model, snapshot: snapshot)
                    case .counterpicking:
                        CounterpickRoundSection(model: model, snapshot: snapshot)
                    case .active, .completed, .unknown:
                        DraftRecordSection(snapshot: snapshot, userID: model.userID)
                    }
                }
                .padding(.horizontal, FRMetrics.pageMargin)
                .padding(.bottom, 24)
            }
            .refreshable { await model.refresh() }
        }
    }
}

/// "Office Movie Club · 2027 Season", "Draft", the phase badge and the
/// connection indicator once the draft is under way.
private struct DraftHeader: View {
    let model: DraftRoomModel

    var body: some View {
        let league = model.snapshot?.league ?? model.selection.season
        ScreenHeader(
            "Draft",
            eyebrow: "\(league.name) · \(String(league.seasonYear)) Season",
            subtitle: subtitle(league),
            status: league.status
        ) {
            if model.isLive {
                ConnectionStatusIndicator(status: model.connection)
            }
        }
    }

    private func subtitle(_ league: League) -> String? {
        guard let snapshot = model.snapshot else { return nil }
        switch league.status {
        case .setup:
            return "\(snapshot.teamCount) of \(league.maxParticipants) joined"
        case .counterpicking:
            let round = snapshot.currentCounterpickTurn?.round ?? snapshot.counterpickRounds
            return "Round \(round) of \(snapshot.counterpickRounds) · reverse snake"
        default:
            return nil
        }
    }
}

/// The reconnecting/offline banner and a failed refresh over older data. A
/// live connection needs no banner; the header dot says it.
private struct DraftConnectionNotice: View {
    let model: DraftRoomModel

    var body: some View {
        if model.isLive, model.connection == .offline || model.connection == .reconnecting {
            ConnectionStatusBanner(status: model.connection, message: "Showing last saved draft.")
        } else if model.isLive, model.connection == .periodicUpdates {
            ConnectionStatusBanner(status: .periodicUpdates)
        }
        if let message = model.refreshError, model.connection != .offline {
            InlineBanner(
                tone: .warning,
                title: "Couldn't refresh the draft",
                message: message,
                systemImage: "exclamationmark.triangle",
                actionTitle: "Try Again"
            ) {
                Task { await model.refresh() }
            }
        }
    }
}

/// The open turn: "You're on the clock" with the action, or who's picking,
/// plus the next few teams.
struct DraftTurnCard<Action: View>: View {
    let turn: DraftTurn?
    let totalPicks: Int
    let upNext: [DraftTurn]
    let userID: UserID
    /// "scores inverted" for the counterpick round.
    var detail: String?
    /// Offline: picks wait until the connection is back (V2DraftOffline).
    var isPaused = false
    @ViewBuilder let action: () -> Action

    var body: some View {
        let isMine = turn?.isMine(userID) ?? false
        FRCard(tone: isMine ? .success : nil) {
            VStack(alignment: .leading, spacing: 14) {
                if let turn {
                    HStack(alignment: .top, spacing: 12) {
                        Avatar(name: turn.participant.teamName, imageURL: turn.participant.team?.avatarURL, size: .large, corners: .rounded)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(title(turn, isMine: isMine))
                                .frFont(.cardTitle)
                                .foregroundStyle(Color.frText)
                            Text(progress(turn))
                                .frFont(.meta)
                                .foregroundStyle(Color.frTextSecondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        if isPaused {
                            FRBadge("Paused", tone: .warning, systemImage: "pause.fill")
                        }
                    }
                    .accessibilityElement(children: .combine)
                    if !upNext.isEmpty {
                        UpNextRow(turns: upNext, userID: userID)
                    }
                    action()
                } else {
                    Text("Waiting for the commissioner")
                        .frFont(.cardTitle)
                        .foregroundStyle(Color.frText)
                }
            }
        }
    }

    private func title(_ turn: DraftTurn, isMine: Bool) -> String {
        switch (turn.kind, isMine) {
        case (.draft, true): "You're on the clock"
        case (.counterpick, true): "Your counterpick"
        case (.draft, false): "\(turn.participant.teamName) is on the clock"
        case (.counterpick, false): "\(turn.participant.teamName) is counterpicking"
        }
    }

    private func progress(_ turn: DraftTurn) -> String {
        var parts = turn.kind == .draft
            ? ["Round \(turn.round) · Pick \(turn.overallPick) of \(totalPicks)"]
            : ["Pick \(turn.overallPick) of \(totalPicks)"]
        if let detail { parts.append(detail) }
        return parts.joined(separator: " · ")
    }
}

private struct UpNextRow: View {
    let turns: [DraftTurn]
    let userID: UserID

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        // At accessibility sizes the names stack instead of truncating.
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(spacing: 10))
        layout {
            Text("Up next")
                .frFont(.label)
                .foregroundStyle(Color.frTextSecondary)
            ForEach(turns, id: \.overallPick) { turn in
                HStack(spacing: 6) {
                    Avatar(name: turn.participant.teamName, imageURL: turn.participant.team?.avatarURL, size: .small)
                    Text(name(turn))
                        .frFont(.label)
                        .foregroundStyle(Color.frText)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Up next: " + turns.map(name).joined(separator: ", "))
    }

    private func name(_ turn: DraftTurn) -> String {
        turn.isMine(userID) ? "You" : turn.participant.firstName
    }
}

extension LeagueMember {
    /// "Bob" for "Bob Nolan": the short name the queue and picker rows use.
    var firstName: String {
        displayName.split(separator: " ").first.map(String.init) ?? displayName
    }
}

/// The lost-response and refused-pick states (V2DraftOffline).
struct DraftSubmissionNotice: View {
    let model: DraftRoomModel

    var body: some View {
        switch model.submissionStatus {
        case .uncertain:
            InlineBanner(
                tone: .warning,
                title: "Couldn't confirm your pick",
                message: "\(model.pendingAttempt?.title ?? "Your pick") · checking the draft first",
                systemImage: "questionmark.circle",
                actionTitle: "Retry Safely",
                actionPlacement: .below
            ) {
                Task { await model.retryPendingAttempt() }
            }
        case .failed(let message):
            InlineBanner(
                tone: .error,
                title: "Pick not saved",
                message: message,
                systemImage: "exclamationmark.triangle",
                actionTitle: "Dismiss"
            ) {
                model.clearSubmissionError()
            }
        case .idle, .submitting:
            EmptyView()
        }
    }
}

/// After the draft: the picks as a read-only record (V2DraftOffline "Read-only").
private struct DraftRecordSection: View {
    let snapshot: DraftSnapshot
    let userID: UserID

    var body: some View {
        Label(
            snapshot.league.status == .completed
                ? "Read-only. Season complete; the draft is a record now."
                : "Read-only. The draft is over; this is the record of every pick.",
            systemImage: "lock.fill"
        )
        .frFont(.meta)
        .foregroundStyle(Color.frTextSecondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        DraftBoardList(snapshot: snapshot, userID: userID)
        TMDbAttribution()
    }
}

/// Draft results, pushed from the league menu once the season is active.
struct DraftResultsView: View {
    @Environment(\.leagueSelection) private var selection
    @Environment(AppEnvironment.self) private var environment
    @State private var model: DraftRoomModel?

    var body: some View {
        Group {
            if let model, let snapshot = model.snapshot {
                ScrollView {
                    VStack(spacing: FRMetrics.sectionSpacing) {
                        DraftBoardList(snapshot: snapshot, userID: model.userID)
                        TMDbAttribution()
                    }
                    .padding(.horizontal, FRMetrics.pageMargin)
                    .padding(.bottom, 24)
                }
                .refreshable { await model.refresh() }
            } else if let message = model?.state.errorMessage {
                ErrorStateView(title: "Draft didn't load", message: message) {
                    Task { await model?.refresh() }
                }
            } else {
                LoadingView(label: "Loading the draft…")
            }
        }
        .background(Color.frBackground)
        .navigationTitle("Draft Results")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard model == nil, let selection else { return }
            let model = DraftRoomModel(
                selection: selection,
                leagues: environment.leagues,
                lifecycle: environment.leagueLifecycle,
                draft: environment.draft,
                changeFeed: nil
            )
            self.model = model
            await model.refresh()
        }
    }
}
