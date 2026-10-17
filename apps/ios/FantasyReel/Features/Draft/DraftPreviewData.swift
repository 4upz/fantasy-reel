#if DEBUG
import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// Draft rooms seeded for previews and PR screenshots, following the v2
/// mockups (V2DraftSetup, V2Draft, V2MoviePicker, V2Counterpick, V2DraftOffline).
@MainActor
enum DraftPreviewData {
    static let alice: UserID = "00000000-0000-4000-8000-00000000a11c"
    private static let names: [(team: String, owner: String)] = [
        ("Nolan's Notebook", "Bob Nolan"),
        ("Coppola Cut", "Carol Coppola"),
        ("Reel Deal", "Alice Spielberg"),
        ("Kubrick's Cube", "Dave Kubrick"),
        ("Final Cut Pros", "Eve Lumet"),
        ("Box Office Poison", "Frank Wilder"),
    ]

    static func league(
        _ name: String,
        year: Int,
        status: LeagueStatus,
        draftSlots: Int = 5,
        counterpickSlots: Int = 1,
        customOrder: Bool = true
    ) -> League {
        League(
            id: "00000000-0000-4000-8000-0000000000d1",
            name: name,
            ownerID: alice,
            status: status,
            draftSlots: draftSlots,
            draftCounterpickSlots: counterpickSlots,
            customDraftOrder: customOrder,
            joinCode: "K7Q2MX",
            seriesID: "00000000-0000-4000-8000-0000000000e1",
            seasonYear: year,
            seasonEnd: DateOnly(year: year, month: 12, day: 31)!,
            createdAt: Date(timeIntervalSince1970: 1_790_000_000),
            updatedAt: Date(timeIntervalSince1970: 1_790_000_000)
        )
    }

    /// `count` members in draft order, with Alice (the signed-in owner) at
    /// position `alicePosition`.
    static func members(_ count: Int, alicePosition: Int, leagueID: LeagueID) -> [LeagueMember] {
        var others = names.filter { $0.owner != "Alice Spielberg" }.prefix(count - 1).makeIterator()
        return (1...count).map { position in
            let isAlice = position == alicePosition
            let entry = isAlice ? names[2] : others.next()!
            let userID: UserID = isAlice ? alice : UserID(rawValue: "00000000-0000-4000-8000-00000000000\(position)")
            let participantID = ParticipantID(rawValue: "00000000-0000-4000-8000-0000000001\(position)0")
            return LeagueMember(
                participant: LeagueParticipant(id: participantID, leagueID: leagueID, userID: userID, draftOrder: position),
                team: Team(id: teamID(position), participantID: participantID, name: entry.team),
                profile: Profile(id: userID.rawValue, userID: userID, displayName: entry.owner)
            )
        }
    }

    static func teamID(_ position: Int) -> TeamID {
        TeamID(rawValue: "00000000-0000-4000-8000-0000000002\(position)0")
    }

    static let titles: [(String, String)] = [
        ("Avengers: Secret Wars", "2027-12-17"),
        ("Spider-Man: Beyond the Spider-Verse", "2027-06-18"),
        ("The Batman Part II", "2027-10-01"),
        ("Shrek 5", "2027-06-30"),
        ("Frozen III", "2027-11-24"),
        ("The Legend of Zelda", "2027-05-07"),
        ("Minecraft 2", "2027-07-23"),
        ("Man of Tomorrow", "2027-07-09"),
        ("Star Wars: Starfighter", "2027-05-28"),
        ("Godzilla x Kong: Supernova", "2027-03-26"),
        ("Minions 3", "2027-07-01"),
        ("Toy Story 5", "2027-06-19"),
        ("The Mandalorian & Grogu", "2027-05-22"),
        ("Ice Age: Boiling Point", "2027-02-05"),
    ]

    private static let genres: [Int: [Int]] = [
        4: [16], 5: [12], 8: [878], 9: [28], 10: [16], 11: [16],
    ]

    static func movie(_ index: Int) -> Movie {
        Movie(
            id: MovieID(rawValue: "00000000-0000-4000-8000-0000000003\(String(format: "%02d", index))"),
            tmdbID: TMDbID(rawValue: 1000 + index),
            title: titles[index].0,
            releaseDate: DateOnly(titles[index].1)
        )
    }

    /// The first snake picks of `snapshot`'s board, one per title index.
    static func picks(_ titleIndexes: [Int], in snapshot: DraftSnapshot) -> [DraftPickRecord] {
        titleIndexes.enumerated().compactMap { index, titleIndex in
            guard let turn = snapshot.draftTurn(at: index), let teamID = turn.participant.team?.id else { return nil }
            let movie = movie(titleIndex)
            return DraftPickRecord(
                id: HoldingID(rawValue: "00000000-0000-4000-8000-0000000004\(String(format: "%02d", index))"),
                leagueID: snapshot.league.id,
                teamID: teamID,
                movieID: movie.id,
                round: turn.round,
                pickNumber: turn.pickNumber,
                movie: movie
            )
        }
    }

    /// The picker's catalog: what's still undrafted in the live room.
    static var catalog: [CatalogMovie] {
        [5, 8, 4, 9, 10, 11].map { index in
            let movie = movie(index)
            return CatalogMovie(tmdbID: movie.tmdbID, title: movie.title, releaseDate: movie.releaseDate, genreIDs: genres[index] ?? [])
        }
    }

    // MARK: Rooms

    struct Room {
        let environment: AppEnvironment
        let selection: LeagueSelection
    }

    static func setupRoom() -> Room {
        let league = league("Saturday Matinee Society", year: 2027, status: .setup)
        let members = members(4, alicePosition: 3, leagueID: league.id)
        return room(league, members: members)
    }

