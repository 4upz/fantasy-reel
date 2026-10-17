import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// The bid sheet (F-12, mockup V2PlaceBid). Picks a movie first when opened
/// without one: a search before the new-bid cutoff, the contests already
/// running after it, or an opponent's movie for a counterpick. Then the amount,
/// an optional conditional drop and the fit forecast.
struct PlaceBidView: View {
    let target: BidTarget

    @Environment(LeagueSeasonStore.self) private var season
    @Environment(ShellRouter.self) private var router
    @State private var selected: BidSubject?
    /// The phase when the sheet opened: the movie list doesn't flip under the
    /// player's thumb if the cutoff passes while it's open.
    @State private var counterPhaseAtOpen: Bool?

    var body: some View {
        Group {
            if let selected {
                BidAmountForm(subject: selected, canGoBack: canGoBack) { self.selected = nil }
            } else {
                switch target {
                case .newPickup, .pickup:
                    PickupMoviePicker(counterPhase: counterPhaseAtOpen ?? false) { selected = .pickup($0) }
                case .newCounterpick, .counterpick:
                    CounterpickMoviePicker { selected = .counterpick($0) }
                }
            }
        }
        .background(Color.frSheetBackground)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Close", systemImage: "xmark") { router.dismissSheet() }
                    .accessibilityLabel("Close bid sheet")
            }
        }
        .onAppear {
            guard counterPhaseAtOpen == nil else { return }
            counterPhaseAtOpen = season.bids.snapshot?.week.isCounterBidPhase() ?? false
            selected = initialSubject
        }
    }

    private var canGoBack: Bool {
        switch target {
        case .newPickup, .newCounterpick: true
        case .pickup, .counterpick: false
        }
    }

    private var initialSubject: BidSubject? {
        let snapshot = season.bids.snapshot
        switch target {
        case .newPickup, .newCounterpick:
            return nil
        case .pickup(let tmdbID):
            guard let bid = snapshot?.pickupBids.first(where: { $0.tmdbID == tmdbID }) else { return nil }
            return .pickup(BiddableMovie(
                tmdbID: tmdbID, title: bid.title, overview: bid.movieData?.overview,
                releaseDate: bid.releaseDate, posterURL: bid.posterURL
            ))
        case .counterpick(let movieID):
            guard let bid = snapshot?.counterpickBids.first(where: { $0.movieID == movieID }) else { return nil }
            return .counterpick(CounterpickOption(
                movieID: movieID, title: bid.title, posterURL: bid.movie?.posterURL, releaseDate: bid.releaseDate,
                ownerTeamID: bid.targetTeamID,
                ownerTeamName: bid.targetTeamName ?? season.team(bid.targetTeamID)?.team.name ?? "Unknown team",
                fantasyPoints: bid.movie?.fantasyPoints
            ))
        }
    }
}

/// The movie a bid is for.
enum BidSubject: Hashable {
    case pickup(BiddableMovie)
    case counterpick(CounterpickOption)

    var title: String {
        switch self {
        case .pickup(let movie): movie.title
        case .counterpick(let option): option.title
        }
    }

    var releaseDate: DateOnly? {
        switch self {
        case .pickup(let movie): movie.releaseDate
        case .counterpick(let option): option.releaseDate
        }
    }

    var posterURL: String? {
        switch self {
        case .pickup(let movie): movie.posterURL
        case .counterpick(let option): option.posterURL
        }
    }
}

// MARK: - Step 1: pickup movie

private struct PickupMoviePicker: View {
    let counterPhase: Bool
    let onSelect: (BiddableMovie) -> Void

