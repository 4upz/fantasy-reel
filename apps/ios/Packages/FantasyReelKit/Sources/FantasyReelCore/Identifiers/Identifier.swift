import Foundation

/// A typed database id. `Tag` exists only at compile time, so a `TeamID` can't
/// be passed where a `HoldingID` belongs even though both are UUID strings on
/// the wire (N-06). Encodes and decodes as the bare string.
///
/// The conformances are unconditional: `Tag` is never stored, so it needn't be
/// `Sendable` or `Hashable` itself.
public struct Identifier<Tag>: Hashable, Codable, Sendable, CustomStringConvertible,
    ExpressibleByStringLiteral
{
    public let rawValue: String

    public init(_ rawValue: String) {
        self.rawValue = rawValue
    }

    public init(rawValue: String) {
        self.rawValue = rawValue
    }

    public init(stringLiteral value: String) {
        self.rawValue = value
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        self.rawValue = try container.decode(String.self)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    public var description: String { rawValue }

    public static func == (lhs: Identifier, rhs: Identifier) -> Bool {
        lhs.rawValue == rhs.rawValue
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(rawValue)
    }
}

public enum UserTag: Sendable {}
/// One season: `leagues.id`. Every gameplay read and mutation is scoped by it.
public enum LeagueTag: Sendable {}
/// The league identity that spans seasons: `league_series.id`.
public enum SeriesTag: Sendable {}
public enum TeamTag: Sendable {}
public enum ParticipantTag: Sendable {}
/// Our `movies.id`, not the TMDb id (see `TMDbID`).
public enum MovieTag: Sendable {}
/// `team_holdings.holding_id`: the `draft_picks` or `pickups` row id.
public enum HoldingTag: Sendable {}
public enum CounterpickTag: Sendable {}
public enum BidTag: Sendable {}
public enum TradeOfferTag: Sendable {}
public enum NotificationTag: Sendable {}
public enum InvitationTag: Sendable {}

public typealias UserID = Identifier<UserTag>
public typealias LeagueID = Identifier<LeagueTag>
public typealias SeriesID = Identifier<SeriesTag>
public typealias TeamID = Identifier<TeamTag>
public typealias ParticipantID = Identifier<ParticipantTag>
public typealias MovieID = Identifier<MovieTag>
public typealias HoldingID = Identifier<HoldingTag>
public typealias CounterpickID = Identifier<CounterpickTag>
public typealias BidID = Identifier<BidTag>
public typealias TradeOfferID = Identifier<TradeOfferTag>
public typealias NotificationID = Identifier<NotificationTag>
public typealias InvitationID = Identifier<InvitationTag>

/// A TMDb movie id: a bare JSON number, distinct from our own `MovieID`.
public struct TMDbID: Hashable, Codable, Sendable, RawRepresentable, CustomStringConvertible,
    ExpressibleByIntegerLiteral
{
    public let rawValue: Int

    public init(rawValue: Int) {
        self.rawValue = rawValue
    }

    public init(_ rawValue: Int) {
        self.rawValue = rawValue
    }

    public init(integerLiteral value: Int) {
        self.rawValue = value
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        self.rawValue = try container.decode(Int.self)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    public var description: String { String(rawValue) }
}
