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

    let leagues: any LeagueRepository
    let leagueLifecycle: any LeagueLifecycleRepository
    let profiles: any ProfileRepository
    let notifications: any NotificationRepository
    let account: any AccountRepository
    /// Profile and team photo uploads (shared by Account and team editing).
    let avatarStorage: any AvatarStorage
    /// Teams, rosters, standings and drops (F-10, F-11, F-14).
    let teams: any TeamRepository
    /// Pickup and counterpick bidding (F-12).
    let bids: any BidRepository
    /// Trade offers (F-13).
    let trades: any TradeRepository
    let movies: any MovieRepository
    let wishlists: any WishlistRepository
    let leagueMovies: any LeagueMovieRepository

    /// Repositories default to the live Supabase ones; previews and tests pass
    /// in-memory fakes (see `AppEnvironment.preview`).
    init(
        configuration: AppConfiguration,
        leagues: (any LeagueRepository)? = nil,
        leagueLifecycle: (any LeagueLifecycleRepository)? = nil,
        profiles: (any ProfileRepository)? = nil,
        notifications: (any NotificationRepository)? = nil,
        account: (any AccountRepository)? = nil,
        avatarStorage: (any AvatarStorage)? = nil,
        teams: (any TeamRepository)? = nil,
        bids: (any BidRepository)? = nil,
        trades: (any TradeRepository)? = nil,
        movies: (any MovieRepository)? = nil,
        wishlists: (any WishlistRepository)? = nil,
        leagueMovies: (any LeagueMovieRepository)? = nil
    ) {
        let supabase = SupabaseProvider(configuration: configuration)
        self.configuration = configuration
        self.supabase = supabase
        let edgeFunctions = EdgeFunctionClient(provider: supabase)
        self.edgeFunctions = edgeFunctions
        self.changeFeed = ChangeFeed(provider: supabase)
        self.session = SessionStore(auth: AuthService(provider: supabase))
        self.leagues = leagues ?? SupabaseLeagueRepository(provider: supabase)
        self.leagueLifecycle = leagueLifecycle ?? EdgeLeagueLifecycleRepository(functions: edgeFunctions)
        self.profiles = profiles ?? SupabaseProfileRepository(provider: supabase)
        self.notifications = notifications ?? SupabaseNotificationRepository(provider: supabase)
        self.account = account ?? SupabaseAccountRepository(provider: supabase, edgeFunctions: edgeFunctions)
        self.avatarStorage = avatarStorage ?? SupabaseAvatarStorage(provider: supabase)
        self.teams = teams ?? SupabaseTeamRepository(provider: supabase, functions: edgeFunctions)
        self.bids = bids ?? SupabaseBidRepository(provider: supabase, functions: edgeFunctions)
        self.trades = trades ?? EdgeTradeRepository(functions: edgeFunctions)
        self.movies = movies ?? EdgeMovieRepository(functions: edgeFunctions)
        self.wishlists = wishlists ?? SupabaseWishlistRepository(provider: supabase)
        self.leagueMovies = leagueMovies ?? SupabaseLeagueMovieRepository(provider: supabase)
    }

    /// Parses an incoming URL against this build's site hosts and scheme.
    func deepLink(from url: URL) -> DeepLink? {
        DeepLink.parse(url, siteHosts: configuration.siteHosts, appScheme: configuration.urlScheme)
    }
}

#if DEBUG
extension AppEnvironment {
    /// A container for SwiftUI previews: in-memory repositories and a client
    /// pointed at an address nothing listens on, so a preview never hits the
    /// network. Pass seeded fakes to show data.
    static func preview(
        leagues: any LeagueRepository = InMemoryLeagueRepository(),
        leagueLifecycle: any LeagueLifecycleRepository = InMemoryLeagueLifecycleRepository(),
        profiles: any ProfileRepository = InMemoryProfileRepository(),
        notifications: any NotificationRepository = InMemoryNotificationRepository(),
        account: any AccountRepository = InMemoryAccountRepository(),
        avatarStorage: any AvatarStorage = InMemoryAvatarStorage(),
        teams: any TeamRepository = InMemoryTeamRepository(),
        bids: any BidRepository = InMemoryBidRepository(),
        trades: any TradeRepository = InMemoryTradeRepository(),
        movies: any MovieRepository = InMemoryMovieRepository(),
        wishlists: any WishlistRepository = InMemoryWishlistRepository(),
        leagueMovies: any LeagueMovieRepository = InMemoryLeagueMovieRepository()
    ) -> AppEnvironment {
        AppEnvironment(
            configuration: AppConfiguration(
                supabaseURL: URL(string: "http://127.0.0.1:1")!,
                supabaseAnonKey: "preview",
                siteURL: URL(string: "https://fantasyreel.com")!,
                urlScheme: "fantasyreel",
                // Shows the Discord guide's Add to Discord button; never opened.
                discordClientID: "preview"
            ),
            leagues: leagues,
            leagueLifecycle: leagueLifecycle,
            profiles: profiles,
            notifications: notifications,
            account: account,
            avatarStorage: avatarStorage,
            teams: teams,
            bids: bids,
            trades: trades,
            movies: movies,
            wishlists: wishlists,
            leagueMovies: leagueMovies
        )
    }
}
#endif
