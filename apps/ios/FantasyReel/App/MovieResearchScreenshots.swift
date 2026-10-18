#if DEBUG
import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// Screenshot scenes for movie search, movie detail and wishlists (F-06,
/// F-07), signed in as Alice in an active season, with in-memory data only.
struct MovieResearchScreenshotView: View {
    let scene: ScreenshotScene

    @State private var fixture = MovieResearchFixture()
    @State private var isReady = false
    @State private var detailPath: [LeagueRoute] = [.movie(MovieResearchFixture.streetFighter)]

    var body: some View {
        Group {
            if isReady {
                content
            } else {
                Color.frBackground.ignoresSafeArea()
            }
        }
        .environment(fixture.environment)
        .environment(fixture.environment.session)
        .environment(fixture.router)
        .environment(fixture.directory)
        .environment(fixture.inbox)
        .environment(fixture.wishlist)
        .environment(fixture.research)
        .environment(fixture.history)
        .environment(\.leagueSelection, fixture.directory.selection)
        .task {
            await fixture.prepare()
            isReady = true
        }
    }

    @ViewBuilder
    private var content: some View {
        switch scene {
        case .movieSearch:
            stack { MovieSearchView(isSearchTabRoot: true, initialQuery: "Street") }
        case .movieSearchIdle:
            stack { MovieSearchView(isSearchTabRoot: true) }
        case .movieDetail:
            // Pushed from search, as in the app, so the back button shows.
            NavigationStack(path: $detailPath) {
                MovieSearchView(isSearchTabRoot: true)
                    .navigationDestination(for: LeagueRoute.self) { LeagueDestinationView(route: $0) }
            }
        case .wishlist:
            stack { WishlistView() }
        case .sharedWishlists:
            stack { WishlistView(initialMode: .league) }
        default:
            EmptyView()
        }
    }

    private func stack(@ViewBuilder _ root: () -> some View) -> some View {
        NavigationStack {
            root()
                .navigationDestination(for: LeagueRoute.self) { LeagueDestinationView(route: $0) }
        }
    }
}

@MainActor
final class MovieResearchFixture {
    static let alice: UserID = "u-alice"
    static let streetFighter: TMDbID = 1001

    let environment: AppEnvironment
    let router = ShellRouter()
    let directory: LeagueDirectoryStore
    let inbox: InboxStore
    let wishlist: WishlistStore
    let research: LeagueResearchStore
    let history = MovieSearchHistory()

