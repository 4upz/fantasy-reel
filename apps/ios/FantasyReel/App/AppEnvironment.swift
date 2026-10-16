import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation

/// The app's dependency container: one per launch, handed to every screen
/// through the SwiftUI environment (`@Environment(AppEnvironment.self)`).
///
/// It holds clients and repositories only. Screen state lives in each screen's
/// own view model, and account-scoped state lives under the signed-in tree,
/// which is rebuilt per account.
@Observable
@MainActor
final class AppEnvironment {
    let configuration: AppConfiguration
    let supabase: SupabaseProvider
    let edgeFunctions: EdgeFunctionClient
    let changeFeed: ChangeFeed
    let session: SessionStore

    let leagues: LeagueRepository
    let profiles: ProfileRepository
    let notifications: NotificationRepository

    init(configuration: AppConfiguration) {
        let supabase = SupabaseProvider(configuration: configuration)
        self.configuration = configuration
        self.supabase = supabase
        self.edgeFunctions = EdgeFunctionClient(provider: supabase)
        self.changeFeed = ChangeFeed(provider: supabase)
        self.session = SessionStore(auth: AuthService(provider: supabase))
        self.leagues = LeagueRepository(provider: supabase)
        self.profiles = ProfileRepository(provider: supabase)
        self.notifications = NotificationRepository(provider: supabase)
    }

    /// Parses an incoming URL against this build's site hosts and scheme.
    func deepLink(from url: URL) -> DeepLink? {
        DeepLink.parse(url, siteHosts: configuration.siteHosts, appScheme: configuration.urlScheme)
    }
}
