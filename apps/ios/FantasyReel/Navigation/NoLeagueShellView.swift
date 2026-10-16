import FantasyReelCore
import SwiftUI

/// The signed-in home before the user belongs to any league (mockup "No leagues
/// yet", V2NoLeagues): no tab bar, glass buttons at the top for the menu (a
/// 34pt avatar), search and notifications.
struct NoLeagueShellView: View {
    @Environment(ShellRouter.self) private var router
    @Environment(\.currentProfile) private var profile
    @Environment(SessionStore.self) private var session

    var body: some View {
        @Bindable var router = router
        NavigationStack(path: $router.standalonePath) {
            NoLeaguesView()
                .navigationTitle("Leagues")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .principal) {
                        Text(verbatim: "").accessibilityHidden(true)
                    }
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            router.presentMenu()
                        } label: {
                            Avatar(name: displayName, imageURL: profile?.avatarURL, size: .custom(34))
                        }
                        .accessibilityLabel("Open menu: invitations, wishlist, account")
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            router.push(.movieSearch)
                        } label: {
                            Image(systemName: "magnifyingglass")
                        }
                        .accessibilityLabel("Search movies")
                    }
                    ToolbarSpacer(.fixed, placement: .topBarTrailing)
                    ToolbarItem(placement: .topBarTrailing) {
                        NotificationsButton()
                    }
                }
                .navigationDestination(for: LeagueRoute.self) { route in
                    LeagueDestinationView(route: route)
                }
        }
    }

    private var displayName: String {
        profile?.displayName ?? session.account?.email ?? "You"
    }
}