    init() {
        let now = Date()
        let leagueID: LeagueID = "l-popcorn"
        let season = League(
            id: leagueID, name: "Popcorn Syndicate", ownerID: Self.alice, status: .active,
            seriesID: "s-popcorn", seasonYear: 2026, seasonEnd: DateOnly("2026-12-31")!,
            createdAt: now, updatedAt: now
        )
        func member(_ user: String, _ name: String, team: String, shares: Bool) -> LeagueMember {
            let participant: ParticipantID = .init("p-\(user)")
            return LeagueMember(
                participant: LeagueParticipant(id: participant, leagueID: leagueID, userID: .init("u-\(user)")),
                team: Team(id: .init("t-\(user)"), participantID: participant, name: team),
                profile: Profile(id: "pr-\(user)", userID: .init("u-\(user)"), displayName: name, wishlistPublic: shares)
            )
        }
        let members = [
            member("alice", "Alice Spielberg", team: "Reel Deal", shares: true),
            member("bob", "Bob Nolan", team: "Nolan's Notebook", shares: true),
            member("carol", "Carol Coppola", team: "Coppola Cut", shares: true),
            member("dave", "Dave Kubrick", team: "Kubrick's Cube", shares: false),
        ]

        func date(_ text: String) -> DateOnly? { DateOnly(text) }
        func holding(_ tmdb: TMDbID, _ title: String, _ user: String, team: String, source: HoldingSource, release: String, round: Int? = nil, paid: Int? = nil) -> TeamHolding {
            TeamHolding(
                holdingID: .init("h-\(tmdb.rawValue)"), source: source, leagueID: leagueID,
                teamID: .init("t-\(user)"), movieID: .init("m-\(tmdb.rawValue)"),
                round: round, amountPaid: paid, teamName: team, tmdbID: tmdb, title: title, releaseDate: date(release)
            )
        }
        var streetFighterHolding = holding(Self.streetFighter, "Street Fighter", "alice", team: "Reel Deal", source: .draft, release: "2026-11-20", round: 4)
        streetFighterHolding.combinedScore = 74
        streetFighterHolding.fantasyPoints = 14
        let holdings = [
            streetFighterHolding,
            holding(1002, "The Social Reckoning", "bob", team: "Nolan's Notebook", source: .draft, release: "2026-10-09", round: 1),
            holding(1003, "Narnia: The Magician's Nephew", "carol", team: "Coppola Cut", source: .pickup, release: "2026-11-26", paid: 12),
        ]
        let catalog = [
            MovieSearchResult(tmdbID: Self.streetFighter, title: "Street Fighter", releaseDate: date("2026-11-20")),
            MovieSearchResult(tmdbID: 2001, title: "Street Fighter", releaseDate: date("1994-12-23")),
            MovieSearchResult(tmdbID: 2002, title: "Street Fighter: The Legend of Chun-Li", releaseDate: date("2009-02-27")),
            MovieSearchResult(tmdbID: 2003, title: "Streets of Gold", releaseDate: date("2027-03-12")),
            MovieSearchResult(tmdbID: 2004, title: "Street Kings 3", releaseDate: nil),
            MovieSearchResult(tmdbID: 1004, title: "Mortal Kombat II", releaseDate: date("2026-10-23")),
            MovieSearchResult(tmdbID: 1002, title: "The Social Reckoning", releaseDate: date("2026-10-09")),
        ]
        let details = MovieDetails(
            tmdbID: Self.streetFighter, imdbID: "tt0000001", title: "Street Fighter",
            tagline: "Every fighter has a reason.",
            overview: "A live-action adaptation of the fighting-game series. Fighters from around the world meet in a global tournament.",
            releaseDate: date("2026-11-20"), runtime: 112,
            genres: [MovieGenre(id: 28, name: "Action"), MovieGenre(id: 12, name: "Adventure")],
            cast: [
                CastMember(id: 1, name: "Andrew Koji", character: "Ryu"),
                CastMember(id: 2, name: "Noah Centineo", character: "Ken Masters"),
                CastMember(id: 3, name: "Callina Liang", character: "Chun-Li"),
                CastMember(id: 4, name: "Jason Momoa", character: "Blanka"),
            ],
            director: "Kitao Sakurai"
        )
        let franchise = FranchiseHistory(
            collectionID: 9, collectionName: "Street Fighter Collection", entryNumber: 3,
            films: [
                FranchiseFilm(tmdbID: 2001, title: "Street Fighter", releaseDate: date("1994-12-23"), rtScore: 12),
                FranchiseFilm(tmdbID: 2002, title: "Street Fighter: The Legend of Chun-Li", releaseDate: date("2009-02-27"), rtScore: 3),
            ],
            averageRT: 7.5, lastRT: 3
        )
        let projection = MovieProjection(
            tmdbID: Self.streetFighter, projectedRT: 74, range50: [69, 79], range80: [66, 81],
            pRotten: 0.04, pFresh: 0.96, p90: 0.02, expectedPoints: 13, baselineRT: 58,
            contributions: [
                .init(factor: "director", label: "Director", deltaRT: 8),
                .init(factor: "cast", label: "Cast", deltaRT: 5),
                .init(factor: "franchise", label: "Franchise", deltaRT: -6),
                .init(factor: "release_window", label: "October–December release", deltaRT: 3),
                .init(factor: "label", label: "Studio", deltaRT: 2),
                .init(factor: "runtime", label: "Runtime", deltaRT: 3),
            ],
            includesEarlyReviews: true, earlyRT: .init(score: 74, reviews: 31), computedAt: now.addingTimeInterval(-86_400 * 5)
        )
        let day: TimeInterval = 86_400
        func wish(_ user: UserID, _ tmdb: TMDbID, _ title: String, daysAgo: Double) -> WishlistedMovie {
            WishlistedMovie(id: .init("w-\(user.rawValue)-\(tmdb.rawValue)"), userID: user, tmdbID: tmdb, title: title, addedAt: now.addingTimeInterval(-day * daysAgo))
        }
        let wishlists = [
            wish(Self.alice, 1002, "The Social Reckoning", daysAgo: 40),
            wish(Self.alice, Self.streetFighter, "Street Fighter", daysAgo: 12),
            wish(Self.alice, 1004, "Mortal Kombat II", daysAgo: 6),
            wish(Self.alice, 1005, "The Cat in the Hat", daysAgo: 3),
            wish(Self.alice, 1003, "Narnia: The Magician's Nephew", daysAgo: 1),
            wish(Self.alice, 1006, "Ice Age: Boiling Point", daysAgo: 0),
            wish("u-bob", 1004, "Mortal Kombat II", daysAgo: 9),
            wish("u-bob", 1007, "Shrek 5", daysAgo: 2),
            wish("u-carol", 1006, "Ice Age: Boiling Point", daysAgo: 4),
        ]

        let environment = AppEnvironment.preview(
            leagues: InMemoryLeagueRepository(seasons: [season], members: members),
            movies: InMemoryMovieRepository(
                catalog: catalog,
                details: [Self.streetFighter: details],
                histories: [Self.streetFighter: franchise],
                projections: .enabled(modelVersion: 3, projections: [Self.streetFighter: projection])
            ),
            wishlists: InMemoryWishlistRepository(rows: wishlists, sharing: [Self.alice, "u-bob", "u-carol"]),
            leagueMovies: InMemoryLeagueMovieRepository(
                holdings: holdings,
                movies: [Movie(id: "m-1001", tmdbID: Self.streetFighter, title: "Street Fighter", releaseDate: date("2026-11-20"), combinedScore: 74, fantasyPoints: 14)]
            )
        )
        self.environment = environment
        directory = LeagueDirectoryStore(userID: Self.alice, repository: environment.leagues, defaults: UserDefaults(suiteName: "fr.screenshots") ?? .standard)
        inbox = InboxStore(userID: Self.alice, repository: environment.notifications)
        wishlist = WishlistStore(userID: Self.alice, repository: environment.wishlists)
        research = LeagueResearchStore(leagues: environment.leagues, leagueMovies: environment.leagueMovies)
    }

    func prepare() async {
        await directory.load()
        await wishlist.load()
        if let selection = directory.selection { await research.load(selection) }
        history.record("Dune")
        history.record("Mortal Kombat")
        history.record("Narnia")
    }
}
#endif
