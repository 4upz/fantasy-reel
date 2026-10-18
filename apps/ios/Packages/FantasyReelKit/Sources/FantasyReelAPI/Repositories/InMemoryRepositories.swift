import FantasyReelCore
import Foundation

// Fakes for SwiftUI previews and tests. They hold their data in memory and
// never touch the network. `failure` makes every call throw, to exercise
// error states.

public actor InMemoryLeagueRepository: LeagueRepository {
    public var seasons: [League]
    /// Every member of every season; `fetchMembers` filters by season and status.
    public var members: [LeagueMember]
    public var failure: APIError?

    public init(seasons: [League] = [], members: [LeagueMember] = [], failure: APIError? = nil) {
        self.seasons = seasons
        self.members = members
        self.failure = failure
    }

    public func setSeasons(_ seasons: [League]) { self.seasons = seasons }
    public func setMembers(_ members: [LeagueMember]) { self.members = members }

    public func fetchVisibleSeasons() async throws(APIError) -> [League] {
        if let failure { throw failure }
        return seasons.sorted { $0.createdAt > $1.createdAt }
    }

    public func fetchSeason(_ id: LeagueID) async throws(APIError) -> League? {
        if let failure { throw failure }
        return seasons.first { $0.id == id }
    }

    public func fetchMembers(of leagueID: LeagueID) async throws(APIError) -> [LeagueMember] {
        if let failure { throw failure }
        return members
            .filter { $0.participant.leagueID == leagueID && $0.participant.status == .active }
            .sortedByDraftOrder()
    }

    public func fetchSeriesSeasons(_ seriesID: SeriesID) async throws(APIError) -> [League] {
        if let failure { throw failure }
        return seasons
            .filter { $0.seriesID == seriesID }
            .sorted { $0.seasonYear > $1.seasonYear }
    }
}

public actor InMemoryProfileRepository: ProfileRepository {
    public var profiles: [Profile]

    public init(profiles: [Profile] = []) {
        self.profiles = profiles
    }

    public func fetchProfile(for userID: UserID) async throws(APIError) -> Profile? {
        profiles.first { $0.userID == userID }
    }
}

public actor InMemoryNotificationRepository: NotificationRepository {
    public var notifications: [AppNotification]

    public init(notifications: [AppNotification] = []) {
        self.notifications = notifications
    }

    public func fetchLatest(for userID: UserID) async throws(APIError) -> [AppNotification] {
        Array(
            notifications
                .filter { $0.userID == userID }
                .sorted { $0.createdAt > $1.createdAt }
                .prefix(SupabaseNotificationRepository.pageSize)
        )
    }

    public func markRead(_ ids: [NotificationID], at date: Date) async throws(APIError) {
        for index in notifications.indices where ids.contains(notifications[index].id) {
            notifications[index].readAt = date
        }
    }
}

/// Records every lifecycle call and answers with canned results, so previews
/// and tests can drive create/join/settings flows without a server.
public actor InMemoryLeagueLifecycleRepository: LeagueLifecycleRepository {
    public enum Call: Sendable, Hashable {
        case create(CreateLeagueRequest)
        case join(JoinLeagueRequest)
        case update(LeagueID, LeagueUpdate)
        case startNextSeason(LeagueID)
    }

    public private(set) var calls: [Call] = []
    public var failure: APIError?
    public var membershipResult: LeagueMembershipResult
    public var updateResult: LeagueUpdateResult
    public var nextSeason: NextSeason

    public init(
        membershipResult: LeagueMembershipResult = LeagueMembershipResult(leagueID: "preview-league", leagueName: "Preview League"),
        updateResult: LeagueUpdateResult = LeagueUpdateResult(message: "League updated successfully"),
        nextSeason: NextSeason = NextSeason(leagueID: "preview-next-season", seasonYear: 2027),
        failure: APIError? = nil
    ) {
        self.membershipResult = membershipResult
        self.updateResult = updateResult
        self.nextSeason = nextSeason
        self.failure = failure
    }

    public func setFailure(_ failure: APIError?) { self.failure = failure }

    public func createLeague(_ request: CreateLeagueRequest) async throws(APIError) -> LeagueMembershipResult {
        calls.append(.create(request))
        if let failure { throw failure }
        return membershipResult
    }

    public func joinLeague(_ request: JoinLeagueRequest) async throws(APIError) -> LeagueMembershipResult {
        calls.append(.join(request))
        if let failure { throw failure }
        return membershipResult
    }

    public func update(_ leagueID: LeagueID, _ update: LeagueUpdate) async throws(APIError) -> LeagueUpdateResult {
        calls.append(.update(leagueID, update))
        if let failure { throw failure }
        return updateResult
    }

    public func startNextSeason(after leagueID: LeagueID) async throws(APIError) -> NextSeason {
        calls.append(.startNextSeason(leagueID))
        if let failure { throw failure }
        return nextSeason
    }
}

