import Foundation

/// One coherent read of the draft room: the season row, its active
/// participants, every draft pick and every counterpick. The web reads these
/// four together (`useDraftState`) and so does the app, so turn, progress and
/// owner actions always come from the same moment.
public struct DraftSnapshot: Sendable, Hashable {
    public var league: League
    public var participants: [LeagueMember]
    public var picks: [DraftPickRecord]
    public var counterpicks: [DraftCounterpick]

    public init(
        league: League,
        participants: [LeagueMember],
        picks: [DraftPickRecord],
        counterpicks: [DraftCounterpick]
    ) {
        self.league = league
        self.participants = participants
        self.picks = picks
        self.counterpicks = counterpicks
    }

    // MARK: Participants

    /// Participants in draft order. Before an order exists (`draft_order` is
    /// null until the owner sets one or the draft starts) they keep join order,
    /// after any that do have a position.
    public var orderedParticipants: [LeagueMember] { participants.sortedByDraftOrder() }

    public var teamCount: Int { participants.count }

    public func participant(for userID: UserID?) -> LeagueMember? {
        guard let userID else { return nil }
        return participants.first { $0.userID == userID }
    }

    public func participant(forTeam teamID: TeamID) -> LeagueMember? {
        participants.first { $0.team?.id == teamID }
    }

    public func teamName(_ teamID: TeamID) -> String {
        participant(forTeam: teamID)?.teamName ?? "Another team"
    }

    // MARK: Draft

    /// Rounds equal `draft_slots`.
    public var draftRounds: Int { max(league.draftSlots, 0) }
    public var totalDraftPicks: Int { teamCount * draftRounds }
    public var draftPicksMade: Int { picks.count }

    /// Every slot is filled. The phase can still be `drafting`: the owner
    /// chooses what comes next (start counterpicks, or skip to the season).
    public var isDraftBoardFull: Bool { totalDraftPicks > 0 && draftPicksMade >= totalDraftPicks }

    /// Whose turn it is in the draft, or nil when the phase isn't drafting or
    /// the board is full.
    public var currentDraftTurn: DraftTurn? {
        guard league.status == .drafting else { return nil }
        return turn(at: draftPicksMade, rounds: draftRounds, kind: .draft)
    }

    /// The picks after the current one, for the "Up next" queue.
    public func upcomingDraftTurns(limit: Int) -> [DraftTurn] {
        guard league.status == .drafting else { return [] }
        return upcoming(from: draftPicksMade, rounds: draftRounds, kind: .draft, limit: limit)
    }

    /// Who picked (or will pick) at a zero-based overall index in the draft.
    public func draftTurn(at index: Int) -> DraftTurn? {
        turn(at: index, rounds: draftRounds, kind: .draft)
    }

    /// The board grouped by round, newest round first: made picks plus the open
    /// slots of the round in progress, so the current pick shows in context.
    public var draftBoardRounds: [DraftBoardRound] {
        let count = teamCount
        guard count > 0, draftRounds > 0 else { return [] }
        let byOverall = Dictionary(picks.map { ($0.overallPick(teamCount: count), $0) }, uniquingKeysWith: { first, _ in first })
        let currentRound = min(draftPicksMade / count + 1, draftRounds)
        let lastRound = league.status == .drafting ? currentRound : (picks.map(\.round).max() ?? 0)
        guard lastRound > 0 else { return [] }
        return (1...lastRound).reversed().map { round in
            let slots = (1...count).map { pickNumber -> DraftBoardSlot in
                let overall = (round - 1) * count + pickNumber
                return DraftBoardSlot(
                    round: round,
                    pickNumber: pickNumber,
                    overallPick: overall,
                    pick: byOverall[overall],
                    turn: turn(at: overall - 1, rounds: draftRounds, kind: .draft)
                )
            }
            return DraftBoardRound(round: round, slots: slots)
        }
    }

    /// TMDb ids already drafted, for the movie picker's "Drafted by" state.
    public var draftedTMDbIDs: Set<TMDbID> {
        Set(picks.compactMap { $0.movie?.tmdbID })
    }

    /// Who drafted a TMDb movie, when someone has.
    public func drafter(of tmdbID: TMDbID) -> LeagueMember? {
        guard let pick = picks.first(where: { $0.movie?.tmdbID == tmdbID }) else { return nil }
        return participant(forTeam: pick.teamID)
    }

    // MARK: Counterpick round

    /// Counterpick rounds equal `draft_counterpick_slots`.
    public var counterpickRounds: Int { max(league.draftCounterpickSlots, 0) }
    public var totalCounterpicks: Int { teamCount * counterpickRounds }

    /// Draft-round counterpicks only; season bids won later don't count.
    public var draftCounterpicks: [DraftCounterpick] {
        counterpicks.filter { $0.phase != .bidding }
    }

    public var counterpicksMade: Int { draftCounterpicks.count }

    /// Whose counterpick it is (reverse snake), or nil when the phase isn't
    /// counterpicking or every slot is used.
    public var currentCounterpickTurn: DraftTurn? {
        guard league.status == .counterpicking else { return nil }
        return turn(at: counterpicksMade, rounds: counterpickRounds, kind: .counterpick)
    }

    public func upcomingCounterpickTurns(limit: Int) -> [DraftTurn] {
        guard league.status == .counterpicking else { return [] }
        return upcoming(from: counterpicksMade, rounds: counterpickRounds, kind: .counterpick, limit: limit)
    }

