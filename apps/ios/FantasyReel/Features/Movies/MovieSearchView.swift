import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// Movie search (F-06): the search tab inside a league, or a pushed screen
/// from the no-league home. Results carry each movie's status in the selected
/// season ("Drafted by …") and a wishlist bookmark; a row opens the movie.
struct MovieSearchView: View {
    /// The league shell's search tab root, which carries the league top bar.
    var isSearchTabRoot = false
    /// Starts with this search (screenshots).
    var initialQuery = ""

    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        MovieSearchScreen(movies: environment.movies, isSearchTabRoot: isSearchTabRoot, initialQuery: initialQuery)
    }
}

private struct MovieSearchScreen: View {
    let isSearchTabRoot: Bool

    @State private var model: MovieSearchModel
    @Environment(\.leagueSelection) private var selection
    @Environment(WishlistStore.self) private var wishlist
    @Environment(MovieSearchHistory.self) private var history
    @Environment(LeagueResearchStore.self) private var research

    init(movies: any MovieRepository, isSearchTabRoot: Bool, initialQuery: String) {
        self.isSearchTabRoot = isSearchTabRoot
        let model = MovieSearchModel(movies: movies)
        model.filter.query = initialQuery
        _model = State(initialValue: model)
    }

    var body: some View {
        @Bindable var model = model
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                if isSearchTabRoot {
                    ScreenHeader("Movies", eyebrow: selection?.season.name)
                }
                YearFilterMenu(year: $model.filter.year)
                WishlistFailureBanner()
                content
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
            .animation(.default, value: wishlist.failure)
        }
        .scrollDismissesKeyboard(.immediately)
        .background(Color.frBackground)
        .modifier(SearchChrome(isSearchTabRoot: isSearchTabRoot && selection != nil, query: $model.filter.query))
        .onSubmit(of: .search) {
            history.record(model.filter.query)
            Task { await model.submit() }
        }
        .task(id: model.filter) { await model.run() }
        .task(id: selection?.season.id) {
            if let selection { await research.load(selection) }
        }
        .refreshable {
            if let selection { await research.load(selection, force: true) }
            if model.normalizedQuery != nil { await model.submit() } else { await wishlist.load() }
        }
    }

    private var holdings: LeagueHoldingsIndex { research.holdings(in: selection?.season.id) }

    private func status(of tmdbID: TMDbID) -> LeagueMovieStatus? {
        selection == nil ? nil : holdings.status(of: tmdbID)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .idle:
            SearchIdleContent { query in
                model.filter.query = query
                history.record(query)
            }
        case .searching:
            ProgressView("Searching…")
                .frame(maxWidth: .infinity)
                .padding(.top, 48)
        case .noResults:
            EmptyStateView(
                title: "No movies found",
                message: noResultsMessage,
                systemImage: "magnifyingglass"
            )
            .padding(.top, 24)
        case .failed(let message):
            ErrorStateView(title: "Search didn't finish", message: message, layout: .card) {
                Task { await model.submit() }
            }
        case .results:
            results
        }
    }

    private var noResultsMessage: String {
        let query = model.shownQuery.map { "“\($0)”" } ?? "that search"
        if let year = model.filter.year {
            return "Nothing matches \(query) in \(String(year)). Try another year or check the spelling."
        }
        return "Nothing matches \(query). Check the spelling or try a shorter title."
    }

    private var results: some View {
        VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
            SectionHeader("Results", detail: resultCount)
            LazyRowGroup(items: model.results) { movie in
                ResearchMovieRow(
                    title: movie.title,
                    posterURL: movie.posterURL,
                    detail: MovieMetaText.release(movie.releaseDate),
                    status: status(of: movie.tmdbID),
                    candidate: WishlistCandidate(movie)
                )
                .simultaneousGesture(TapGesture().onEnded { history.record(model.filter.query) })
                .onAppear {
                    if movie.id == model.results.last?.id { Task { await model.loadMore() } }
                }
            }
            loadMoreFooter
            TMDbAttribution()
        }
    }

    private var resultCount: String {
        let shown = model.results.count
        return model.hasMore ? "\(shown) of \(max(shown, model.totalResults))" : "\(shown)"
    }

    @ViewBuilder
    private var loadMoreFooter: some View {
        if model.isLoadingMore {
            ProgressView("Loading more…")
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
        } else if let error = model.loadMoreError {
            InlineBanner(tone: .error, title: "Couldn't load more", message: error, actionTitle: "Retry") {
                Task { await model.loadMore() }
            }
        } else if model.hasMore {
            Button("Load More") {
                Task { await model.loadMore() }
            }
            .buttonStyle(.fr(.neutral, size: .medium))
        }
    }
}

/// The search field and navigation chrome: the league top bar on the search
/// tab, a plain titled bar when pushed from the no-league home.
private struct SearchChrome: ViewModifier {
    let isSearchTabRoot: Bool
    @Binding var query: String

