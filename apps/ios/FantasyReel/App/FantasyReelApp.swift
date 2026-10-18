import FantasyReelAPI
import SwiftUI

@main
struct FantasyReelApp: App {
    /// Built once at launch. A build with missing or placeholder configuration
    /// shows a screen that says exactly what to fix instead of crashing.
    @State private var bootstrap: Result<AppEnvironment, AppConfiguration.LoadError>
    @AppStorage(AppearancePreference.storageKey) private var appearance: AppearancePreference = .system
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        FRFonts.registerIfNeeded()
        switch Result(catching: { () throws(AppConfiguration.LoadError) in try AppConfiguration.fromMainBundle() }) {
        case .success(let configuration):
            _bootstrap = State(initialValue: .success(AppEnvironment(configuration: configuration)))
        case .failure(let error):
            _bootstrap = State(initialValue: .failure(error))
        }
    }

    var body: some Scene {
        WindowGroup {
            Group {
                #if DEBUG
                if let scene = ScreenshotScene.requested {
                    ScreenshotSceneView(scene: scene)
                } else {
                    app
                }
                #else
                app
                #endif
            }
            .preferredColorScheme(appearance.colorScheme)
            .tint(.frGold)
        }
    }

    @ViewBuilder
    private var app: some View {
        switch bootstrap {
        case .success(let environment):
            RootView()
                .environment(environment)
                .environment(environment.session)
                .onAppear { appDelegate.push = environment.push }
        case .failure(let error):
            ConfigurationErrorView(message: error.description)
        }
    }
}

/// The Appearance setting (F-03): System, Light or Dark, saved on this device.
/// The Account screen writes it; the app root applies it.
enum AppearancePreference: String, CaseIterable, Identifiable {
    case system, light, dark

    static let storageKey = "fr.appearance"

    var id: Self { self }

    var title: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

/// Shown only when the build's configuration is broken (a developer problem).
private struct ConfigurationErrorView: View {
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label("Configuration needed", systemImage: "wrench.and.screwdriver")
        } description: {
            Text(message)
        }
    }
}
