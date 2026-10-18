import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation

/// The season's open bids, the bidding week and the caller's counterpick
/// capacity (F-12). Owned by `LeagueSeasonStore` so the Bids tab, its sheets,
/// the Home banner and the tab badge share one copy.
@Observable
@MainActor
final class BidsStore {
    struct Snapshot: Equatable {
        /// Every pending pickup bid in the league, newest first.
        var pickupBids: [PickupBid]
        /// Every pending counterpick bid in the league, newest first.
        var counterpickBids: [CounterpickBid]
        var week: BidWeek
        var biddingCounterpickCount: Int
        var scoredTMDbIDs: Set<TMDbID>
    }

    private(set) var state: LoadState<Snapshot> = .idle
    private(set) var history: LoadState<[BidHistoryRound]> = .idle
    private(set) var leagueID: LeagueID
    private(set) var teamID: TeamID?
    let repository: any BidRepository
    private let refresher = RefreshCoalescer()
    /// Cancels from the Bids tab, so one error shows above the list.
    let cancelling = AsyncAction()
    /// My bids that were active at the last read, to announce a new outbid once.
    private var lastActiveBidIDs: Set<BidID>?

    init(leagueID: LeagueID, repository: any BidRepository) {
        self.leagueID = leagueID
        self.repository = repository
    }

    var snapshot: Snapshot? { state.value }

    func update(leagueID: LeagueID, teamID: TeamID?) async {
        // An idle store has never read: load it even when nothing changed.
        if case .idle = state {} else {
            guard leagueID != self.leagueID || teamID != self.teamID else { return }
        }
        let leagueChanged = leagueID != self.leagueID
        self.leagueID = leagueID
        self.teamID = teamID
        if leagueChanged {
            state = .idle
            history = .idle
            lastActiveBidIDs = nil
        }
        await refresh()
    }

    func refresh() async {
        await refresher.run { [weak self] in await self?.performRefresh() }
    }

    private func performRefresh() async {
        let repository = repository
        let leagueID = leagueID
        let teamID = teamID
        if case .idle = state { state = .loading }
        do {
            async let pickups = repository.fetchPendingPickupBids(in: leagueID)
            async let counterpicks = repository.fetchPendingCounterpickBids(in: leagueID)
            async let week = repository.fetchBidWeek(for: leagueID)
            async let scored = repository.fetchScoredUpcomingTMDbIDs()
            var count = 0
            if let teamID { count = try await repository.fetchBiddingCounterpickCount(for: teamID) }
            let snapshot = Snapshot(
                pickupBids: try await pickups,
                counterpickBids: try await counterpicks,
                week: try await week,
                biddingCounterpickCount: count,
                scoredTMDbIDs: try await scored
            )
            announceNewOutbids(in: snapshot)
            if state != .loaded(snapshot) { state = .loaded(snapshot) }
        } catch {
            if case .loaded = state { return }
            state = .failed(message: APIError.wrap(error).userMessage)
        }
    }

    func loadHistory() async {
        if case .idle = history { history = .loading }
        do {
            let settled = try await repository.fetchSettledBids(in: leagueID)
            let rounds = BidHistory.group(pickupBids: settled.pickups, counterpickBids: settled.counterpicks)
            history = rounds.isEmpty ? .empty : .loaded(rounds)
        } catch {
            if case .loaded = history { return }
            history = .failed(message: error.userMessage)
        }
    }

    // MARK: Derived

    /// My pending pickup bids in priority order (priority, then placed).
    var myPickupBids: [PickupBid] {
        guard let teamID else { return [] }
        return (snapshot?.pickupBids ?? [])
            .filter { $0.teamID == teamID }
            .sorted { ($0.priority, $0.createdAt) < ($1.priority, $1.createdAt) }
    }

    /// Whether I can place, raise or counter any counterpick bid: the server
    /// refuses all of them once my bidding counterpick slots are used.
    func hasFreeCounterpickSlot(slots: Int) -> Bool {
        guard let snapshot else { return false }
        return snapshot.biddingCounterpickCount < slots
    }