    func body(content: Content) -> some View {
        if isSearchTabRoot {
            content
                .leagueTopBar()
                .searchable(text: $query, prompt: "Search movies")
        } else {
            content
                .navigationTitle("Movies")
                .navigationBarTitleDisplayMode(.large)
                .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search movies")
        }
    }
}

/// The year filter: any year (default) or one release year, as on the web.
private struct YearFilterMenu: View {
    @Binding var year: Int?

    var body: some View {
        Menu {
            Picker("Release year", selection: $year) {
                Text("Any year").tag(Int?.none)
                ForEach(MovieSearchQuery.yearOptions(), id: \.self) { option in
                    Text(verbatim: String(option)).tag(Int?.some(option))
                }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "calendar")
                    .accessibilityHidden(true)
                Text(year.map { String($0) } ?? "Any year")
                Image(systemName: "chevron.down")
                    .font(.caption.weight(.semibold))
                    .accessibilityHidden(true)
            }
            .frFont(.label)
            .foregroundStyle(year == nil ? Color.frText : Color.frGold)
            .padding(.horizontal, 14)
            .frame(minHeight: 36)
            .background(year == nil ? Color.frSurface : Color.frGoldTint, in: Capsule())
            .frame(minHeight: FRMetrics.minTapTarget)
            .contentShape(Rectangle())
        }
        .accessibilityLabel("Release year")
        .accessibilityValue(year.map { String($0) } ?? "Any year")
    }
}

/// Before a search: recent searches and the person's wishlist.
private struct SearchIdleContent: View {
    let searchAgain: (String) -> Void

    @Environment(MovieSearchHistory.self) private var history
    @Environment(WishlistStore.self) private var wishlist
    @Environment(ShellRouter.self) private var router

    var body: some View {
        VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
            if !history.queries.isEmpty {
                SectionHeader("Recent searches", actionTitle: "Clear") { history.clear() }
                RecentSearchChips(searchAgain: searchAgain)
            }
            if !wishlist.movies.isEmpty {
                SectionHeader("Your wishlist", actionTitle: "See all") { router.presentMenu(.wishlist) }
                WishlistCarousel(movies: Array(wishlist.movies.prefix(12)))
                TMDbAttribution()
            } else if history.queries.isEmpty {
                EmptyStateView(
                    title: "Find a movie",
                    message: "Search by title to see its release date, franchise track record and who has it in your league. Bookmark movies to keep them on your wishlist.",
                    systemImage: "film.stack"
                )
                .padding(.top, 24)
            }
        }
        .task {
            if case .idle = wishlist.state { await wishlist.load() }
        }
    }
}

private struct RecentSearchChips: View {
    let searchAgain: (String) -> Void

    @Environment(MovieSearchHistory.self) private var history

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(history.queries, id: \.self) { query in
                    RecentChip(query: query) { searchAgain(query) }
                }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
        }
        .scrollIndicators(.hidden)
        .padding(.horizontal, -FRMetrics.pageMargin)
    }
}

private struct RecentChip: View {
    let query: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(query, systemImage: "clock")
                .frFont(.label)
                .foregroundStyle(Color.frText)
                .lineLimit(1)
                .padding(.horizontal, 14)
                .frame(minHeight: 36)
                .background(Color.frSurface, in: Capsule())
                .frame(minHeight: FRMetrics.minTapTarget)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Search again for \(query)")
    }
}

/// A row of poster cards (title and release under each, bookmark on top).
struct WishlistCarousel: View {
    let movies: [WishlistedMovie]

    var body: some View {
        ScrollView(.horizontal) {
            LazyHStack(alignment: .top, spacing: 12) {
                ForEach(movies) { movie in
                    PosterCard(title: movie.title, posterURL: movie.posterURL, candidate: WishlistCandidate(movie))
                }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
        }
        .scrollIndicators(.hidden)
        .padding(.horizontal, -FRMetrics.pageMargin)
    }
}

struct PosterCard: View {
    static let size = CGSize(width: 110, height: 165)

    let title: String
    let posterURL: String?
    var subtitle: String?
    let candidate: WishlistCandidate

    var body: some View {
        LeagueLink(route: .movie(candidate.tmdbID)) {
            VStack(alignment: .leading, spacing: 6) {
                PosterImage(posterURL: posterURL, title: title, size: Self.size, cornerRadius: 14)
                Text(title)
                    .frFont(.label)
                    .foregroundStyle(Color.frText)
                    .lineLimit(2, reservesSpace: true)
                if let subtitle {
                    Text(subtitle)
                        .frFont(.meta)
                        .foregroundStyle(Color.frTextSecondary)
                        .lineLimit(1)
                }
            }
            .frame(width: Self.size.width, alignment: .leading)
            .contentShape(Rectangle())
            .accessibilityElement(children: .combine)
        }
        .buttonStyle(.plain)
        .overlay(alignment: .topTrailing) {
            WishlistToggleButton(candidate: candidate, style: .overlay)
        }
    }
}
