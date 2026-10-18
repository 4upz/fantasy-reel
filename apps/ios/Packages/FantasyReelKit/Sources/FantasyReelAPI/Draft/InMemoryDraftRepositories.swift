import FantasyReelCore
import Foundation

/// A draft room without a server, for previews, screenshots and tests. It
/// records submissions and phase calls and answers with canned results; it
/// doesn't run the draft rules (the server owns those).
public actor InMemoryDraftRepository: DraftRepository {
    public enum Call: Sendable, Hashable {
        case submit(DraftAttempt)
        case startDraft(LeagueID)
        case startCounterpickRound(LeagueID)
        case skipCounterpickRound(LeagueID, endRemaining: Bool)
    }

    public private(set) var calls: [Call] = []
    public var picks: [DraftPickRecord]
    public var counterpicks: [DraftCounterpick]
    public var options: [CounterpickOption]
    public var failure: APIError?
    public var submitResult: DraftSubmissionResult

    public init(
        picks: [DraftPickRecord] = [],
        counterpicks: [DraftCounterpick] = [],
        options: [CounterpickOption] = [],
        submitResult: DraftSubmissionResult = DraftSubmissionResult(),
        failure: APIError? = nil
    ) {
        self.picks = picks
        self.counterpicks = counterpicks
        self.options = options
        self.submitResult = submitResult
        self.failure = failure
    }

    public func setFailure(_ failure: APIError?) { self.failure = failure }

    public func fetchPicks(_ leagueID: LeagueID) async throws(APIError) -> [DraftPickRecord] {
        if let failure { throw failure }
        return picks.filter { $0.leagueID == leagueID }
    }

    public func fetchCounterpicks(_ leagueID: LeagueID) async throws(APIError) -> [DraftCounterpick] {
        if let failure { throw failure }
        return counterpicks.filter { $0.leagueID == leagueID }
    }

    public func fetchCounterpickOptions(_ leagueID: LeagueID, teamID: TeamID) async throws(APIError) -> [CounterpickOption] {
        if let failure { throw failure }
        return options.filter { $0.ownerTeamID != teamID }
    }

    public func submit(_ attempt: DraftAttempt) async throws(APIError) -> DraftSubmissionResult {
        calls.append(.submit(attempt))
        if let failure { throw failure }
        return submitResult
    }

    public func startDraft(_ leagueID: LeagueID) async throws(APIError) {
        calls.append(.startDraft(leagueID))
        if let failure { throw failure }
    }

    public func startCounterpickRound(_ leagueID: LeagueID) async throws(APIError) {
        calls.append(.startCounterpickRound(leagueID))
        if let failure { throw failure }
    }

    public func skipCounterpickRound(_ leagueID: LeagueID, endRemaining: Bool) async throws(APIError) {
        calls.append(.skipCounterpickRound(leagueID, endRemaining: endRemaining))
        if let failure { throw failure }
    }
}