    @Environment(LeagueSeasonStore.self) private var season
    @State private var query = ""
    @State private var results: LoadState<[BiddableMovie]> = .idle
    @State private var page = 1
    @State private var hasMore = false
    @State private var isLoadingMore = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                if counterPhase {
                    contests
                } else {
                    search
                }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .navigationTitle(counterPhase ? "Counter a Bid" : "Place a Bid")
        .modifier(SearchableIf(enabled: !counterPhase, query: $query))
        .task(id: query) {
            guard !counterPhase else { return }
            if !query.isEmpty { try? await Task.sleep(for: .milliseconds(300)) }
            guard !Task.isCancelled else { return }
            await load(reset: true)
        }
    }

    // Before the cutoff: search or the season's browse list.

    @ViewBuilder
    private var search: some View {
        LoadStateView(
            results,
            loadingLabel: "Searching movies…",
            retry: { Task { await load(reset: true) } },
            content: { movies in
                let scored = season.bids.snapshot?.scoredTMDbIDs ?? []
                let biddable = movies.filter { !scored.contains($0.tmdbID) }.count
                Text("\(biddable) available \(biddable == 1 ? "movie" : "movies") loaded")
                    .frFont(.caption)
                    .foregroundStyle(Color.frTextSecondary)
                    .padding(.horizontal, 4)
                FRRowGroup {
                    ForEach(movies) { movie in
                        movieRow(movie, isScored: scored.contains(movie.tmdbID))
                    }
                }
                if hasMore {
                    Button(isLoadingMore ? "Loading more movies…" : "Load more movies") {
                        Task { await load(reset: false) }
                    }
                    .buttonStyle(.fr(.secondary, size: .medium, fullWidth: true))
                    .disabled(isLoadingMore)
                }
                TMDbAttribution()
            },
            empty: {
                EmptyStateView(
                    title: query.isEmpty ? "Search for a movie" : "No movies found",
                    message: query.isEmpty ? "Type a movie title to get started" : "Try a different search term",
                    systemImage: "magnifyingglass"
                )
            }
        )
    }

    private func movieRow(_ movie: BiddableMovie, isScored: Bool) -> some View {
        let high = season.bids.highPickupBid(on: movie.tmdbID)
        let mine = high?.teamID == season.myTeam?.id
        var meta = movie.releaseDate.map { String($0.year) } ?? "Release date TBA"
        if isScored {
            meta += " · Already scored, can't be bid on"
        } else if let high {
            meta += mine ? " · Your bid \(SeasonFormat.budget(high.amount))" : " · High bid \(SeasonFormat.budget(high.amount))"
        }
        return Button { onSelect(movie) } label: {
            MovieRow(title: movie.title, meta: meta, posterURL: movie.posterURL, showsChevron: !isScored)
        }
        .buttonStyle(.frRow)
        .disabled(isScored)
    }

    private func load(reset: Bool) async {
        let nextPage = reset ? 1 : page + 1
        if reset { results = .loading } else { isLoadingMore = true }
        defer { isLoadingMore = false }
        do {
            let response = try await season.bids.repository.searchMovies(query: query, page: nextPage, seasonYear: season.season.seasonYear)
            let owned = Set(season.snapshot?.holdings.map(\.tmdbID) ?? [])
            let fresh = response.movies.filter { !owned.contains($0.tmdbID) && BidEligibility.isBiddable(releaseDate: $0.releaseDate) }
            let existing = reset ? [] : (results.value ?? [])
            let combined = existing + fresh.filter { movie in !existing.contains { $0.tmdbID == movie.tmdbID } }
            page = response.page
            hasMore = response.hasMore
            results = combined.isEmpty && !hasMore ? .empty : .loaded(combined)
        } catch {
            if !reset, results.value != nil { return }
            results = .failed(message: error.userMessage)
        }
    }

    // After the cutoff: the contests already running.

    @ViewBuilder
    private var contests: some View {
        let movies = contestMovies
        InlineBanner(
            tone: .warning,
            title: "New bids closed" + (season.bids.snapshot?.week.cutoffAt.map { " \(BidTiming.shortDeadline($0))" } ?? ""),
            message: "Raise your bid or counter another team's on the movies below. Movies nobody has bid on reopen once this week's bids are processed."
        )
        if movies.isEmpty {
            EmptyStateView(
                title: "No bids in play",
                message: "Nobody placed a bid before the deadline. Bidding reopens once this week's bids are processed.",
                systemImage: "tag"
            )
        } else {
            SectionHeader("\(movies.count) \(movies.count == 1 ? "movie" : "movies") still being bid on")
            FRRowGroup {
                ForEach(movies, id: \.movie.tmdbID) { item in
                    Button { onSelect(item.movie) } label: {
                        MovieRow(
                            title: item.movie.title,
                            meta: item.movie.releaseDate?.formattedShort ?? "Release date TBA",
                            posterURL: item.movie.posterURL,
                            showsChevron: true
                        ) {
                            TrailingValue(SeasonFormat.budget(item.high), caption: "high bid")
                        }
                    }
                    .buttonStyle(.frRow)
                }
            }
            TMDbAttribution()
        }
    }

    private var contestMovies: [(movie: BiddableMovie, high: Int)] {
        guard let snapshot = season.bids.snapshot else { return [] }
        let owned = Set(season.snapshot?.holdings.map(\.tmdbID) ?? [])
        var seen = Set<TMDbID>()
        var items: [(movie: BiddableMovie, high: Int)] = []
        for bid in snapshot.pickupBids where !seen.contains(bid.tmdbID) {
            seen.insert(bid.tmdbID)
            guard !owned.contains(bid.tmdbID), !snapshot.scoredTMDbIDs.contains(bid.tmdbID),
                  BidEligibility.isBiddable(releaseDate: bid.releaseDate) else { continue }
            let high = season.bids.highPickupBid(on: bid.tmdbID)?.amount ?? 0
            items.append((BiddableMovie(tmdbID: bid.tmdbID, title: bid.title, overview: bid.movieData?.overview, releaseDate: bid.releaseDate, posterURL: bid.posterURL), high))
        }
        return items.sorted { $0.high > $1.high }
    }
}