    /// My pending counterpick bids in priority order.
    var myCounterpickBids: [CounterpickBid] {
        guard let teamID else { return [] }
        return (snapshot?.counterpickBids ?? [])
            .filter { $0.teamID == teamID }
            .sorted { ($0.priority, $0.createdAt) < ($1.priority, $1.createdAt) }
    }

    /// My outbid offers, the ones that need a decision.
    var outbidCount: Int {
        myPickupBids.filter { $0.status == .outbid }.count + myCounterpickBids.filter { $0.status == .outbid }.count
    }

    /// Sum of my pending offers (outbid ones are still committed).
    var amountInOpenBids: Int {
        myPickupBids.reduce(0) { $0 + $1.amount } + myCounterpickBids.reduce(0) { $0 + $1.amount }
    }

    /// The current leading bid on a movie.
    func highPickupBid(on tmdbID: TMDbID) -> PickupBid? {
        snapshot?.pickupBids.first { $0.tmdbID == tmdbID && $0.status == .active }
    }

    func highCounterpickBid(on movieID: MovieID) -> CounterpickBid? {
        snapshot?.counterpickBids.first { $0.movieID == movieID && $0.status == .active }
    }

    /// When my leading bid is held by a rival's open counter window.
    func counterWindow(forPickup tmdbID: TMDbID, now: Date = Date()) -> Date? {
        BidTiming.latestOpenCounterWindow(
            (snapshot?.pickupBids ?? []).filter { $0.tmdbID == tmdbID }.map(\.responseDeadline), now: now
        )
    }

    func counterWindow(forCounterpick movieID: MovieID, now: Date = Date()) -> Date? {
        BidTiming.latestOpenCounterWindow(
            (snapshot?.counterpickBids ?? []).filter { $0.movieID == movieID }.map(\.responseDeadline), now: now
        )
    }

    // MARK: Mutations

    func place(_ request: PlacePickupBid) async throws -> PlaceBidResult {
        let result = try await repository.placePickupBid(request)
        await refresh()
        return result
    }

    func placeCounterpick(movie: MovieID, amount: Int) async throws -> PlaceBidResult {
        let result = try await repository.placeCounterpickBid(league: leagueID, movie: movie, amount: amount)
        await refresh()
        return result
    }

    func cancel(pickup bid: PickupBid) async throws {
        try await repository.cancelPickupBid(bid.id)
        Announcer.announce("Bid cancelled")
        await refresh()
    }

    func cancel(counterpick bid: CounterpickBid) async throws {
        try await repository.cancelCounterpickBid(bid.id)
        Announcer.announce("Counterpick bid cancelled")
        await refresh()
    }

    /// Saves both orders, skipping a list that didn't change.
    func savePriorities(pickups: [BidID]?, counterpicks: [BidID]?) async throws {
        if let pickups { try await repository.setPickupPriorities(league: leagueID, bidIDs: pickups) }
        if let counterpicks { try await repository.setCounterpickPriorities(league: leagueID, bidIDs: counterpicks) }
        await refresh()
    }

    private func announceNewOutbids(in snapshot: Snapshot) {
        guard let teamID else { return }
        let mine = snapshot.pickupBids.filter { $0.teamID == teamID }
        let myCounterpicks = snapshot.counterpickBids.filter { $0.teamID == teamID }
        let active = Set(mine.filter { $0.status == .active }.map(\.id) + myCounterpicks.filter { $0.status == .active }.map(\.id))
        defer { lastActiveBidIDs = active }
        guard let previous = lastActiveBidIDs else { return }
        let titles = mine.filter { $0.status == .outbid && previous.contains($0.id) }.map(\.title)
            + myCounterpicks.filter { $0.status == .outbid && previous.contains($0.id) }.map { "the counterpick on \($0.title)" }
        guard !titles.isEmpty else { return }
        Announcer.announce("You've been outbid on \(titles.joined(separator: " and ")). Counter before your response window closes.")
    }
}
