#if DEBUG
import FantasyReelAPI
import FantasyReelCore
import Foundation
import SwiftUI

/// Fixed screens for PR screenshots, captured in CI by
/// `.github/workflows/ios.yml`. Launching a Debug build with the
/// `FR_SCREENSHOT` environment variable set to a scene name shows that screen
/// with preview data instead of the app; nothing touches the network.
enum ScreenshotScene: String, CaseIterable {
    case welcome
    case logIn
    case logInLinkNotice
    case signUp
    case resetPassword
    case resetPasswordLinkNotice
    case chooseNewPassword
    case appleRelayNotice
    case howToPlay
    case account
    case accountOnlyApple
    case editDisplayName
    case changePassword
    case changePasswordNoPassword
    case deleteAccount
    case deleteAccountReauth
    case deleteAccountDraft
    case notifications
    case notificationsEmpty
    case discordBot
    case movieSearch
    case movieSearchIdle
    case movieDetail
    case wishlist
    case sharedWishlists
    case leagueHome
    case roster
    case standings
    case teamDetail
    case bids
    case placeBid
    case bidPriorities
    case trades
    case tradeComposer
    case dropMovie
    case noLeaguesWithInvitation
    case createLeague
    case joinLeague
    case menuSeasons
    case leagueSettings
    case leagueHistory
    case seasonComplete
    case shareInvite
    case growthDashboard

    static var requested: ScreenshotScene? {
        ProcessInfo.processInfo.environment["FR_SCREENSHOT"].flatMap(ScreenshotScene.init(rawValue:))
    }

    /// Scenes inside the signed-in menu sheet; the rest are signed out.
    var menuRoute: MenuRoute? {
        switch self {
        case .account, .accountOnlyApple: .account
        case .editDisplayName: .editDisplayName
        case .changePassword, .changePasswordNoPassword: .changePassword
        case .deleteAccount, .deleteAccountReauth, .deleteAccountDraft: .deleteAccount
        case .notifications, .notificationsEmpty: .notifications
        case .discordBot: .discordBot
        default: nil
        }
    }
}

struct ScreenshotSceneView: View {
    let scene: ScreenshotScene

    var body: some View {
        if Self.movieResearchScenes.contains(scene) {
            MovieResearchScreenshotView(scene: scene)
        } else if Self.teamMarketScenes.contains(scene) {
            TeamMarketScreenshotView(scene: scene)
        } else if Self.leagueLifecycleScenes.contains(scene) {
            SignedInScreenshotView(scene: scene)
        } else {
            AuthScreenshotView(scene: scene)
        }
    }

    private static let movieResearchScenes: Set<ScreenshotScene> = [
        .movieSearch, .movieSearchIdle, .movieDetail, .wishlist, .sharedWishlists,
    ]

    private static let teamMarketScenes: Set<ScreenshotScene> = [
        .leagueHome, .roster, .standings, .teamDetail, .bids, .placeBid, .bidPriorities, .trades, .tradeComposer, .dropMovie,
    ]

    private static let leagueLifecycleScenes: Set<ScreenshotScene> = [
        .noLeaguesWithInvitation, .createLeague, .joinLeague, .menuSeasons, .leagueSettings,
        .leagueHistory, .seasonComplete, .shareInvite, .growthDashboard,
    ]
}

/// The sign-in flow scenes, and the Account scenes in the menu sheet.
private struct AuthScreenshotView: View {
    let scene: ScreenshotScene

    @State private var environment: AppEnvironment
    @State private var navigation = AuthNavigation()

    init(scene: ScreenshotScene) {
        self.scene = scene
        _environment = State(initialValue: ScreenshotFixtures.environment(for: scene))
    }

    var body: some View {
        content
            .environment(environment)
            .environment(environment.session)
            .environment(navigation)
            .onAppear(perform: prepare)
    }

