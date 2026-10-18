import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation
import UIKit
import UserNotifications

/// What iOS says about notifications for this app. Provisional and ephemeral
/// grants count as allowed.
enum PushAuthorization: Sendable, Equatable {
    case notDetermined
    case denied
    case allowed
}

/// The system calls `PushCenter` makes, behind a protocol so previews and
/// screenshots can show each permission state without asking iOS.
@MainActor
protocol PushSystem: AnyObject {
    func authorization() async -> PushAuthorization
    /// Shows the iOS permission alert (only ever once per install).
    func requestAuthorization() async -> Bool
    func registerForRemoteNotifications()
    func setBadgeCount(_ count: Int) async
}

/// Push notifications in the app (O-01): permission, this phone's APNs token,
/// the app icon badge, and taps on a push.
///
/// - The token is registered to the signed-in account on every launch and
///   sign-in (it can change), and removed before sign-out so the next person
///   on this phone doesn't get the last one's pushes.
/// - Permission is asked in context (`PushPromptCard`, Settings), never at
///   launch, and the app works the same without it (App Review 4.5.4).
/// - A tap opens what the same notification opens from the inbox, through the
///   same link handling as any other incoming link (`RootView`).
@Observable
@MainActor
final class PushCenter {
    private(set) var authorization: PushAuthorization?
    /// Bumped for every push that arrives while the app is open, so the inbox
    /// can refresh without waiting to be reopened.
    private(set) var receivedWhileOpen = 0
    /// "Not now" on the prompt card. Kept on this device; Settings still offers
    /// the switch.
    private(set) var promptDismissed: Bool

    /// Set by `RootView`; a tap that arrives before it is held until then.
    @ObservationIgnored var openLink: ((DeepLink) -> Void)? {
        didSet {
            if let openLink, let link = pendingLink {
                pendingLink = nil
                openLink(link)
            }
        }
    }

    /// Also read by Settings for the account's switches.
    let repository: any PushRepository
    private let system: any PushSystem
    private let environment: PushEnvironment
    private let bundleID: String
    private let defaults: UserDefaults
    @ObservationIgnored private var token: String?
    @ObservationIgnored private var userID: UserID?
    /// The account the current token was last registered to.
    @ObservationIgnored private var registeredFor: (token: String, user: UserID)?
    @ObservationIgnored private var pendingLink: DeepLink?

    private static let promptKey = "fr.pushPromptDismissed"

    init(
        repository: any PushRepository,
        system: any PushSystem,
        environment: PushEnvironment,
        bundleID: String,
        defaults: UserDefaults = .standard
    ) {
        self.repository = repository
        self.system = system
        self.environment = environment
        self.bundleID = bundleID
        self.defaults = defaults
        self.promptDismissed = defaults.bool(forKey: Self.promptKey)
    }

    /// The contextual ask: shown until the person answers iOS or says not now.
    var showsPrompt: Bool {
        authorization == .notDetermined && !promptDismissed
    }

    // MARK: Permission

    func refreshAuthorization() async {
        authorization = await system.authorization()
    }

    /// Asks iOS, then registers this phone if the person said yes.
    func requestPermission() async {
        let granted = await system.requestAuthorization()
        await refreshAuthorization()
        if granted { system.registerForRemoteNotifications() }
    }

    func dismissPrompt() {
        promptDismissed = true
        defaults.set(true, forKey: Self.promptKey)
    }

    // MARK: Account and token

    /// Called whenever the signed-in account changes (nil when signed out).
    func accountDidChange(_ userID: UserID?) async {
        self.userID = userID
        await refreshAuthorization()
        guard userID != nil else { return }
        // iOS hands back the token through the app delegate; asking again
        // each time is how Apple says to keep it current.
        if authorization == .allowed { system.registerForRemoteNotifications() }
        await uploadToken()
    }

    /// From `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`.
    func didRegister(deviceToken: Data) async {
        token = PushToken.hex(deviceToken)
        await uploadToken()
    }

    private func uploadToken() async {
        guard let token, let userID else { return }
        if let registeredFor, registeredFor.token == token, registeredFor.user == userID { return }
        do {
            try await repository.register(token: token, environment: environment, bundleID: bundleID)
            registeredFor = (token, userID)
        } catch {
            // Not shown: the next launch or sign-in tries again, and the
            // inbox works either way.
        }
    }

    /// Before signing out: takes this phone off the account and clears the
    /// badge. Bounded, so a slow network never holds up signing out.
    func prepareForSignOut() async {
        let token = registeredFor?.token
        registeredFor = nil
        userID = nil
        await system.setBadgeCount(0)
        guard let token else { return }
        let repository = repository
        await withTaskGroup(of: Void.self) { group in
            group.addTask { try? await repository.unregister(token: token) }
            group.addTask { try? await Task.sleep(for: .seconds(3)) }
            await group.next()
            group.cancelAll()
        }
    }

    // MARK: Badge and incoming pushes

    func setBadge(_ count: Int) async {
        await system.setBadgeCount(count)
    }

    func didReceiveWhileOpen() {
        receivedWhileOpen += 1
    }

    func didTap(_ payload: PushPayload) {
        let link = payload.destination
        if let openLink {
            openLink(link)
        } else {
            pendingLink = link
        }
    }
}

/// The real thing: `UNUserNotificationCenter` and `UIApplication`.
@MainActor
final class SystemPushHooks: PushSystem {
    func authorization() async -> PushAuthorization {
        switch await UNUserNotificationCenter.current().notificationSettings().authorizationStatus {
        case .notDetermined: .notDetermined
        case .denied: .denied
        case .authorized, .provisional, .ephemeral: .allowed
        @unknown default: .denied
        }
    }

    func requestAuthorization() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])) ?? false
    }

    func registerForRemoteNotifications() {
        UIApplication.shared.registerForRemoteNotifications()
    }

    func setBadgeCount(_ count: Int) async {
        try? await UNUserNotificationCenter.current().setBadgeCount(count)
    }
}

#if DEBUG
/// Previews and screenshots: a fixed permission state, nothing registered.
@MainActor
final class PreviewPushSystem: PushSystem {
    var state: PushAuthorization

    init(_ state: PushAuthorization = .notDetermined) {
        self.state = state
    }

    func authorization() async -> PushAuthorization { state }
    func requestAuthorization() async -> Bool { state = .allowed; return true }
    func registerForRemoteNotifications() {}
    func setBadgeCount(_ count: Int) async {}
}
#endif