    static func liveRoom() -> Room {
        let league = league("Office Movie Club", year: 2027, status: .drafting)
        let members = members(6, alicePosition: 4, leagueID: league.id)
        let board = DraftSnapshot(league: league, participants: members, picks: [], counterpicks: [])
        return room(league, members: members, picks: picks([0, 1, 2, 3, 12, 13, 6, 7], in: board))
    }

    static func counterpickRoom() -> Room {
        let league = league("Popcorn Syndicate", year: 2026, status: .counterpicking, draftSlots: 2, counterpickSlots: 2)
        let members = members(4, alicePosition: 3, leagueID: league.id)
        let board = DraftSnapshot(league: league, participants: members, picks: [], counterpicks: [])
        let picks = picks(Array(0..<8), in: board)
        let turns = [board.currentCounterpickTurn].compactMap { $0 } + board.upcomingCounterpickTurns(limit: 5)
        var counterpicks: [DraftCounterpick] = []
        for (index, turn) in turns.enumerated() {
            guard let teamID = turn.participant.team?.id,
                  let target = picks.first(where: { pick in
                      pick.teamID != teamID && !counterpicks.contains { $0.movieID == pick.movieID }
                  })
            else { continue }
            counterpicks.append(DraftCounterpick(
                id: CounterpickID(rawValue: "00000000-0000-4000-8000-0000000005\(index)0"),
                leagueID: league.id,
                counterpickerTeamID: teamID,
                targetTeamID: target.teamID,
                movieID: target.movieID,
                pickOrder: index + 1,
                movie: target.movie
            ))
        }
        let taken = Set(counterpicks.map(\.movieID))
        let options = picks
            .filter { $0.teamID != teamID(3) && !taken.contains($0.movieID) }
            .map { pick in
                CounterpickOption(
                    movieID: pick.movieID,
                    title: pick.movie?.title ?? "",
                    releaseDate: pick.movie?.releaseDate,
                    ownerTeamID: pick.teamID,
                    ownerTeamName: board.teamName(pick.teamID),
                    draftPickID: pick.id
                )
            }
        return room(league, members: members, picks: picks, counterpicks: counterpicks, options: options)
    }

    private static func room(
        _ league: League,
        members: [LeagueMember],
        picks: [DraftPickRecord] = [],
        counterpicks: [DraftCounterpick] = [],
        options: [CounterpickOption] = []
    ) -> Room {
        let environment = AppEnvironment.preview(
            leagues: InMemoryLeagueRepository(seasons: [league], members: members),
            draft: InMemoryDraftRepository(picks: picks, counterpicks: counterpicks, options: options),
            draftCatalog: InMemoryDraftMovieCatalog(movies: catalog)
        )
        return Room(environment: environment, selection: LeagueSelection(userID: alice, season: league, seriesSeasons: [league]))
    }
}

/// A draft room screen inside the league tab bar and top bar, as the app shows it.
struct DraftPreviewScreen: View {
    enum Variant {
        case setup, live, picker, counterpick, offline
    }

    let variant: Variant

    @State private var room: DraftPreviewData.Room
    @State private var router = ShellRouter()
    @State private var inbox: InboxStore
    @State private var model: DraftRoomModel?
    @State private var tab = 1

    init(_ variant: Variant) {
        self.variant = variant
        let room: DraftPreviewData.Room = switch variant {
        case .setup: DraftPreviewData.setupRoom()
        case .live, .picker, .offline: DraftPreviewData.liveRoom()
        case .counterpick: DraftPreviewData.counterpickRoom()
        }
        _room = State(initialValue: room)
        _inbox = State(initialValue: InboxStore(userID: DraftPreviewData.alice, repository: InMemoryNotificationRepository()))
    }

    var body: some View {
        Group {
            if let model {
                if variant == .picker {
                    DraftMoviePickerSheet(room: model)
                } else {
                    TabView(selection: $tab) {
                        Tab(LeagueTab.home.title, systemImage: LeagueTab.home.systemImage, value: 0) { Color.frBackground }
                        Tab(LeagueTab.draft.title, systemImage: LeagueTab.draft.systemImage, value: 1) {
                            NavigationStack {
                                DraftRoomContent(model: model)
                                    .background(Color.frBackground)
                                    .leagueTopBar()
                            }
                        }
                        Tab(LeagueTab.roster.title, systemImage: LeagueTab.roster.systemImage, value: 2) { Color.frBackground }
                    }
                }
            } else {
                Color.frBackground
            }
        }
        .environment(room.environment)
        .environment(router)
        .environment(inbox)
        .environment(\.leagueSelection, room.selection)
        .task {
            let model = DraftRoomModel(selection: room.selection, environment: room.environment, usesChangeFeed: false)
            await model.refresh()
            if variant == .offline { await simulateLostConnection(model) }
            self.model = model
        }
    }

    /// V2DraftOffline: a pick whose response was lost, then the connection drops.
    private func simulateLostConnection(_ model: DraftRoomModel) async {
        guard let draft = room.environment.draft as? InMemoryDraftRepository else { return }
        await draft.setFailure(.timedOut(requestID: "preview"))
        let zelda = DraftPreviewData.movie(5)
        await model.submit(.movie(zelda.tmdbID), title: zelda.title)
        await draft.setFailure(.network(code: .notConnectedToInternet, requestID: "preview"))
        await model.refresh()
    }
}

#Preview("Setup") { DraftPreviewScreen(.setup) }
#Preview("Live") { DraftPreviewScreen(.live) }
#Preview("Picker") { DraftPreviewScreen(.picker) }
#Preview("Counterpick") { DraftPreviewScreen(.counterpick) }
#Preview("Offline") { DraftPreviewScreen(.offline) }
#endif