public actor InMemoryInvitationRepository: InvitationRepository {
    public var pending: [PendingInvitation]
    public var invitations: [LeagueInvitation]
    public var searchResults: [UserSearchResult]
    public var joinCodes: [LeagueID: String]
    public var failure: APIError?

    public init(
        pending: [PendingInvitation] = [],
        invitations: [LeagueInvitation] = [],
        searchResults: [UserSearchResult] = [],
        joinCodes: [LeagueID: String] = [:],
        failure: APIError? = nil
    ) {
        self.pending = pending
        self.invitations = invitations
        self.searchResults = searchResults
        self.joinCodes = joinCodes
        self.failure = failure
    }

    public func fetchPending(for email: String) async throws(APIError) -> [PendingInvitation] {
        if let failure { throw failure }
        return pending
    }

    public func decline(_ id: InvitationID) async throws(APIError) {
        if let failure { throw failure }
        pending.removeAll { $0.id == id }
    }

    public func fetchInvitations(of leagueID: LeagueID) async throws(APIError) -> [LeagueInvitation] {
        if let failure { throw failure }
        return invitations.filter { $0.leagueID == leagueID }
    }

    public func searchUsers(_ query: String, in leagueID: LeagueID) async throws(APIError) -> [UserSearchResult] {
        if let failure { throw failure }
        return searchResults.filter { $0.displayName.localizedCaseInsensitiveContains(query) }
    }

    public func invite(_ recipient: InviteRecipient, to leagueID: LeagueID) async throws(APIError) -> InviteResult {
        if let failure { throw failure }
        let name: String
        switch recipient {
        case .email(let email): name = email
        case .user: name = "this user"
        }
        return InviteResult(message: "Invitation sent to \(name)")
    }

    public func resend(_ id: InvitationID) async throws(APIError) -> InviteResult {
        if let failure { throw failure }
        return InviteResult(message: "Invitation resent")
    }

    public func cancel(_ id: InvitationID) async throws(APIError) {
        if let failure { throw failure }
        if let index = invitations.firstIndex(where: { $0.id == id }) {
            invitations[index].status = .cancelled
        }
    }

    public func fetchJoinCode(of leagueID: LeagueID) async throws(APIError) -> String? {
        if let failure { throw failure }
        return joinCodes[leagueID]
    }

    public func generateJoinCode(for leagueID: LeagueID) async throws(APIError) -> String {
        if let failure { throw failure }
        let code = String((0..<8).map { _ in JoinCode.alphabet.randomElement()! })
        joinCodes[leagueID] = code
        return code
    }
}

public actor InMemoryAdminRepository: AdminRepository {
    /// Nil means "not an administrator".
    public var stats: GrowthStats?
    public var failure: APIError?

    public init(stats: GrowthStats? = nil, failure: APIError? = nil) {
        self.stats = stats
        self.failure = failure
    }

    public func fetchGrowthStats() async throws(APIError) -> GrowthStats? {
        if let failure { throw failure }
        return stats
    }
}

public actor InMemoryAnnouncementRepository: AnnouncementRepository {
    public var channels: Int
    public var failure: APIError?
    public private(set) var posted: [String] = []

    public init(channels: Int = 1, failure: APIError? = nil) {
        self.channels = channels
        self.failure = failure
    }

    public func setFailure(_ failure: APIError?) { self.failure = failure }

    public func postAnnouncement(_ message: String, to leagueID: LeagueID) async throws(APIError) -> Int {
        if let failure { throw failure }
        posted.append(message)
        return channels
    }
}
