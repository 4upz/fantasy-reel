import FantasyReelCore
import UIKit
import UserNotifications

/// The UIKit hooks push needs: the APNs token, and pushes that arrive while
/// the app is open or are tapped. Everything else about push is `PushCenter`.
///
/// It becomes the notification center's delegate at launch, as Apple
/// requires for a tap that launched the app to be delivered; anything that
/// arrives before `push` is attached is held and handed over then.
@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    var push: PushCenter? {
        didSet { flush() }
    }

    private var pendingToken: Data?
    private var pendingTap: PushPayload?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        pendingToken = deviceToken
        flush()
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {
        // Nothing to show: the simulator without a signed-in Apple account,
        // or no network. The next launch asks again; the inbox still works.
    }

    /// A push while the app is open still shows as a banner, and the inbox refreshes.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        let isOurs = PushPayload(userInfo: notification.request.content.userInfo) != nil
        if isOurs {
            await MainActor.run { push?.didReceiveWhileOpen() }
        }
        return [.banner, .list, .sound, .badge]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier,
              let payload = PushPayload(userInfo: response.notification.request.content.userInfo)
        else { return }
        await MainActor.run {
            pendingTap = payload
            flush()
        }
    }

    private func flush() {
        guard let push else { return }
        if let token = pendingToken {
            pendingToken = nil
            Task { await push.didRegister(deviceToken: token) }
        }
        if let tap = pendingTap {
            pendingTap = nil
            push.didTap(tap)
        }
    }
}
