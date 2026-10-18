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
    /// The fallback when sign-out couldn't reach the server: iOS stops
    /// delivering to this install, and APNs then reports the token dead.
    func unregisterForRemoteNotifications()
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
    /// The notification the person last opened from a push, for the inbox to
    /// mark read.
    private(set) var openedNotification: NotificationID?

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
    /// The latest APNs token, kept across launches so sign-out can remove it
    /// even when this launch never got to register it.
    @ObservationIgnored private var token: String? {
        didSet { defaults.set(token, forKey: Self.tokenKey) }
    }
    @ObservationIgnored private var upload: Task<Void, Never>?
    @ObservationIgnored private var userID: UserID?
    /// The account the current token was last registered to.
    @ObservationIgnored private var registeredFor: (token: String, user: UserID)?
    @ObservationIgnored private var pendingLink: DeepLink?

    private static let promptKey = "fr.pushPromptDismissed"
    private static let tokenKey = "fr.pushToken"

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
        self.token = defaults.string(forKey: Self.tokenKey)
    }

    /// The contextual ask: shown until the person answers iOS or says not now.
    var showsPrompt: Bool {
        authorization == .notDetermined && !promptDismissed
    }

    // MARK: Permission

    /// Also registers this phone when notifications just became allowed while
    /// signed in: from the prompt, or turned on in iOS Settings meanwhile.
    func refreshAuthorization() async {
        let previous = authorization
        authorization = await system.authorization()
        if authorization == .allowed, previous != .allowed, userID != nil {
            system.registerForRemoteNotifications()
        }
    }

    /// Asks iOS; a yes registers this phone (`refreshAuthorization`).
    func requestPermission() async {
        _ = await system.requestAuthorization()
        await refreshAuthorization()
    }

    func dismissPrompt() {
        promptDismissed = true
        defaults.set(true, forKey: Self.promptKey)
    }

    // MARK: Account and token

    /// Called whenever the signed-in account changes (nil when signed out).
    func accountDidChange(_ userID: UserID?) async {
        self.userID = userID
        let wasAllowed = authorization == .allowed
        await refreshAuthorization()
        guard userID != nil else { return }
        // iOS hands back the token through the app delegate; asking again
        // each time is how Apple says to keep it current. (A change to
        // allowed already asked, in refreshAuthorization.)
        if wasAllowed, authorization == .allowed { system.registerForRemoteNotifications() }
        await uploadToken()
    }

    /// From `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`.
    func didRegister(deviceToken: Data) async {
        token = PushToken.hex(deviceToken)
        await uploadToken()
    }

    /// Only sends a token that isn't known to be on this account already
    /// (and only once iOS allows notifications, so a token left from an
    /// earlier grant isn't re-attached after the person turned them off).
    private func uploadToken() async {
        guard let token, let userID, authorization == .allowed else { return }
        if let registeredFor, registeredFor.token == token, registeredFor.user == userID { return }
        let repository = repository, environment = environment, bundleID = bundleID
        let task = Task {
            do {
                try await repository.register(token: token, environment: environment, bundleID: bundleID)
                // Signed out meanwhile: prepareForSignOut waits for this task
                // and removes the token after it.
                if self.userID == userID { self.registeredFor = (token, userID) }
            } catch {
                // Not shown: the next launch or sign-in tries again, and the
                // inbox works either way.
            }
        }
        upload = task
        await task.value
    }

    /// Before signing out: takes this phone off the account and clears the
    /// badge. A registration still in flight lands first, so it can't put the
    /// phone back afterwards. Bounded, so a slow network never holds up
    /// signing out; when the server can't be reached, iOS is told to stop
    /// delivering instead, so the next person on this phone never sees the
    /// last one's pushes.
    func prepareForSignOut() async {
        registeredFor = nil
        userID = nil
        await system.setBadgeCount(0)
        guard let token else { return }
        let repository = repository
        let pending = upload
        let removed = await withTaskGroup(of: Bool.self) { group in
            group.addTask {
                await pending?.value
                do {
                    try await repository.unregister(token: token)
                    return true
                } catch {
                    return false
                }
            }
            group.addTask {
                try? await Task.sleep(for: .seconds(3))
                return false
            }
            let first = await group.next() ?? false
            group.cancelAll()
            return first
        }
        if !removed { system.unregisterForRemoteNotifications() }
    }

    // MARK: Badge and incoming pushes

    func setBadge(_ count: Int) async {
        await system.setBadgeCount(count)
    }

    func didReceiveWhileOpen() {
        receivedWhileOpen += 1
    }

    func didTap(_ payload: PushPayload) {
        if let id = payload.notificationID { openedNotification = id }
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

    func unregisterForRemoteNotifications() {
        UIApplication.shared.unregisterForRemoteNotifications()
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
    func unregisterForRemoteNotifications() {}
    func setBadgeCount(_ count: Int) async {}
}
#endif
