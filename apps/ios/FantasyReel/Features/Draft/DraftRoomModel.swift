import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation

/// The draft room's state (F-08, F-09), the native `useDraftState` plus the
/// web draft client's submission handling.
///
/// - Reads the season, its members, every pick and every counterpick together,
///   so turn, progress and owner actions come from one moment. Overlapping
///   refresh requests coalesce into one read after the current one.
/// - Refreshes when the change feed joins or signals, on foreground, after
///   every mutation, and on a 5 s (live) or 10 s (periodic) reconcile loop.
/// - Holds one `DraftAttempt` while a submission's result is uncertain and
///   resolves it against the next read; a retry resends the same request id.
@Observable
@MainActor
final class DraftRoomModel {
    enum SubmissionStatus: Equatable {
        case idle
        case submitting
        /// The response was lost; the attempt is kept for a safe retry.
        case uncertain
        case failed(String)
    }

    let leagueID: LeagueID
    let userID: UserID
    /// The selection the room was opened from, for sheets and pushed screens.
    let selection: LeagueSelection

    private(set) var state: LoadState<DraftSnapshot> = .idle
    private(set) var connection: ConnectionStatus = .reconnecting
    /// A refresh failed while older data stays on screen.
    private(set) var refreshError: String?
    private(set) var counterpickOptions: LoadState<[CounterpickOption]> = .idle

    private(set) var pendingAttempt: DraftAttempt?
    private(set) var submissionStatus: SubmissionStatus = .idle
    /// Owner phase calls and draft-order edits, each double-tap protected.
    let phaseAction = AsyncAction()
    let orderAction = AsyncAction()

    private let leagues: any LeagueRepository
    private let lifecycle: any LeagueLifecycleRepository
    private let draft: any DraftRepository
    private let changeFeed: ChangeFeed?
    private var isRefreshing = false
    private var refreshAgain = false
    private var feedJoined = false

    /// A read that takes longer than this shows as a failed refresh.
    static let refreshDeadline: Duration = .seconds(15)

    init(selection: LeagueSelection, environment: AppEnvironment, usesChangeFeed: Bool = true) {
        self.selection = selection
        self.leagueID = selection.season.id
        self.userID = selection.userID
        self.leagues = environment.leagues
        self.lifecycle = environment.leagueLifecycle
        self.draft = environment.draft
        self.changeFeed = usesChangeFeed ? environment.changeFeed : nil
        // Without a feed (previews, screenshots) reads are the only source.
        self.connection = usesChangeFeed ? .reconnecting : .live
    }

    var snapshot: DraftSnapshot? { state.value }
    var me: LeagueMember? { snapshot?.participant(for: userID) }
    var isOwner: Bool { snapshot.map { $0.league.ownerID == userID } ?? selection.isOwner }
    var ownerActions: DraftOwnerActions { snapshot?.ownerActions(isOwner: isOwner) ?? [] }

    /// The open turn when it's this user's.
    var myTurn: DraftTurn? {
        guard let turn = snapshot?.currentTurn, turn.isMine(userID) else { return nil }
        return turn
    }

    /// Picks are refused while a submission is in flight or unresolved, or the
    /// room is showing data it couldn't refresh.
    var canSubmit: Bool {
        myTurn != nil && submissionStatus != .submitting && connection != .offline
    }

    // MARK: Refresh

    /// Re-reads the room. A call while a read is running queues one more read
    /// after it instead of starting a second one (the web's coalescing).
    func refresh() async {
        if isRefreshing {
            refreshAgain = true
            return
        }
        isRefreshing = true
        defer { isRefreshing = false }
        repeat {
            refreshAgain = false
            await readOnce()
        } while refreshAgain
    }