    /// How many draft-round counterpicks a team still has.
    public func counterpicksRemaining(for teamID: TeamID) -> Int {
        let used = draftCounterpicks.filter { $0.counterpickerTeamID == teamID }.count
        return max(counterpickRounds - used, 0)
    }

    /// The draft round a holding was picked in, for counterpick option rows.
    public func draftRound(ofHolding id: HoldingID) -> Int? {
        picks.first { $0.id == id }?.round
    }

    // MARK: Turns

    /// The turn currently open in this phase, draft or counterpick.
    public var currentTurn: DraftTurn? {
        switch league.status {
        case .drafting: currentDraftTurn
        case .counterpicking: currentCounterpickTurn
        default: nil
        }
    }

    /// Who is up at a zero-based overall index. The draft snakes (1-2-3, 3-2-1);
    /// the counterpick round runs the reverse snake (3-2-1, 1-2-3), exactly as
    /// `get_next_draft_pick` and `get_next_counterpick_turn` do.
    func turn(at index: Int, rounds: Int, kind: DraftTurn.Kind) -> DraftTurn? {
        let count = teamCount
        guard count > 0, index >= 0, index < count * rounds else { return nil }
        let round = index / count + 1
        let pickNumber = index % count + 1
        let ascending = (round % 2 == 1) != (kind == .counterpick)
        let order = ascending ? pickNumber : count - pickNumber + 1
        guard let participant = participants.first(where: { $0.participant.draftOrder == order }) else { return nil }
        return DraftTurn(kind: kind, round: round, pickNumber: pickNumber, overallPick: index + 1, participant: participant)
    }

    private func upcoming(from index: Int, rounds: Int, kind: DraftTurn.Kind, limit: Int) -> [DraftTurn] {
        guard limit > 0 else { return [] }
        let end = min(index + 1 + limit, teamCount * rounds)
        guard end > index + 1 else { return [] }
        return (index + 1..<end).compactMap { turn(at: $0, rounds: rounds, kind: kind) }
    }

    // MARK: Owner actions

    /// What the owner may do next, derived from the saved phase and counts; a
    /// full board doesn't imply the season started (requirements §2).
    public func ownerActions(isOwner: Bool) -> DraftOwnerActions {
        guard isOwner else { return [] }
        var actions: DraftOwnerActions = []
        switch league.status {
        case .setup:
            actions.insert(.startDraft)
            actions.insert(.editOrder)
        case .drafting where isDraftBoardFull:
            if counterpickRounds > 0 { actions.insert(.startCounterpicks) }
            actions.insert(.skipCounterpicks)
        case .counterpicking:
            actions.insert(.endCounterpicks)
        default:
            break
        }
        return actions
    }
}

/// One turn of the draft or its counterpick round.
public struct DraftTurn: Sendable, Hashable {
    public enum Kind: Sendable, Hashable {
        case draft
        case counterpick
    }

    public var kind: Kind
    public var round: Int
    /// One-based position within the round.
    public var pickNumber: Int
    /// The absolute one-based slot: what `expected_pick` carries.
    public var overallPick: Int
    public var participant: LeagueMember

    public init(kind: Kind, round: Int, pickNumber: Int, overallPick: Int, participant: LeagueMember) {
        self.kind = kind
        self.round = round
        self.pickNumber = pickNumber
        self.overallPick = overallPick
        self.participant = participant
    }

    public func isMine(_ userID: UserID?) -> Bool {
        participant.userID == userID
    }

    /// "2.9": round and position, as the board labels picks.
    public var label: String { "\(round).\(pickNumber)" }
}

/// One round of the board.
public struct DraftBoardRound: Sendable, Hashable, Identifiable {
    public var round: Int
    public var slots: [DraftBoardSlot]
    public var id: Int { round }

    public init(round: Int, slots: [DraftBoardSlot]) {
        self.round = round
        self.slots = slots
    }

    /// "Picks 7–12".
    public var pickRange: ClosedRange<Int>? {
        guard let first = slots.first?.overallPick, let last = slots.last?.overallPick else { return nil }
        return first...last
    }
}

/// One slot of the board: the pick made there, or who it belongs to.
public struct DraftBoardSlot: Sendable, Hashable, Identifiable {
    public var round: Int
    public var pickNumber: Int
    public var overallPick: Int
    public var pick: DraftPickRecord?
    /// Whose slot this is in the snake order (nil if the order is incomplete).
    public var turn: DraftTurn?
    public var id: Int { overallPick }

    public init(round: Int, pickNumber: Int, overallPick: Int, pick: DraftPickRecord?, turn: DraftTurn?) {
        self.round = round
        self.pickNumber = pickNumber
        self.overallPick = overallPick
        self.pick = pick
        self.turn = turn
    }

    public var label: String { "\(round).\(pickNumber)" }
}

/// Commissioner controls the current phase allows.
public struct DraftOwnerActions: OptionSet, Sendable, Hashable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    /// Setup: start the snake draft.
    public static let startDraft = DraftOwnerActions(rawValue: 1 << 0)
    /// Setup: randomize or reorder the draft order.
    public static let editOrder = DraftOwnerActions(rawValue: 1 << 1)
    /// Board full, counterpick slots configured: open the counterpick round.
    public static let startCounterpicks = DraftOwnerActions(rawValue: 1 << 2)
    /// Board full: go straight to the season without counterpicks.
    public static let skipCounterpicks = DraftOwnerActions(rawValue: 1 << 3)
    /// Counterpicking: end the remaining counterpicks, keeping saved ones.
    public static let endCounterpicks = DraftOwnerActions(rawValue: 1 << 4)
}
