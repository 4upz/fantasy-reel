import FantasyReelCore
import Foundation

/// An in-memory `TradeRepository` for previews, screenshots and tests. Moves
/// offers through their statuses; it doesn't validate rosters or move movies.
public actor InMemoryTradeRepository: TradeRepository {
    public var trades: [TradeOffer]
    public var myTeamID: TeamID?
    public var reviewEnabled: Bool
    public var teamNames: [TeamID: String]
    public var failure: APIError?

    public init(trades: [TradeOffer] = [], myTeamID: TeamID? = nil, reviewEnabled: Bool = true, teamNames: [TeamID: String] = [:]) {
        self.trades = trades
        self.myTeamID = myTeamID
        self.reviewEnabled = reviewEnabled
        self.teamNames = teamNames
    }

    public func setFailure(_ error: APIError?) { failure = error }

    private func check() throws(APIError) {
        if let failure { throw failure }
    }

    private func update(_ id: TradeOfferID, _ change: (inout TradeOffer) -> Void) {
        guard let index = trades.firstIndex(where: { $0.id == id }) else { return }
        change(&trades[index])
    }

    private func ref(_ id: TeamID) -> TradeOffer.TeamRef {
        TradeOffer.TeamRef(id: id, name: teamNames[id] ?? "Team")
    }

    public func fetchTrades(in leagueID: LeagueID) async throws(APIError) -> [TradeOffer] {
        try check()
        return trades.filter { $0.leagueID == leagueID }.sorted { $0.createdAt > $1.createdAt }
    }

    public func propose(_ request: ProposeTrade) async throws(APIError) {
        try check()
        guard let myTeamID else { return }
        let now = Date()
        trades.append(TradeOffer(
            id: TradeOfferID(UUID().uuidString.lowercased()), leagueID: request.leagueID,
            initiatorTeamID: myTeamID, recipientTeamID: request.recipientTeamID,
            initiatorItems: request.give, recipientItems: request.receive,
            status: .proposed, proposedAt: now, initiatorMessage: request.message,
            expiresAt: request.expiry.expiresAt, expiryAnchor: request.expiry.anchor,
            createdAt: now, initiatorTeam: ref(myTeamID), recipientTeam: ref(request.recipientTeamID)
        ))
    }

    public func counter(_ request: CounterTrade) async throws(APIError) {
        try check()
        update(request.offerID) { offer in
            swap(&offer.initiatorTeamID, &offer.recipientTeamID)
            swap(&offer.initiatorTeam, &offer.recipientTeam)
            offer.initiatorItems = request.give
            offer.recipientItems = request.receive
            offer.status = .countered
            offer.responseMessage = request.message
            offer.expiresAt = request.expiry.expiresAt
            offer.expiryAnchor = request.expiry.anchor
        }
    }

    public func accept(_ offerID: TradeOfferID) async throws(APIError) -> String? {
        try check()
        let review = reviewEnabled
        update(offerID) { offer in
            offer.status = review ? .review : .accepted
            offer.reviewEndsAt = review ? Date().addingTimeInterval(24 * 3600) : nil
        }
        return review ? "Trade accepted and is now in review for 24 hours" : "Trade accepted"
    }

    public func reject(_ offerID: TradeOfferID) async throws(APIError) {
        try check()
        update(offerID) { $0.status = .rejected }
    }

    public func cancel(_ offerID: TradeOfferID) async throws(APIError) {
        try check()
        update(offerID) { $0.status = .cancelled }
    }

    public func veto(_ offerID: TradeOfferID, reason: String?) async throws(APIError) {
        try check()
        update(offerID) { offer in
            offer.status = .vetoed
            offer.vetoReason = reason
        }
    }

    public func approve(_ offerID: TradeOfferID) async throws(APIError) {
        try check()
        update(offerID) { $0.status = .completed }
    }

    public func extend(_ offerID: TradeOfferID, until expiresAt: Date) async throws(APIError) {
        try check()
        update(offerID) { offer in
            offer.expiresAt = expiresAt
            offer.expiryAnchor = "fixed"
        }
    }
}