    private func readOnce() async {
        let previous = snapshot
        let leagueID = leagueID
        let leagues = leagues
        let draft = draft
        do {
            let read = try await withDeadline(Self.refreshDeadline, label: "draft-refresh") {
                () async throws -> (League?, [LeagueMember], [DraftPickRecord], [DraftCounterpick]) in
                async let season = leagues.fetchSeason(leagueID)
                async let members = leagues.fetchMembers(of: leagueID)
                async let picks = draft.fetchPicks(leagueID)
                async let counterpicks = draft.fetchCounterpicks(leagueID)
                return try await (season, members, picks, counterpicks)
            }
            guard let league = read.0 else {
                state = .failed(message: "This league isn't available any more.")
                return
            }
            let next = DraftSnapshot(league: league, participants: read.1, picks: read.2, counterpicks: read.3)
            state = .loaded(next)
            refreshError = nil
            if connection == .offline {
                connection = feedJoined || changeFeed == nil ? .live : .periodicUpdates
            }
            if let previous, let message = next.changeAnnouncement(since: previous, userID: userID) {
                Announcer.announce(message)
            }
            resolvePendingAttempt(in: next)
            await refreshCounterpickOptions(in: next)
        } catch is CancellationError {
            return
        } catch {
            let apiError = APIError.wrap(error)
            if apiError.isCancellation { return }
            if case .network(let code, _) = apiError, code == .notConnectedToInternet || code == .dataNotAllowed {
                connection = .offline
            }
            if snapshot == nil {
                state = .failed(message: apiError.userMessage)
            } else {
                refreshError = apiError.userMessage
            }
        }
    }

    private func refreshCounterpickOptions(in snapshot: DraftSnapshot) async {
        guard snapshot.league.status == .counterpicking,
              let teamID = snapshot.participant(for: userID)?.team?.id
        else {
            counterpickOptions = .idle
            return
        }
        if counterpickOptions.value == nil { counterpickOptions = .loading }
        do {
            let options = try await draft.fetchCounterpickOptions(leagueID, teamID: teamID)
            counterpickOptions = options.isEmpty ? .empty : .loaded(options)
        } catch {
            if counterpickOptions.value == nil { counterpickOptions = .failed(message: error.userMessage) }
        }
    }

    /// Follows the change feed until cancelled. Each signal (the first one
    /// confirms the subscription) re-reads the room.
    func watchChanges() async {
        guard let changeFeed else { return }
        let id = leagueID.rawValue
        let watches: [ChangeFeed.Watch] = [
            .init(table: "draft_picks", filter: .equals("league_id", id)),
            .init(table: "counterpicks", filter: .equals("league_id", id)),
            .init(table: "league_participants", filter: .equals("league_id", id)),
            .init(table: "leagues", filter: .equals("id", id)),
        ]
        connection = .reconnecting
        for await _ in changeFeed.signals(topic: "draft", watching: watches) {
            if !feedJoined {
                feedJoined = true
                if connection != .offline { connection = .live }
            }
            await refresh()
        }
        // The stream ends when the screen goes away, or when joining gave up.
        guard !Task.isCancelled else { return }
        feedJoined = false
        if connection != .offline { connection = .periodicUpdates }
    }

    /// Reconciles on the web's cadence while the scene is active: every 5 s
    /// while the feed is live, every 10 s when polling is the only source.
    func reconcileLoop() async {
        while !Task.isCancelled {
            let interval: Duration = connection == .live ? .seconds(5) : .seconds(10)
            do {
                try await Task.sleep(for: interval)
            } catch {
                return
            }
            await refresh()
        }
    }

    // MARK: Submissions