private struct SearchableIf: ViewModifier {
    let enabled: Bool
    @Binding var query: String

    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled {
            content.searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search for a movie")
        } else {
            content
        }
    }
}

// MARK: - Step 1: counterpick movie

private struct CounterpickMoviePicker: View {
    let onSelect: (CounterpickOption) -> Void

    @Environment(LeagueSeasonStore.self) private var season
    @State private var options: LoadState<[CounterpickOption]> = .idle

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                Text("Bet against an opponent's movie. If it scores below 60, you earn points equal to their loss. If it scores above 60, you lose points equal to their gain.")
                    .frFont(.bodySmall)
                    .foregroundStyle(Color.frTextSecondary)
                LoadStateView(
                    options,
                    loadingLabel: "Loading opponent movies…",
                    retry: { Task { await load() } },
                    content: { list in
                        ForEach(groups(list), id: \.teamID) { group in
                            SectionHeader(group.teamName, detail: String(group.options.count))
                            FRRowGroup {
                                ForEach(group.options) { option in
                                    Button { onSelect(option) } label: {
                                        MovieRow(
                                            title: option.title,
                                            meta: meta(option),
                                            posterURL: option.posterURL,
                                            points: option.fantasyPoints,
                                            preRelease: FantasyPoints.isPreReleaseScore(points: option.fantasyPoints, releaseDate: option.releaseDate),
                                            showsChevron: !option.isScoreLocked
                                        )
                                    }
                                    .buttonStyle(.frRow)
                                    .disabled(option.isScoreLocked)
                                }
                            }
                        }
                        TMDbAttribution()
                    },
                    empty: {
                        EmptyStateView(
                            title: "No movies available to counterpick",
                            message: "Opponent movies drop off this list once they're released or already targeted. Nothing is left to counterpick right now.",
                            systemImage: "scope"
                        )
                    }
                )
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .navigationTitle("Counterpick Bid")
        .task { await load() }
    }

    private func meta(_ option: CounterpickOption) -> String {
        let date = DateOnly.display(option.releaseDate, style: .short)
        if option.isScoreLocked { return "\(date) · Already scored" }
        if let high = season.bids.highCounterpickBid(on: option.movieID) {
            return "\(date) · High bid \(SeasonFormat.budget(high.amount))"
        }
        return date
    }

    private func groups(_ list: [CounterpickOption]) -> [(teamID: TeamID, teamName: String, options: [CounterpickOption])] {
        var order: [TeamID] = []
        var byTeam: [TeamID: [CounterpickOption]] = [:]
        for option in list {
            if byTeam[option.ownerTeamID] == nil { order.append(option.ownerTeamID) }
            byTeam[option.ownerTeamID, default: []].append(option)
        }
        return order
            .map { (teamID: $0, teamName: byTeam[$0]?.first?.ownerTeamName ?? "Unknown team", options: byTeam[$0] ?? []) }
            .sorted { $0.teamName.localizedCompare($1.teamName) == .orderedAscending }
    }

    private func load() async {
        guard let teamID = season.myTeam?.id else {
            options = .empty
            return
        }
        if options.value == nil { options = .loading }
        do {
            let list = try await season.bids.repository.fetchCounterpickOptions(in: season.season.id, for: teamID)
            options = list.isEmpty ? .empty : .loaded(list)
        } catch {
            options = .failed(message: error.userMessage)
        }
    }
}
