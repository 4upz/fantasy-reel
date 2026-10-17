import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation

/// The season's trade offers (F-13). Owned by `LeagueSeasonStore` so the
/// Trades tab, its sheets, the tab badge and the Home banner share one copy.
@Observable
@MainActor
final class TradesStore {
    private(set) var state: LoadState<[TradeOffer]> = .idle
    private(set) var leagueID: LeagueID
    private(set) var teamID: TeamID?
    let repository: any TradeRepository
    /// Status and recipient at the last read (a counter keeps `countered` but
    /// swaps sides), to announce other people's changes once.
    private var lastStates: [TradeOfferID: OfferState]?
    /// My own action just changed these; skip announcing the echo.
    private var recentOwnActions: [TradeOfferID: Date] = [:]

    init(leagueID: LeagueID, repository: any TradeRepository) {
        self.leagueID = leagueID
        self.repository = repository
    }

    var trades: [TradeOffer] { state.value ?? [] }

    func update(leagueID: LeagueID, teamID: TeamID?) async {
        guard leagueID != self.leagueID || teamID != self.teamID else { return }
        if leagueID != self.leagueID {
            state = .idle
            lastStates = nil
        }
        self.leagueID = leagueID
        self.teamID = teamID
        await refresh()
    }

    func refresh() async {
        let repository = repository
        let leagueID = leagueID
        if case .idle = state { state = .loading }
        do {
            let trades = try await repository.fetchTrades(in: leagueID)
            announceChanges(in: trades)
            if state != .loaded(trades) { state = .loaded(trades) }
        } catch {
            if case .loaded = state { return }
            state = .failed(message: error.userMessage)
        }
    }

    // MARK: Derived

    var pending: [TradeOffer] { TradeLists.pending(trades) }
    var mine: [TradeOffer] { TradeLists.mine(trades, teamID: teamID) }
    var history: [TradeOffer] { TradeLists.history(trades) }
    var needingResponse: [TradeOffer] { TradeLists.needingResponse(trades, teamID: teamID) }

    func offer(_ id: TradeOfferID) -> TradeOffer? {
        trades.first { $0.id == id }
    }

    // MARK: Mutations

    func propose(_ request: ProposeTrade) async throws {
        try await repository.propose(request)
        await refresh()
    }

    func counter(_ request: CounterTrade) async throws {
        markOwnAction(request.offerID)
        do {
            try await repository.counter(request)
        } catch {
            await refresh()
            throw error
        }
        await refresh()
    }

    func accept(_ offer: TradeOffer) async throws -> String? {
        markOwnAction(offer.id)
        do {
            let message = try await repository.accept(offer.id)
            await refresh()
            return message
        } catch {
            await refresh()
            throw error
        }
    }

    func reject(_ offer: TradeOffer) async throws {
        markOwnAction(offer.id)
        do {
            try await repository.reject(offer.id)
        } catch {
            await refresh()
            throw error
        }
        Announcer.announce("You rejected the trade offer from \(offer.initiatorName).")
        await refresh()
    }

    func cancel(_ offer: TradeOffer) async throws {
        markOwnAction(offer.id)
        try await repository.cancel(offer.id)
        Announcer.announce("You cancelled your trade offer to \(offer.recipientName).")
        await refresh()
    }

    func veto(_ offer: TradeOffer, reason: String?) async throws {
        markOwnAction(offer.id)
        try await repository.veto(offer.id, reason: reason)
        Announcer.announce("You vetoed the trade between \(offer.initiatorName) and \(offer.recipientName).")
        await refresh()
    }

    func approve(_ offer: TradeOffer) async throws {
        markOwnAction(offer.id)
        try await repository.approve(offer.id)
        Announcer.announce("You approved the trade between \(offer.initiatorName) and \(offer.recipientName). It has been processed.")
        await refresh()
    }

    func extend(_ offer: TradeOffer, until expiresAt: Date) async throws {
        markOwnAction(offer.id)
        do {
            try await repository.extend(offer.id, until: expiresAt)
        } catch {
            await refresh()
            throw error
        }
        Announcer.announce("Offer extended. It now expires \(TradeExpiry.absolute(expiresAt)).")
        await refresh()
    }

    private func markOwnAction(_ id: TradeOfferID) {
        recentOwnActions[id] = Date()
    }

    /// Announces other people's changes to my offers (`describeTradeChange`),
    /// skipping offers I acted on in the last 15 seconds.
    private func announceChanges(in trades: [TradeOffer]) {
        let states = Dictionary(trades.map { ($0.id, OfferState(offer: $0)) }, uniquingKeysWith: { first, _ in first })
        defer { lastStates = states }
        guard let previous = lastStates, let teamID else { return }
        let now = Date()
        recentOwnActions = recentOwnActions.filter { now.timeIntervalSince($0.value) < 15 }
        for offer in trades where offer.involves(teamID) && recentOwnActions[offer.id] == nil {
            let before = previous[offer.id]
            guard before != OfferState(offer: offer) else { continue }
            if let message = Self.describe(offer, previous: before?.status, teamID: teamID) {
                Announcer.announce(message)
            }
        }
    }

    private struct OfferState: Equatable {
        let status: TradeStatus
        let recipientTeamID: TeamID

        init(offer: TradeOffer) {
            status = offer.status
            recipientTeamID = offer.recipientTeamID
        }
    }

    static func describe(_ offer: TradeOffer, previous: TradeStatus?, teamID: TeamID) -> String? {
        let isRecipient = offer.recipientTeamID == teamID
        let other = isRecipient ? offer.initiatorName : offer.recipientName
        switch offer.status {
        case .proposed where previous == nil && isRecipient:
            return "New trade offer from \(offer.initiatorName)."
        case .countered where isRecipient:
            return "\(offer.initiatorName) sent you a counter-offer."
        case .review, .accepted:
            return isRecipient ? nil : "\(offer.recipientName) accepted your trade offer."
        case .rejected where !isRecipient:
            return "\(offer.recipientName) rejected your trade offer."
        case .cancelled where isRecipient:
            return "\(offer.initiatorName) cancelled their trade offer."
        case .vetoed:
            return "The commissioner vetoed your trade with \(other)."
        case .completed:
            return "Your trade with \(other) went through."
        case .expired:
            return "Your trade with \(other) expired."
        default:
            return nil
        }
    }
}
