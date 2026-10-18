#if DEBUG
import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// Screenshot scenes for the league overview, roster, bids, trades and
/// standings (F-10 to F-14): Alice, the commissioner, mid-season in Popcorn
/// Syndicate, with in-memory data only. The `…Projected` scenes and
/// `teamProjection` turn projected scores (Beta, F-19) on.
struct TeamMarketScreenshotView: View {
    let scene: ScreenshotScene

    @State private var fixture: TeamMarketFixture
    @State private var isReady = false

    init(scene: ScreenshotScene) {
        self.scene = scene
        _fixture = State(initialValue: TeamMarketFixture(projected: TeamMarketFixture.projectedScenes.contains(scene)))
    }

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
        .environment(fixture.season)
        .environment(fixture.inbox)
        .environment(fixture.wishlist)
        .environment(fixture.research)
        .environment(fixture.history)
        .environment(\.leagueSelection, fixture.directory.selection)
        .environment(\.projectionStore, fixture.season.projections)
        .task {
            await fixture.prepare()
            fixture.route(to: scene)
            isReady = true
        }
    }

    /// Tab screens render inside the real shell (top bar, tab bar, pushed
    /// screens with their back button); sheets render on their own.
    @ViewBuilder
    private var content: some View {
        switch scene {
        case .leagueHome, .roster, .standings, .teamDetail, .bids, .bidPriorities, .trades, .rosterProjected, .standingsProjected:
            LeagueTabs(tabs: LeagueNavigation.tabs(for: .active))
        case .teamProjection: NavigationStack { TeamProjectionView(teamID: TeamMarketFixture.team("alice")) }
        case .placeBidProjected: NavigationStack { PlaceBidView(target: .pickup(BiddableMovie(tmdbID: 1013, title: "Toy Story 5", releaseDate: DateOnly("2026-11-19")))) }
        case .tradeComposerProjected: NavigationStack { TradeComposerView(mode: .propose(TeamMarketFixture.team("bob"))) }
        case .placeBid: NavigationStack { PlaceBidView(target: .pickup(BiddableMovie(tmdbID: 1004, title: "Mortal Kombat II", releaseDate: DateOnly("2026-10-23")))) }
        case .tradeComposer: NavigationStack { TradeComposerView(mode: .propose(TeamMarketFixture.team("dave"))) }
        case .dropMovie: NavigationStack { DropMovieView(holdingID: "h-1006") }
        default: EmptyView()
        }
    }
}

@MainActor
final class TeamMarketFixture {
    static let alice: UserID = "u-alice"
    static func team(_ user: String) -> TeamID { TeamID("t-\(user)") }
    static let projectedScenes: Set<ScreenshotScene> = [
        .rosterProjected, .standingsProjected, .teamProjection, .placeBidProjected, .tradeComposerProjected,
    ]

    let environment: AppEnvironment
    let router = ShellRouter()
    let directory: LeagueDirectoryStore
    let season: LeagueSeasonStore
    let inbox: InboxStore
    let wishlist: WishlistStore
    let research: LeagueResearchStore
    let history = MovieSearchHistory()