    /// Draft a TMDb movie, or counterpick an opponent's movie, at the open
    /// turn. Returns true once the pick is saved (or found saved).
    @discardableResult
    func submit(_ selection: DraftSelection, title: String) async -> Bool {
        guard submissionStatus != .submitting,
              let turn = myTurn, turn.kind == selection.kind
        else { return false }
        let attempt = pendingAttempt?.reused(for: selection, at: turn.overallPick, title: title)
            ?? DraftAttempt(leagueID: leagueID, selection: selection, expectedPick: turn.overallPick, title: title)
        pendingAttempt = attempt
        submissionStatus = .submitting
        do {
            _ = try await draft.submit(attempt)
            pendingAttempt = nil
            submissionStatus = .idle
            Announcer.announce(selection.kind == .draft ? "You drafted \(title)." : "You counterpicked \(title).")
            await refresh()
            return true
        } catch {
            if error.isCancellation {
                // The screen went away; keep the attempt so a return retries safely.
                submissionStatus = .uncertain
                return false
            }
            if error.isUncertainOutcome {
                submissionStatus = .uncertain
            } else {
                pendingAttempt = nil
                submissionStatus = .failed(error.userMessage)
            }
            await refresh()
            return pendingAttempt == nil && submissionStatus == .idle
        }
    }

    /// Resends the uncertain attempt with its original request id.
    func retryPendingAttempt() async {
        guard let attempt = pendingAttempt else { return }
        await refresh()
        guard let current = pendingAttempt, current == attempt else { return }
        await submit(attempt.selection, title: attempt.title)
    }

    func clearSubmissionError() {
        if case .failed = submissionStatus { submissionStatus = .idle }
    }

    /// After a read, settles an attempt whose response was lost.
    private func resolvePendingAttempt(in snapshot: DraftSnapshot) {
        guard let attempt = pendingAttempt, submissionStatus == .uncertain else { return }
        switch attempt.resolve(in: snapshot, teamID: snapshot.participant(for: userID)?.team?.id) {
        case .saved:
            pendingAttempt = nil
            submissionStatus = .idle
            Announcer.announce("Your pick of \(attempt.title) was saved.")
        case .superseded:
            pendingAttempt = nil
            submissionStatus = .failed("\(attempt.title) wasn't saved before the draft moved on.")
        case .stillOpen:
            break
        }
    }

    // MARK: Owner

    func startDraft() {
        phaseAction.run { [self] in
            defer { Task { await self.refresh() } }
            try await draft.startDraft(leagueID)
            Announcer.announce("The draft has started.")
        }
    }

    func startCounterpickRound() {
        phaseAction.run { [self] in
            defer { Task { await self.refresh() } }
            try await draft.startCounterpickRound(leagueID)
        }
    }

    /// Skip the round from a full board, or end the remainder while counterpicking.
    func skipCounterpickRound() {
        let endRemaining = snapshot?.league.status == .counterpicking
        phaseAction.run { [self] in
            defer { Task { await self.refresh() } }
            try await draft.skipCounterpickRound(leagueID, endRemaining: endRemaining)
        }
    }

    func randomizeOrder() {
        orderAction.run { [self] in
            defer { Task { await self.refresh() } }
            _ = try await lifecycle.update(leagueID, .randomizeDraftOrder)
            Announcer.announce("Draft order randomized.")
        }
    }

    /// Moves one member to another position and saves the whole order. The
    /// list updates at once; a failure re-reads the saved order.
    func move(_ memberID: ParticipantID, to destination: Int) {
        guard case .loaded(var snapshot) = state, !orderAction.isRunning else { return }
        var order = snapshot.orderedParticipants
        guard let from = order.firstIndex(where: { $0.id == memberID }) else { return }
        let to = min(max(destination, 0), order.count - 1)
        guard from != to else { return }
        order.insert(order.remove(at: from), at: to)
        for index in order.indices { order[index].participant.draftOrder = index + 1 }
        snapshot.participants = order
        state = .loaded(snapshot)
        let ids = order.map(\.id)
        let name = order[to].teamName
        orderAction.run { [self] in
            defer { Task { await self.refresh() } }
            _ = try await lifecycle.update(leagueID, .reorderDraft(ids))
            Announcer.announce("\(name) moved to pick \(to + 1).")
        }
    }
}