    @ViewBuilder
    private var content: some View {
        if scene.menuRoute != nil {
            ScreenshotMenuView(scene: scene, environment: environment)
        } else {
            switch scene {
            case .chooseNewPassword:
                ChooseNewPasswordView()
            case .appleRelayNotice:
                AppleRelayNoticeView()
            default:
                NavigationStack(path: $navigation.path) {
                    WelcomeView()
                        .navigationDestination(for: AuthRoute.self) { route in
                            switch route {
                            case .logIn: LogInView()
                            case .signUp: SignUpView()
                            case .resetPassword(let email): ResetPasswordView(initialEmail: email)
                            case .howToPlay: HowToPlayView(isPublic: true)
                            }
                        }
                }
            }
        }
    }

    private func prepare() {
        let session = environment.session
        switch scene {
        case .welcome, .chooseNewPassword, .appleRelayNotice:
            break
        case .logIn:
            navigation.path = [.logIn]
        case .logInLinkNotice:
            session.authLinkNotice = AuthLinkNotice(
                title: AuthLinkFailure.expired.title,
                message: AuthLinkFailure.expired.message(isRecovery: false),
                isRecovery: false
            )
            navigation.path = [.logIn]
        case .signUp:
            navigation.path = [.signUp]
        case .resetPassword:
            navigation.path = [.logIn, .resetPassword(email: "alice@fantasyreel.test")]
        case .resetPasswordLinkNotice:
            session.authLinkNotice = AuthLinkNotice(
                title: AuthLinkFailure.openedElsewhere.title,
                message: AuthLinkFailure.openedElsewhere.message(isRecovery: true),
                isRecovery: true
            )
            navigation.path = [.logIn, .resetPassword()]
        case .howToPlay:
            navigation.path = [.howToPlay]
        default:
            // Other signed-in scenes have their own views (see `ScreenshotSceneView`).
            break
        }
    }
}

/// A signed-in menu sheet stack opened on the scene's screen, with the stores
/// the signed-in tree provides.
private struct ScreenshotMenuView: View {
    let scene: ScreenshotScene

    @State private var router = ShellRouter()
    @State private var directory: LeagueDirectoryStore
    @State private var inbox: InboxStore
    @State private var profiles: ProfileStore
    @State private var admin: AdminStore

    init(scene: ScreenshotScene, environment: AppEnvironment) {
        self.scene = scene
        let user = ScreenshotFixtures.account.id
        let defaults = UserDefaults(suiteName: "fr.screenshots") ?? .standard
        _directory = State(initialValue: LeagueDirectoryStore(userID: user, repository: environment.leagues, defaults: defaults))
        _inbox = State(initialValue: InboxStore(userID: user, repository: environment.notifications))
        _profiles = State(initialValue: ProfileStore(userID: user, repository: environment.profiles))
        _admin = State(initialValue: AdminStore(repository: environment.admin))
    }

    var body: some View {
        @Bindable var router = router
        NavigationStack(path: $router.menuPath) {
            Color.frBackground
                .navigationDestination(for: MenuRoute.self) { route in
                    switch route {
                    case .notifications: NotificationsView()
                    case .account: AccountView()
                    case .editDisplayName: EditDisplayNameView()
                    case .changePassword: ChangePasswordView()
                    case .deleteAccount:
                        switch scene {
                        case .deleteAccountReauth: DeleteAccountView(blocker: .reauth)
                        case .deleteAccountDraft: DeleteAccountView(blocker: .liveDraft(leagues: ["Office Movie Club"]))
                        default: DeleteAccountView()
                        }
                    case .discordBot: DiscordBotGuideScreen()
                    case .wishlist, .howToPlay, .growthDashboard, .sharedWishlist, .league: EmptyView()
                    }
                }
        }
        .environment(router)
        .environment(directory)
        .environment(inbox)
        .environment(profiles)
        .environment(\.currentProfile, profiles.profile)
        .environment(admin)
        .task {
            async let profileLoaded: Void = profiles.refresh()
            async let inboxLoaded: Void = inbox.refresh()
            await directory.load()
            _ = await (profileLoaded, inboxLoaded)
            if let route = scene.menuRoute { router.menuPath = [route] }
        }
    }
}