    init(projected: Bool = false) {
        let now = Date()
        let day: TimeInterval = 86_400
        let leagueID: LeagueID = "l-popcorn"
        let league = League(
            id: leagueID, name: "Popcorn Syndicate", ownerID: Self.alice, status: .active,
            totalSlots: 6, dropLimit: 3, biddingCounterpickSlots: 1,
            seriesID: "s-popcorn", seasonYear: 2026, seasonEnd: DateOnly("2026-12-31")!,
            createdAt: now, updatedAt: now
        )
        let people: [(user: String, name: String, team: String, points: Double, budget: Int)] = [
            ("alice", "Alice Spielberg", "Reel Deal", 41, 54),
            ("bob", "Bob Nolan", "Nolan's Notebook", 58, 37),
            ("carol", "Carol Coppola", "Coppola Cut", 41, 72),
            ("dave", "Dave Kubrick", "Kubrick's Cube", 12, 90),
        ]
        let members = people.map { person in
            let participant = ParticipantID("p-\(person.user)")
            return LeagueMember(
                participant: LeagueParticipant(id: participant, leagueID: leagueID, userID: .init("u-\(person.user)")),
                team: Team(id: Self.team(person.user), participantID: participant, name: person.team),
                profile: Profile(id: .init("pr-\(person.user)"), userID: .init("u-\(person.user)"), displayName: person.name)
            )
        }
        let teams = people.map { person in
            SeasonTeam(
                team: Team(id: Self.team(person.user), participantID: .init("p-\(person.user)"), name: person.team),
                participantID: .init("p-\(person.user)"), userID: .init("u-\(person.user)"),
                ownerName: person.name, score: TeamScore(totalPoints: person.points),
                budget: TeamBudget(remainingBudget: person.budget, totalSpent: 100 - person.budget)
            )
        }
        let standings = [("bob", 1, false), ("alice", 2, true), ("carol", 2, true), ("dave", 4, false)].map { user, rank, tied in
            let person = people.first { $0.user == user }!
            return StandingRow(
                teamID: Self.team(user), teamName: person.team, participantID: .init("p-\(user)"),
                userID: .init("u-\(user)"), totalPoints: person.points, rank: rank, isTied: tied
            )
        }

        func holding(_ tmdb: TMDbID, _ title: String, _ user: String, source: HoldingSource, release: String, rt: Double? = nil, round: Int? = nil, paid: Int? = nil) -> TeamHolding {
            var row = TeamHolding(
                holdingID: .init("h-\(tmdb.rawValue)"), source: source, leagueID: leagueID,
                teamID: Self.team(user), movieID: .init("m-\(tmdb.rawValue)"),
                round: round, amountPaid: paid, teamName: people.first { $0.user == user }!.team,
                tmdbID: tmdb, title: title, releaseDate: DateOnly(release)
            )
            if let rt {
                row.combinedScore = rt
                row.fantasyPoints = FantasyPoints.fantasyPointsForTomatometer(rt)
            }
            return row
        }
        let holdings = [
            holding(1001, "Street Fighter", "alice", source: .draft, release: "2026-10-16", rt: 74, round: 1),
            holding(1005, "The Cat in the Hat", "alice", source: .draft, release: "2026-09-12", rt: 87, round: 2),
            holding(1006, "Ice Age: Boiling Point", "alice", source: .draft, release: "2026-12-18", round: 3),
            holding(1008, "Avengers: Doomsday", "alice", source: .pickup, release: "2026-12-18", paid: 12),
            holding(1009, "Jumanji 3", "alice", source: .draft, release: "2026-12-11", round: 4),
            holding(1002, "The Social Reckoning", "bob", source: .draft, release: "2026-10-09", rt: 96, round: 1),
            holding(1010, "Dune: Part Three", "bob", source: .draft, release: "2026-12-18", round: 2),
            holding(1003, "Narnia: The Magician's Nephew", "carol", source: .pickup, release: "2026-11-26", paid: 12),
            holding(1011, "Wicked: For Good", "carol", source: .draft, release: "2026-09-21", rt: 81, round: 1),
            holding(1012, "Shrek 5", "dave", source: .draft, release: "2026-12-23", round: 1),
        ]
        let counterpicks = [
            Counterpick(
                id: "c-1", leagueID: leagueID, counterpickerTeamID: Self.team("alice"), targetTeamID: Self.team("carol"),
                movieID: "m-1003", phase: "draft",
                movie: Movie(id: "m-1003", tmdbID: 1003, title: "Narnia: The Magician's Nephew", releaseDate: DateOnly("2026-11-26"))
            ),
        ]

        let deadline = now.addingTimeInterval(3 * day + 5 * 3600)
        func movieData(_ title: String, _ release: String) -> BidMovieData {
            BidMovieData(title: title, releaseDate: DateOnly(release))
        }
        let pickupBids = [
            PickupBid(id: "b-1", leagueID: leagueID, teamID: Self.team("bob"), tmdbID: 1004, movieData: movieData("Mortal Kombat II", "2026-10-23"),
                      amount: 9, status: .active, createdAt: now.addingTimeInterval(-3600), processingDeadline: deadline),
            PickupBid(id: "b-2", leagueID: leagueID, teamID: Self.team("alice"), tmdbID: 1004, movieData: movieData("Mortal Kombat II", "2026-10-23"),
                      amount: 8, status: .outbid, createdAt: now.addingTimeInterval(-2 * day), processingDeadline: deadline, priority: 1),
            PickupBid(id: "b-3", leagueID: leagueID, teamID: Self.team("alice"), tmdbID: 1013, movieData: movieData("Toy Story 5", "2026-11-19"),
                      amount: 14, status: .active, createdAt: now.addingTimeInterval(-day), processingDeadline: deadline, priority: 2,
                      conditionalDropDraftPickID: "h-1009"),
            PickupBid(id: "b-4", leagueID: leagueID, teamID: Self.team("alice"), tmdbID: 1014, movieData: movieData("The Odyssey", "2026-12-04"),
                      amount: 3, status: .active, createdAt: now.addingTimeInterval(-0.5 * day), processingDeadline: deadline, priority: 3),
            PickupBid(id: "b-5", leagueID: leagueID, teamID: Self.team("carol"), tmdbID: 1015, movieData: movieData("Zootopia 2", "2026-11-26"),
                      amount: 6, status: .active, createdAt: now.addingTimeInterval(-0.2 * day), processingDeadline: deadline),
        ]

        func items(_ movies: [(TMDbID, String, String, TradeItemSource)], budget: Int = 0) -> TradeItems {
            TradeItems(movies: movies.map { tmdb, title, release, source in
                TradeMovieItem(movieID: .init("m-\(tmdb.rawValue)"), source: source, sourceID: "h-\(tmdb.rawValue)", title: title, releaseDate: DateOnly(release))
            }, budget: budget)
        }
        func ref(_ user: String) -> TradeOffer.TeamRef {
            TradeOffer.TeamRef(id: Self.team(user), name: people.first { $0.user == user }!.team)
        }
        let trades = [
            TradeOffer(
                id: "o-1", leagueID: leagueID, initiatorTeamID: Self.team("bob"), recipientTeamID: Self.team("alice"),
                initiatorItems: items([(1010, "Dune: Part Three", "2026-12-18", .draftPick)]),
                recipientItems: items([(1008, "Avengers: Doomsday", "2026-12-18", .pickup)], budget: 5),
                status: .proposed, proposedAt: now.addingTimeInterval(-5 * 3600), initiatorMessage: "Swapping December tentpoles?",
                expiresAt: now.addingTimeInterval(day + 4 * 3600), expiryAnchor: "fixed",
                initiatorTeam: ref("bob"), recipientTeam: ref("alice"), contestedSourceIDs: ["h-1010"]
            ),
            TradeOffer(
                id: "o-2", leagueID: leagueID, initiatorTeamID: Self.team("carol"), recipientTeamID: Self.team("dave"),
                initiatorItems: items([(1003, "Narnia: The Magician's Nephew", "2026-11-26", .pickup)]),
                recipientItems: items([], budget: 8),
                status: .review, proposedAt: now.addingTimeInterval(-day), reviewEndsAt: now.addingTimeInterval(18 * 3600),
                initiatorTeam: ref("carol"), recipientTeam: ref("dave")
            ),
            TradeOffer(
                id: "o-3", leagueID: leagueID, initiatorTeamID: Self.team("alice"), recipientTeamID: Self.team("carol"),
                initiatorItems: items([(1009, "Jumanji 3", "2026-12-11", .draftPick)]),
                recipientItems: items([(1011, "Wicked: For Good", "2026-09-21", .draftPick)]),
                status: .expired, proposedAt: now.addingTimeInterval(-9 * day), expiredReason: .offerWindow,
                initiatorTeam: ref("alice"), recipientTeam: ref("carol")
            ),
        ]

        let environment = AppEnvironment.preview(
            leagues: InMemoryLeagueRepository(seasons: [league], members: members),
            teams: InMemoryTeamRepository(
                teams: teams, holdings: holdings, counterpicks: counterpicks, standings: standings,
                dropCounts: [Self.team("alice"): 1]
            ),
            bids: InMemoryBidRepository(
                pickupBids: pickupBids,
                week: BidWeek(processingDeadline: deadline, cutoffAt: deadline.addingTimeInterval(-2 * day)),
                movies: [BiddableMovie(tmdbID: 1004, title: "Mortal Kombat II", releaseDate: DateOnly("2026-10-23"))],
                myTeamID: Self.team("alice")
            ),
            trades: InMemoryTradeRepository(trades: trades, myTeamID: Self.team("alice")),
            movies: InMemoryMovieRepository(projections: projected ? Self.projections : .disabled)
        )
        self.environment = environment
        directory = LeagueDirectoryStore(userID: Self.alice, repository: environment.leagues, defaults: UserDefaults(suiteName: "fr.screenshots") ?? .standard)
        season = LeagueSeasonStore(
            selection: LeagueSelection(userID: Self.alice, season: league, seriesSeasons: [league]),
            repository: environment.teams, bidRepository: environment.bids, tradeRepository: environment.trades,
            movieRepository: environment.movies
        )
        inbox = InboxStore(userID: Self.alice, repository: environment.notifications)
        wishlist = WishlistStore(userID: Self.alice, repository: environment.wishlists)
        research = LeagueResearchStore(leagues: environment.leagues, leagueMovies: environment.leagueMovies)
    }

