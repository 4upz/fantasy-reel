import FantasyReelCore
import Foundation

/// Trading (F-13). Every read and write goes through an Edge Function: get-trades
/// embeds the teams, the contested items and the anchor movie's title.
public protocol TradeRepository: Sendable {
    /// The league's offers, newest first (the first 50, as on the web).
    func fetchTrades(in leagueID: LeagueID) async throws(APIError) -> [TradeOffer]
    func propose(_ request: ProposeTrade) async throws(APIError)
    /// Overwrites the offer with the counterer's version; sides swap.
    func counter(_ request: CounterTrade) async throws(APIError)
    /// Returns the server's message ("Trade accepted and is now in review for 24 hours").
    func accept(_ offerID: TradeOfferID) async throws(APIError) -> String?
    func reject(_ offerID: TradeOfferID) async throws(APIError)
    func cancel(_ offerID: TradeOfferID) async throws(APIError)
    func veto(_ offerID: TradeOfferID, reason: String?) async throws(APIError)
    func approve(_ offerID: TradeOfferID) async throws(APIError)
    func extend(_ offerID: TradeOfferID, until expiresAt: Date) async throws(APIError)
}

/// A new offer: `give` is what my team sends, `receive` what I ask for.
public struct ProposeTrade: Sendable, Hashable {
    public var leagueID: LeagueID
    public var recipientTeamID: TeamID
    public var give: TradeItems
    public var receive: TradeItems
    public var message: String?
    public var expiry: TradeExpiryRequest

    public init(leagueID: LeagueID, recipientTeamID: TeamID, give: TradeItems, receive: TradeItems, message: String?, expiry: TradeExpiryRequest) {
        self.leagueID = leagueID
        self.recipientTeamID = recipientTeamID
        self.give = give
        self.receive = receive
        self.message = message
        self.expiry = expiry
    }
}

/// A counter to an offer sent to my team.
public struct CounterTrade: Sendable, Hashable {
    public var offerID: TradeOfferID
    public var give: TradeItems
    public var receive: TradeItems
    public var message: String?
    public var expiry: TradeExpiryRequest

    public init(offerID: TradeOfferID, give: TradeItems, receive: TradeItems, message: String?, expiry: TradeExpiryRequest) {
        self.offerID = offerID
        self.give = give
        self.receive = receive
        self.message = message
        self.expiry = expiry
    }
}

/// The three expiry keys, always sent (null for "No expiry").
private struct ExpiryFields: Encodable, Sendable {
    let request: TradeExpiryRequest

    enum CodingKeys: String, CodingKey {
        case expires_at, expiry_anchor, expiry_anchor_movie_id
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(request.expiresAt.map(ISO8601.string), forKey: .expires_at)
        try c.encode(request.anchor, forKey: .expiry_anchor)
        try c.encode(request.anchorMovieID?.rawValue, forKey: .expiry_anchor_movie_id)
    }
}

enum ISO8601 {
    static func string(_ date: Date) -> String {
        date.ISO8601Format()
    }
}

public struct EdgeTradeRepository: TradeRepository {
    private let functions: EdgeFunctionClient

    public init(functions: EdgeFunctionClient) {
        self.functions = functions
    }

    public func fetchTrades(in leagueID: LeagueID) async throws(APIError) -> [TradeOffer] {
        struct Response: Decodable, Sendable { let trades: [TradeOffer] }
        let response: Response = try await functions.invoke("get-trades", body: ["league_id": leagueID.rawValue])
        return response.trades
    }

    public func propose(_ request: ProposeTrade) async throws(APIError) {
        struct Body: Encodable, Sendable {
            let request: ProposeTrade
            enum CodingKeys: String, CodingKey { case league_id, recipient_team_id, offered_items, requested_items, message }
            func encode(to encoder: any Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(request.leagueID.rawValue, forKey: .league_id)
                try c.encode(request.recipientTeamID.rawValue, forKey: .recipient_team_id)
                try c.encode(request.give, forKey: .offered_items)
                try c.encode(request.receive, forKey: .requested_items)
                try c.encodeIfPresent(request.message, forKey: .message)
                try ExpiryFields(request: request.expiry).encode(to: encoder)
            }
        }
        let _: EmptyResponse = try await functions.invoke("propose-trade", body: Body(request: request))
    }

    public func counter(_ request: CounterTrade) async throws(APIError) {
        struct Body: Encodable, Sendable {
            let request: CounterTrade
            enum CodingKeys: String, CodingKey { case trade_offer_id, counter_offered_items, counter_requested_items, message }
            func encode(to encoder: any Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(request.offerID.rawValue, forKey: .trade_offer_id)
                try c.encode(request.give, forKey: .counter_offered_items)
                try c.encode(request.receive, forKey: .counter_requested_items)
                try c.encodeIfPresent(request.message, forKey: .message)
                try ExpiryFields(request: request.expiry).encode(to: encoder)
            }
        }
        let _: EmptyResponse = try await functions.invoke("counter-trade", body: Body(request: request))
    }

    public func accept(_ offerID: TradeOfferID) async throws(APIError) -> String? {
        struct Response: Decodable, Sendable { let message: String? }
        let response: Response = try await functions.invoke(
            "respond-trade", body: ["trade_offer_id": offerID.rawValue, "response": "accept"]
        )
        return response.message
    }

    public func reject(_ offerID: TradeOfferID) async throws(APIError) {
        let _: EmptyResponse = try await functions.invoke(
            "respond-trade", body: ["trade_offer_id": offerID.rawValue, "response": "reject"]
        )
    }

    public func cancel(_ offerID: TradeOfferID) async throws(APIError) {
        let _: EmptyResponse = try await functions.invoke("cancel-trade", body: ["trade_offer_id": offerID.rawValue])
    }

    public func veto(_ offerID: TradeOfferID, reason: String?) async throws(APIError) {
        var body = ["trade_offer_id": offerID.rawValue]
        if let reason { body["reason"] = reason }
        let _: EmptyResponse = try await functions.invoke("veto-trade", body: body)
    }

    public func approve(_ offerID: TradeOfferID) async throws(APIError) {
        let _: EmptyResponse = try await functions.invoke("approve-trade", body: ["trade_offer_id": offerID.rawValue])
    }

    public func extend(_ offerID: TradeOfferID, until expiresAt: Date) async throws(APIError) {
        let _: EmptyResponse = try await functions.invoke(
            "extend-trade-offer", body: ["trade_offer_id": offerID.rawValue, "expires_at": ISO8601.string(expiresAt)]
        )
    }
}
