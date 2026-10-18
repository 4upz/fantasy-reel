import FantasyReelAPI
import FantasyReelCore
import SwiftUI

extension EnvironmentValues {
    /// The signed-in user's profile row, once loaded (display name, avatar).
    @Entry var currentProfile: Profile? = nil
}

/// Everything that exists only while one account is signed in: the league
/// directory, navigation state, the inbox badge, and the single sheet.
struct SignedInRootView: View {
    let account: AuthService.Account

    @Environment(AppEnvironment.self) private var environment
    @Environment(SessionStore.self) private var session
    @State private var directory: LeagueDirectoryStore
    @State private var inbox: InboxStore
    @State private var wishlist: WishlistStore
    @State private var research: LeagueResearchStore
    @State private var searchHistory = MovieSearchHistory()
    @State private var router = ShellRouter()
    @State private var profile: Profile?

    init(account: AuthService.Account, environment: AppEnvironment) {
        self.account = account
        _directory = State(initialValue: LeagueDirectoryStore(userID: account.id, repository: environment.leagues))
        _inbox = State(initialValue: InboxStore(userID: account.id, repository: environment.notifications))
        _wishlist = State(initialValue: WishlistStore(userID: account.id, repository: environment.wishlists))
        _research = State(initialValue: LeagueResearchStore(leagues: environment.leagues, leagueMovies: environment.leagueMovies))
    }

    var body: some View {
        @Bindable var router = router
        content
            .environment(router)
            .environment(directory)
            .environment(inbox)
            .environment(wishlist)
            .environment(research)
            .environment(searchHistory)
            .environment(\.currentProfile, profile)
            .sheet(item: $router.sheet) { sheet in
                ShellSheetView(sheet: sheet)
                    .environment(router)
                    .environment(directory)
                    .environment(inbox)
                    .environment(wishlist)
                    .environment(research)
                    .environment(searchHistory)
                    .environment(\.currentProfile, profile)
            }
            .alert(
                "Link unavailable",
                isPresented: Binding(
                    get: { router.unavailableLinkMessage != nil },
                    set: { if !$0 { router.unavailableLinkMessage = nil } }
                ),
                actions: { Button("OK", role: .cancel) {} },
                message: { Text(router.unavailableLinkMessage ?? "") }
            )
            .task {
                let profiles = environment.profiles
                let userID = account.id
                async let loadedProfile = profiles.fetchProfile(for: userID)
                async let inboxLoaded: Void = inbox.refresh()
                async let wishlistLoaded: Void = wishlist.load()
                await directory.load()
                // Route a shared link as soon as we know which leagues are visible.
                routePendingLink()
                profile = try? await loadedProfile
                await inboxLoaded
                await wishlistLoaded
            }
            .onChange(of: session.pendingDeepLink) { routePendingLink() }
            // A link that arrived before a failed load is replayed after Try Again.
            .onChange(of: directory.isReady) { routePendingLink() }
            .onChange(of: directory.selectedSeasonID, initial: true) {
                router.showSeason(directory.selectedSeasonID, defaultTab: directory.selection?.defaultTab ?? .home)
            }
            .onChange(of: directory.selection?.season.status) { oldStatus, newStatus in
                // A phase change swaps the tab set (draft → active). Land on the
                // new phase's default tab rather than a tab that vanished.
                guard oldStatus != nil, oldStatus != newStatus else { return }
                router.phaseDidChange(defaultTab: directory.selection?.defaultTab ?? .home)
            }
            .alert(
                "Discard your changes?",
                isPresented: Binding(
                    get: { router.pendingSheet != nil },
                    set: { if !$0 { router.cancelReplacingSheet() } }
                ),
                actions: {
                    Button("Discard", role: .destructive) { router.confirmReplacingSheet() }
                    Button("Keep Editing", role: .cancel) { router.cancelReplacingSheet() }
                },
                message: { Text("You have unsaved changes in the open form.") }
            )
            .refreshOnForeground {
                async let inboxRefreshed: Void = inbox.refresh()
                await directory.refresh()
                await inboxRefreshed
            }
    }

    @ViewBuilder
    private var content: some View {
        switch directory.state {
        case .idle, .loading:
            LaunchView()
        case .failed(let message):
            ErrorStateView(message: message) {
                Task { await directory.refresh() }
            }
        case .empty:
            NoLeagueShellView()
        case .loaded:
            if let selection = directory.selection {
                LeagueShellView(selection: selection)
                    // Screen state is per season: switching leagues rebuilds
                    // every tab instead of carrying view models across.
                    .id(selection.season.id)
            } else {
                NoLeagueShellView()
            }
        }
    }

    /// Replays a link that arrived while signed out or while the app was busy,
    /// once the directory knows which leagues this account can open.
    private func routePendingLink() {
        guard case .loaded = directory.state else {
            if case .empty = directory.state, let link = session.consumePendingDeepLink() {
                router.open(link, directory: directory)
            }
            return
        }
        guard let link = session.consumePendingDeepLink() else { return }
        router.open(link, directory: directory)
    }
}

/// Renders whichever single sheet is up.
private struct ShellSheetView: View {
    let sheet: ShellSheet

    @Environment(ShellRouter.self) private var router
    @Environment(LeagueDirectoryStore.self) private var directory
    /// The season the sheet opened in. A link can switch seasons while a sheet
    /// with unsaved input stays up; the sheet keeps acting on its own season
    /// rather than sending a bid or trade to the new one.
    @State private var pinnedStore: LeagueSeasonStore?

    var body: some View {
        let store = pinnedStore ?? router.seasonStore
        Group {
            if sheet.needsSeason, store == nil {
                NavigationStack {
                    EmptyStateView(
                        title: "This season isn't open",
                        message: "Close this and open the league again.",
                        systemImage: "film.stack"
                    )
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Close") { router.dismissSheet() }
                        }
                    }
                }
            } else {
                content
            }
        }
        .environment(\.leagueSelection, store?.selection ?? directory.selection)
        .modifier(SeasonStoreEnvironment(store: store))
        .onAppear { if pinnedStore == nil { pinnedStore = router.seasonStore } }
    }

    @ViewBuilder
    private var content: some View {
        switch sheet {
        case .menu:
            MenuSheetView()
        case .createLeague:
            NavigationStack { CreateLeagueView() }
        case .joinLeague(let input):
            NavigationStack { JoinLeagueView(input: input) }
        case .editTeam:
            NavigationStack { EditTeamView() }
        case .dropMovie(let holdingID):
            NavigationStack { DropMovieView(holdingID: holdingID) }
        case .proposeTrade(let teamID):
            NavigationStack { TradeComposerView(mode: .propose(teamID)) }
        case .counterTrade(let offerID):
            NavigationStack { TradeComposerView(mode: .counter(offerID)) }
        case .placeBid(let target):
            NavigationStack { PlaceBidView(target: target) }
        }
    }
}

private extension ShellSheet {
    /// Sheets that act on the open season and read its store.
    var needsSeason: Bool {
        switch self {
        case .menu, .createLeague, .joinLeague: false
        case .editTeam, .dropMovie, .proposeTrade, .counterTrade, .placeBid: true
        }
    }
}

/// Hands the open season's store to a sheet when there is one.
private struct SeasonStoreEnvironment: ViewModifier {
    let store: LeagueSeasonStore?

    @ViewBuilder
    func body(content: Content) -> some View {
        if let store {
            content.environment(store)
        } else {
            content
        }
    }
}