    /// Projected scores (Beta) for the movies still to come: holdings, bids.
    private static var projections: MovieProjectionsResponse {
        let ranges: [(TMDbID, ClosedRange<Double>)] = [
            (1003, 73...81), (1004, 36...44), (1006, 37...45), (1008, 77...85), (1009, 52...70),
            (1010, 85...93), (1012, 60...68), (1013, 81...89), (1014, 76...84), (1015, 79...87),
        ]
        return ProjectionPreviewData.response(ranges.map { tmdbID, range in
            ProjectionPreviewData.projection(tmdbID, range50: range, lowConfidence: tmdbID == 1009)
        })
    }

    /// Selects the scene's tab and pushes its screen onto that tab's stack.
    func route(to scene: ScreenshotScene) {
        switch scene {
        case .leagueHome: router.select(.home)
        case .roster, .rosterProjected: router.select(.roster)
        case .standings: router.select(.standings)
        case .standingsProjected:
            router.select(.standings)
            season.showsProjectedStandings = true
        case .teamDetail:
            router.select(.standings)
            router.paths[.standings] = [.team(Self.team("bob"))]
        case .bids: router.select(.bids)
        case .bidPriorities:
            router.select(.bids)
            router.paths[.bids] = [.bidPriorities]
        case .trades: router.select(.trades)
        default: break
        }
    }

    func prepare() async {
        await directory.load()
        await season.load()
        router.seasonStore = season
        // Let the season's projection request answer before the capture.
        var waits = 0
        while season.projections.status == .unknown, waits < 20 {
            try? await Task.sleep(for: .milliseconds(50))
            waits += 1
        }
    }
}
#endif
