import Foundation

// Request bodies for the draft Edge Functions and the retry contract around
// them (requirements F-08, F-09, N-04).

/// What a draft-room submission picks: a TMDb movie in the draft, or an
/// opponent's movie (our `movies.id`) in the counterpick round.
public enum DraftSelection: Sendable, Hashable {
    case movie(TMDbID)
    case counterpick(MovieID)

    public var kind: DraftTurn.Kind {
        switch self {
        case .movie: .draft
        case .counterpick: .counterpick
        }
    }
}

/// One logical attempt to fill one slot. The request id is what makes a retry
/// safe: the server stores a receipt per id, so resending the same attempt
/// after a lost response returns the saved pick instead of making a second one.
///
/// Keep the attempt while its result is uncertain, and reuse it only for the
/// same selection at the same slot. A new id for a retry could land on a later
/// turn; a reused id for a different movie is refused (409).
public struct DraftAttempt: Sendable, Hashable {
    public var leagueID: LeagueID
    public var selection: DraftSelection
    /// The absolute one-based slot the attempt is for.
    public var expectedPick: Int
    public var requestID: UUID
    /// The title to name in the "couldn't confirm" state.
    public var title: String

    public init(leagueID: LeagueID, selection: DraftSelection, expectedPick: Int, requestID: UUID = UUID(), title: String) {
        self.leagueID = leagueID
        self.selection = selection
        self.expectedPick = expectedPick
        self.requestID = requestID
        self.title = title
    }

    /// The attempt to send for `selection` at `expectedPick`: this one again
    /// when it's the same selection at the same slot, otherwise a fresh one.
    public func reused(for selection: DraftSelection, at expectedPick: Int, title: String) -> DraftAttempt {
        guard selection == self.selection, expectedPick == self.expectedPick else {
            return DraftAttempt(leagueID: leagueID, selection: selection, expectedPick: expectedPick, title: title)
        }
        return self
    }

    /// What a fresh read says about an attempt whose response was lost.
    public enum Resolution: Sendable, Hashable {
        /// The slot holds this team's pick of this movie: it saved.
        case saved
        /// The slot moved on without it (someone else's pick, a different
        /// movie, or the phase ended). Drop the attempt.
        case superseded
        /// The slot is still open: retrying with the same id is safe.
        case stillOpen
    }

    public func resolve(in snapshot: DraftSnapshot, teamID: TeamID?) -> Resolution {
        switch selection {
        case .movie(let tmdbID):
            let count = snapshot.teamCount
            if let pick = snapshot.picks.first(where: { $0.overallPick(teamCount: count) == expectedPick }) {
                return pick.teamID == teamID && pick.movie?.tmdbID == tmdbID ? .saved : .superseded
            }
            guard snapshot.league.status == .drafting, snapshot.draftPicksMade < expectedPick else { return .superseded }
            return .stillOpen
        case .counterpick(let movieID):
            if let counterpick = snapshot.draftCounterpicks.first(where: { $0.pickOrder == expectedPick }) {
                return counterpick.counterpickerTeamID == teamID && counterpick.movieID == movieID ? .saved : .superseded
            }
            guard snapshot.league.status == .counterpicking, snapshot.counterpicksMade < expectedPick else { return .superseded }
            return .stillOpen
        }
    }
}

/// `draft-pick`: `{ league_id, tmdb_id, expected_pick, request_id }`.
/// `make-counterpick`: `{ league_id, movie_id, expected_pick, request_id }`.
public struct DraftSubmissionRequest: Encodable, Sendable, Hashable {
    public var attempt: DraftAttempt

    public init(_ attempt: DraftAttempt) {
        self.attempt = attempt
    }

    /// The Edge Function that takes this submission.
    public var function: String {
        switch attempt.selection {
        case .movie: "draft-pick"
        case .counterpick: "make-counterpick"
        }
    }

    private enum CodingKeys: String, CodingKey {
        case leagueID = "league_id"
        case tmdbID = "tmdb_id"
        case movieID = "movie_id"
        case expectedPick = "expected_pick"
        case requestID = "request_id"
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(attempt.leagueID, forKey: .leagueID)
        switch attempt.selection {
        case .movie(let tmdbID): try c.encode(tmdbID, forKey: .tmdbID)
        case .counterpick(let movieID): try c.encode(movieID, forKey: .movieID)
        }
        try c.encode(attempt.expectedPick, forKey: .expectedPick)
        // Lowercase, like the web's `crypto.randomUUID()`.
        try c.encode(attempt.requestID.uuidString.lowercased(), forKey: .requestID)
    }
}

/// The parts of a `draft-pick` / `make-counterpick` answer the app uses. The
/// room re-reads its state after every submission, so only these flags matter.
public struct DraftSubmissionResult: Decodable, Sendable, Hashable {
    /// The server found this request id's receipt and returned the saved pick.
    public var replayed: Bool
    public var draftComplete: Bool

    public init(replayed: Bool = false, draftComplete: Bool = false) {
        self.replayed = replayed
        self.draftComplete = draftComplete
    }

    private enum CodingKeys: String, CodingKey {
        case replayed
        case draftComplete = "draft_complete"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        replayed = (try? c.decodeIfPresent(Bool.self, forKey: .replayed)) ?? false
        draftComplete = (try? c.decodeIfPresent(Bool.self, forKey: .draftComplete)) ?? false
    }
}

// MARK: - Announcements

extension DraftSnapshot {
    /// A sentence for VoiceOver when a refresh shows the room moved on: a pick
    /// saved, the turn changed, or the phase changed (the web's
    /// `describeDraftChange`). Nil when nothing a listener needs changed.
    public func changeAnnouncement(since previous: DraftSnapshot, userID: UserID?) -> String? {
        if previous.league.status != league.status {
            switch league.status {
            case .drafting: return "The draft has started."
            case .counterpicking: return "The counterpick round has started."
            case .active: return "The draft is complete. The season has started."
            default: return nil
            }
        }
        // The user's own picks are announced where they're made ("You drafted …").
        let ownTeam = participant(for: userID)?.team?.id
        var parts: [String] = []
        if let pick = newestPick, pick.id != previous.newestPick?.id, pick.teamID != ownTeam {
            parts.append("\(teamName(pick.teamID)) drafted \(pick.movie?.title ?? "a movie").")
        }
        if let counterpick = newestCounterpick, counterpick.id != previous.newestCounterpick?.id,
           counterpick.counterpickerTeamID != ownTeam {
            parts.append("\(teamName(counterpick.counterpickerTeamID)) counterpicked \(counterpick.movie?.title ?? "a movie").")
        }
        if let turn = currentTurn,
           turn.kind != previous.currentTurn?.kind || turn.overallPick != previous.currentTurn?.overallPick {
            parts.append(turn.isMine(userID) ? "It's your turn." : "\(turn.participant.teamName) is on the clock.")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }

    private var newestPick: DraftPickRecord? {
        let count = boardTeamCount
        return picks.max { $0.overallPick(teamCount: count) < $1.overallPick(teamCount: count) }
    }

    private var newestCounterpick: DraftCounterpick? {
        draftCounterpicks.max { $0.pickOrder < $1.pickOrder }
    }
}