/// Seeded preview data for the signed-in scenes.
private enum ScreenshotFixtures {
    static let account = AuthService.Account(id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", email: "alice@fantasyreel.test")
    static let league: LeagueID = "b1b2c3d4-e5f6-7890-abcd-ef1234567890"
    static let now = Date()

    @MainActor
    static func environment(for scene: ScreenshotScene) -> AppEnvironment {
        let environment = AppEnvironment.preview(
            leagues: InMemoryLeagueRepository(seasons: [season]),
            profiles: InMemoryProfileRepository(profiles: [
                Profile(id: "p1", userID: account.id, displayName: "Alice Spielberg", discordUsername: "alice"),
            ]),
            notifications: InMemoryNotificationRepository(notifications: scene == .notificationsEmpty ? [] : notifications),
            account: InMemoryAccountRepository()
        )
        guard scene.menuRoute != nil else { return environment }
        environment.session.previewSignIn(account)
        environment.session.previewSignInMethods = signInMethods(for: scene)
        return environment
    }

    static func signInMethods(for scene: ScreenshotScene) -> SignInMethods {
        switch scene {
        case .accountOnlyApple, .changePasswordNoPassword:
            SignInMethods(email: account.email, hasPassword: false, identities: [
                LinkedIdentity(id: "i1", provider: "apple", detail: "alice@privaterelay.appleid.com"),
            ])
        default:
            SignInMethods(email: account.email, hasPassword: true, identities: [
                LinkedIdentity(id: "i0", provider: "email", detail: account.email),
                LinkedIdentity(id: "i2", provider: "discord", detail: "alice"),
            ])
        }
    }

    static var season: League {
        League(
            id: league,
            name: "Office Movie Club",
            ownerID: account.id,
            status: .active,
            seriesID: "c1b2c3d4-e5f6-7890-abcd-ef1234567890",
            seasonYear: 2026,
            seasonEnd: DateOnly(year: 2026, month: 12, day: 31)!,
            createdAt: now,
            updatedAt: now
        )
    }

    static var notifications: [AppNotification] {
        func item(_ n: Int, _ type: NotificationType, _ title: String, _ body: String, minutesAgo: Double, read: Bool) -> AppNotification {
            AppNotification(
                id: NotificationID("d\(n)b2c3d4-e5f6-7890-abcd-ef1234567890"),
                userID: account.id,
                leagueID: league,
                type: type,
                title: title,
                body: body,
                readAt: read ? now : nil,
                createdAt: now.addingTimeInterval(-minutesAgo * 60)
            )
        }
        return [
            item(1, .outbid, "You've been outbid on Mickey 17", "Bob Nolan bid $14. Raise your bid before bidding closes.", minutesAgo: 12, read: false),
            item(2, .bidWon, "You won Sinners", "It's on your roster for $9.", minutesAgo: 180, read: false),
            item(3, .tradeProposed, "New trade offer from Carol Coppola", "Carol offered The Bride! for Wicked: For Good.", minutesAgo: 60 * 26, read: false),
            item(4, .bidLost, "You lost the bid on Hamnet", "Dave Kubrick won it with $21.", minutesAgo: 60 * 50, read: true),
            item(5, .leagueOwnershipTransferred, "You now run Office Movie Club", "The previous owner deleted their account, so the league passed to you.", minutesAgo: 60 * 24 * 5, read: true),
            item(6, .seasonStarted, "The 2026 season has started", "Draft order is set. Good luck!", minutesAgo: 60 * 24 * 12, read: true),
        ]
    }
}
#endif

// MARK: - Signed in

/// The signed-in scenes: the stores and environment `SignedInRootView` builds,
/// over in-memory repositories seeded from `ScreenshotData`, with the real
/// shell (tab bar, top bar, menu sheet) around each screen.
@MainActor
private struct SignedInScreenshotView: View {
    let scene: ScreenshotScene

    @State private var environment: AppEnvironment
    @State private var directory: LeagueDirectoryStore
    @State private var inbox: InboxStore
    @State private var admin: AdminStore
    @State private var wishlist: WishlistStore
    @State private var research: LeagueResearchStore
    @State private var searchHistory = MovieSearchHistory()
    @State private var router = ShellRouter()
    private let profile: Profile?

