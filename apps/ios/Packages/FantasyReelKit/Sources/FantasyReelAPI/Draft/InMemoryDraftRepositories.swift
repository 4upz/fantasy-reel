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

/// A fixed catalog: every request answers with the same pages.
public actor InMemoryDraftMovieCatalog: DraftMovieCatalog {
    public var movies: [CatalogMovie]
    public var wishlisted: [WishlistedMovie]
    public var pageSize: Int
    public var failure: APIError?

    public init(movies: [CatalogMovie] = [], wishlisted: [WishlistedMovie] = [], pageSize: Int = 20, failure: APIError? = nil) {
        self.movies = movies
        self.wishlisted = wishlisted
        self.pageSize = max(pageSize, 1)
        self.failure = failure
    }

    public func page(_ request: CatalogRequest, page: Int, seasonYear: Int) async throws(APIError) -> CatalogPage {
        if let failure { throw failure }
        var matching = movies
        switch request {
        case .search(let query):
            matching = movies.filter { $0.title.localizedCaseInsensitiveContains(query) }
        case .browse(_, let genres) where !genres.isEmpty:
            let ids = Set(genres.map(\.rawValue))
            matching = movies.filter { !ids.isDisjoint(with: $0.genreIDs) }
        case .browse, .trending:
            break
        }
        let totalPages = max(1, (matching.count + pageSize - 1) / pageSize)
        let start = (page - 1) * pageSize
        let slice = start < matching.count ? Array(matching[start..<min(start + pageSize, matching.count)]) : []
        return CatalogPage(page: page, totalPages: totalPages, results: slice)
    }

    public func wishlist(for userID: UserID) async throws(APIError) -> [WishlistedMovie] {
        if let failure { throw failure }
        return wishlisted
    }
}
