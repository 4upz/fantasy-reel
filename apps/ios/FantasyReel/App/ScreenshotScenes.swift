#if DEBUG
import FantasyReelAPI
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

    static var requested: ScreenshotScene? {
        ProcessInfo.processInfo.environment["FR_SCREENSHOT"].flatMap(ScreenshotScene.init(rawValue:))
    }
}

struct ScreenshotSceneView: View {
    let scene: ScreenshotScene

    @State private var environment = AppEnvironment.preview()
    @State private var navigation = AuthNavigation()

    var body: some View {
        content
            .environment(environment)
            .environment(environment.session)
            .environment(navigation)
            .onAppear(perform: prepare)
    }

    @ViewBuilder
    private var content: some View {
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
        }
    }
}
#endif