    init(scene: ScreenshotScene) {
        self.scene = scene
        let viewer = ScreenshotData.viewer(for: scene)
        let environment = AppEnvironment.preview(
            leagues: InMemoryLeagueRepository(
                seasons: ScreenshotData.seasons(for: scene),
                members: ScreenshotData.members(of: ScreenshotData.currentSeasonID)
            ),
            invitations: InMemoryInvitationRepository(
                pending: ScreenshotData.pendingInvitations(for: scene),
                invitations: ScreenshotData.sentInvitations(),
                joinCodes: [ScreenshotData.currentSeasonID: ScreenshotData.joinCode]
            ),
            admin: InMemoryAdminRepository(stats: scene == .growthDashboard ? GrowthPreviewData.stats : nil),
            profiles: InMemoryProfileRepository(profiles: ScreenshotData.profiles()),
            notifications: InMemoryNotificationRepository(notifications: ScreenshotData.notifications(for: viewer))
        )
        environment.session.previewSignIn(
            AuthService.Account(id: viewer, email: ScreenshotData.email(of: viewer))
        )
        _environment = State(initialValue: environment)
        _directory = State(initialValue: LeagueDirectoryStore(userID: viewer, repository: environment.leagues))
        _inbox = State(initialValue: InboxStore(userID: viewer, repository: environment.notifications))
        _admin = State(initialValue: AdminStore(repository: environment.admin))
        _wishlist = State(initialValue: WishlistStore(userID: viewer, repository: environment.wishlists))
        _research = State(initialValue: LeagueResearchStore(leagues: environment.leagues, leagueMovies: environment.leagueMovies))
        profile = ScreenshotData.profile(of: viewer)
    }

    var body: some View {
        @Bindable var router = router
        signedInEnvironment(content)
            .sheet(item: $router.sheet) { sheet in
                signedInEnvironment(ShellSheetView(sheet: sheet))
            }
            .task { await prepare() }
    }

    /// What `SignedInRootView` shows for the directory's state.
    @ViewBuilder
    private var content: some View {
        switch directory.state {
        case .loaded:
            if let selection = directory.selection {
                LeagueShellView(selection: selection)
                    .id(selection.season.id)
            } else {
                NoLeagueShellView()
            }
        case .empty:
            NoLeagueShellView()
        case .idle, .loading, .failed:
            LaunchView()
        }
    }

    /// The environment `SignedInRootView` gives the shell and its sheet.
    private func signedInEnvironment(_ view: some View) -> some View {
        view
            .environment(environment)
            .environment(environment.session)
            .environment(router)
            .environment(directory)
            .environment(inbox)
            .environment(admin)
            .environment(wishlist)
            .environment(research)
            .environment(searchHistory)
            .environment(\.currentProfile, profile)
    }

    /// Loads the directory, selects the scene's season, then opens the screen
    /// the way the app would: a push onto the tab's stack, or the one sheet.
    private func prepare() async {
        await inbox.refresh()
        await directory.load()
        if directory.select(ScreenshotData.currentSeasonID) {
            router.showSeason(directory.selectedSeasonID, defaultTab: directory.selection?.defaultTab ?? .home)
        }
        switch scene {
        case .createLeague:
            router.present(.createLeague)
        case .joinLeague:
            router.present(.joinLeague(.code(ScreenshotData.joinCode)))
        case .menuSeasons:
            router.presentMenu()
        case .growthDashboard:
            router.presentMenu(.growthDashboard)
        case .leagueSettings:
            router.push(.settings)
        case .leagueHistory:
            router.push(.history)
        case .shareInvite:
            router.push(.shareInvite)
        case .noLeaguesWithInvitation, .seasonComplete:
            break
        default:
            break
        }
    }
}

/// Seed data for the signed-in scenes: the seeded test accounts (Alice
/// Spielberg, Bob Nolan, Carol Coppola, Dave Kubrick) in League of Culture,
/// seasons 2024 to 2026. Alice is the commissioner.
private enum ScreenshotData {
    static let alice: UserID = "user-alice"
    static let bob: UserID = "user-bob"
    static let carol: UserID = "user-carol"
    static let dave: UserID = "user-dave"

    /// League of Culture's 2026 season: the season every league scene opens on.
    static let currentSeasonID: LeagueID = "season-culture-2026"
    static let joinCode = "K7MPQ2XW"

