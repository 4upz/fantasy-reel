#if DEBUG
import FantasyReelAPI
import FantasyReelCore
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

    init(scene: ScreenshotScene, environment: AppEnvironment) {
        self.scene = scene
        let user = ScreenshotFixtures.account.id
        let defaults = UserDefaults(suiteName: "fr.screenshots") ?? .standard
        _directory = State(initialValue: LeagueDirectoryStore(userID: user, repository: environment.leagues, defaults: defaults))
        _inbox = State(initialValue: InboxStore(userID: user, repository: environment.notifications))
        _profiles = State(initialValue: ProfileStore(userID: user, repository: environment.profiles))
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
                    case .wishlist, .howToPlay: EmptyView()
                    }
                }
        }
        .environment(router)
        .environment(directory)
        .environment(inbox)
        .environment(profiles)
        .environment(\.currentProfile, profiles.profile)
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
        environment.session.showPreviewAccount(account)
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