    private static let players: [UserID] = [alice, bob, carol, dave]
    private static let names: [UserID: String] = [
        alice: "Alice Spielberg",
        bob: "Bob Nolan",
        carol: "Carol Coppola",
        dave: "Dave Kubrick",
    ]
    private static let teams: [UserID: String] = [
        alice: "Reel Deal",
        bob: "Nolan's Notebook",
        carol: "Coppola Cut",
        dave: "Kubrick's Cube",
    ]

    /// Who is signed in: Dave, new to the app, for the no-league, create and
    /// join scenes; Alice, the commissioner, everywhere else.
    static func viewer(for scene: ScreenshotScene) -> UserID {
        switch scene {
        case .noLeaguesWithInvitation, .createLeague, .joinLeague: dave
        default: alice
        }
    }

    static func email(of user: UserID) -> String {
        let first = names[user]?.split(separator: " ").first.map { String($0) } ?? "player"
        return "\(first.lowercased())@fantasyreel.test"
    }

    static func profile(of user: UserID) -> Profile? {
        guard let name = names[user] else { return nil }
        return Profile(id: "profile-\(user.rawValue)", userID: user, displayName: name)
    }

    static func profiles() -> [Profile] {
        players.compactMap(profile(of:))
    }

    // MARK: Seasons

    static func seasons(for scene: ScreenshotScene) -> [League] {
        let history = [completed2025(), completed2024()]
        switch scene {
        case .menuSeasons, .leagueHistory, .growthDashboard:
            return [culture(2026, status: .active)] + history + [popcornSyndicate()]
        case .leagueSettings, .shareInvite:
            return [culture(2026, status: .setup)] + history + [popcornSyndicate()]
        case .seasonComplete:
            // Ended early (season end moved to 15 Oct), so Start Next Season shows.
            let end = DateOnly(year: 2026, month: 10, day: 15)!
            let standings = [
                row(alice, year: 2026, points: 163, rank: 1),
                row(carol, year: 2026, points: 141, rank: 2),
                row(bob, year: 2026, points: 119, rank: 3),
                row(dave, year: 2026, points: 74, rank: 4),
            ]
            let season = culture(2026, status: .completed, seasonEnd: end, completedAt: day(2026, 10, 15), standings: standings)
            return [season] + history
        default:
            return []
        }
    }

    private static func completed2025() -> League {
        culture(2025, status: .completed, completedAt: day(2026, 1, 1), standings: [
            row(carol, year: 2025, points: 156, rank: 1),
            row(alice, year: 2025, points: 149, rank: 2),
            row(dave, year: 2025, points: 112, rank: 3),
            row(bob, year: 2025, points: 88, rank: 4),
        ])
    }

    private static func completed2024() -> League {
        culture(2024, status: .completed, completedAt: day(2025, 1, 1), standings: [
            row(bob, year: 2024, points: 142, rank: 1),
            row(alice, year: 2024, points: 128, rank: 2),
            row(dave, year: 2024, points: 97, rank: 3),
            row(carol, year: 2024, points: 61, rank: 4),
        ])
    }

    /// A second league in the menu, mid-draft, run by Carol.
    private static func popcornSyndicate() -> League {
        League(
            id: "season-popcorn-2026",
            name: "Popcorn Syndicate",
            ownerID: carol,
            status: .drafting,
            seriesID: "series-popcorn",
            seasonYear: 2026,
            seasonEnd: DateOnly(year: 2026, month: 12, day: 31)!,
            createdAt: day(2026, 3, 2),
            updatedAt: day(2026, 3, 2)
        )
    }

    private static func culture(
        _ year: Int,
        status: LeagueStatus,
        seasonEnd: DateOnly? = nil,
        completedAt: Date? = nil,
        standings: [FinalStandingRow]? = nil
    ) -> League {
        League(
            id: LeagueID("season-culture-\(year)"),
            name: "League of Culture",
            ownerID: alice,
            status: status,
            seriesID: "series-culture",
            seasonYear: year,
            seasonEnd: seasonEnd ?? DateOnly(year: year, month: 12, day: 31)!,
            completedAt: completedAt,
            winnerTeamIDs: standings?.filter { $0.rank == 1 }.map(\.teamID),
            finalStandings: standings,
            createdAt: day(year, 1, 12),
            updatedAt: day(year, 1, 12)
        )
    }

    private static func row(_ user: UserID, year: Int, points: Double, rank: Int) -> FinalStandingRow {
        FinalStandingRow(
            teamID: TeamID("team-\(user.rawValue)-\(year)"),
            teamName: teams[user] ?? "",
            participantID: ParticipantID("participant-\(user.rawValue)-\(year)"),
            userID: user,
            totalPoints: points,
            rank: rank,
            isTied: false,
            displayName: names[user]
        )
    }

    /// The four players of `seasonID`, in draft order, Alice owning it.
    static func members(of seasonID: LeagueID) -> [LeagueMember] {
        players.enumerated().map { index, user in
            let participantID = ParticipantID("participant-\(user.rawValue)-\(seasonID.rawValue)")
            return LeagueMember(
                participant: LeagueParticipant(
                    id: participantID,
                    leagueID: seasonID,
                    userID: user,
                    role: user == alice ? .owner : .member,
                    draftOrder: index + 1,
                    joinedAt: day(2026, 1, 12 + index)
                ),
                team: Team(id: TeamID("team-\(user.rawValue)-\(seasonID.rawValue)"), participantID: participantID, name: teams[user] ?? ""),
                profile: profile(of: user)
            )
        }
    }

    // MARK: Invitations and notifications

    /// Dave's invitation to League of Culture, on the no-league screen.
    static func pendingInvitations(for scene: ScreenshotScene) -> [PendingInvitation] {
        guard scene == .noLeaguesWithInvitation else { return [] }
        let now = Date()
        return [
            PendingInvitation(
                id: "invitation-dave",
                token: "token-dave",
                sentAt: now.addingTimeInterval(-2 * 86_400),
                expiresAt: now.addingTimeInterval(7 * 86_400),
                leagueID: currentSeasonID,
                leagueName: "League of Culture"
            ),
        ]
    }

    /// Invitations Alice has sent for the 2026 season.
    static func sentInvitations() -> [LeagueInvitation] {
        let now = Date()
        return [
            LeagueInvitation(
                id: "invitation-erin", leagueID: currentSeasonID, email: "erin@fantasyreel.test", token: "token-erin",
                status: .pending, sentAt: now.addingTimeInterval(-86_400), expiresAt: now.addingTimeInterval(6 * 86_400)
            ),
            LeagueInvitation(
                id: "invitation-frank", leagueID: currentSeasonID, inviteeDisplayName: "Frank Capra", token: "token-frank",
                status: .pending, sentAt: now.addingTimeInterval(-3 * 86_400), expiresAt: now.addingTimeInterval(4 * 86_400)
            ),
            LeagueInvitation(
                id: "invitation-dave-accepted", leagueID: currentSeasonID, inviteeDisplayName: "Dave Kubrick", token: "token-dave",
                status: .accepted, sentAt: now.addingTimeInterval(-5 * 86_400), respondedAt: now.addingTimeInterval(-4 * 86_400)
            ),
        ]
    }

    /// Two unread notifications for Alice, so the bell shows a badge.
    static func notifications(for user: UserID) -> [AppNotification] {
        guard user == alice else { return [] }
        let now = Date()
        return [
            AppNotification(
                id: "notification-trade", userID: alice, leagueID: currentSeasonID, type: .tradeProposed,
                title: "New trade offer", body: "Bob Nolan offered a trade in League of Culture.",
                createdAt: now.addingTimeInterval(-3_600)
            ),
            AppNotification(
                id: "notification-outbid", userID: alice, leagueID: currentSeasonID, type: .outbid,
                title: "You've been outbid", body: "Carol Coppola raised the high bid to 18.",
                createdAt: now.addingTimeInterval(-7_200)
            ),
        ]
    }

    private static func day(_ year: Int, _ month: Int, _ day: Int) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar.date(from: DateComponents(year: year, month: month, day: day))!
    }
}
#endif
