import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// The draft's movie picker (V2MoviePicker), presented as a large sheet over
/// the draft room. Anyone can browse; Pick is live only on your own turn and
/// always asks to confirm.
struct DraftMoviePickerSheet: View {
    let room: DraftRoomModel

    var body: some View {
        NavigationStack {
            DraftMoviePickerView(room: room)
                .navigationDestination(for: LeagueRoute.self) { route in
                    LeagueDestinationView(route: route)
                }
        }
        .environment(\.leagueSelection, room.selection)
        .presentationDetents([.large])
    }
}

struct DraftMoviePickerView: View {
    let room: DraftRoomModel

    @Environment(AppEnvironment.self) private var environment
    @Environment(ShellRouter.self) private var router
    @Environment(WishlistStore.self) private var wishlist
    @State private var model: DraftMoviePickerModel?
    @State private var pendingPick: MovieSearchResult?

    var body: some View {
        Group {
            if let model {
                content(model)
            } else {
                LoadingView(label: "Loading movies…")
            }
        }
        .background(Color.frSheetBackground)
        .navigationTitle("Choose a Movie")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Close", systemImage: "xmark", role: .close) { router.dismissSheet() }
            }
            if let model, model.filtersApply {
                ToolbarItem(placement: .primaryAction) {
                    DraftCatalogFilterMenu(model: model, seasonYear: room.selection.season.seasonYear)
                }
            }
        }
        .task {
            guard model == nil else { return }
            model = DraftMoviePickerModel(
                movies: environment.movies,
                wishlist: wishlist,
                seasonYear: room.snapshot?.league.seasonYear ?? room.selection.season.seasonYear
            )
        }
        .confirmationDialog(
            pendingPick.map { "Draft \($0.title)?" } ?? "",
            isPresented: Binding(get: { pendingPick != nil }, set: { if !$0 { pendingPick = nil } }),
            titleVisibility: .visible,
            presenting: pendingPick
        ) { movie in
            Button("Pick") {
                Task {
                    if await room.submit(.movie(movie.tmdbID), title: movie.title) {
                        router.dismissSheet()
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: { movie in
            Text(confirmationMessage(movie))
        }
    }

    @ViewBuilder
    private func content(_ picker: DraftMoviePickerModel) -> some View {
        @Bindable var bindable = picker
        ScrollView {
            LazyVStack(spacing: FRMetrics.sectionSpacing) {
                turnLine
                DraftSubmissionNotice(model: room)
                FRSegmentedControl("Movie lists", selection: $bindable.tab, options: CatalogTab.allCases, title: { $0.title })
                results(
                    picker,
                    drafted: room.snapshot?.draftedTMDbIDs ?? [],
                    drafters: room.snapshot?.draftersByTMDbID ?? [:]
                )
                TMDbAttribution()
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .searchable(text: $bindable.query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search movies")
        // One reload per settled change; typing waits 300 ms like the web.
        .task(id: ReloadKey(picker)) { [picker] in
            if !picker.trimmedQuery.isEmpty {
                do { try await Task.sleep(for: MovieSearchModel.debounce) } catch { return }
            }
            await picker.reload(excluding: room.snapshot?.draftedTMDbIDs ?? [])
        }
    }

    @ViewBuilder
    private var turnLine: some View {
        if let turn = room.snapshot?.currentDraftTurn {
            let text = turn.isMine(room.userID)
                ? "Round \(turn.round) · Pick \(turn.overallPick) of \(room.snapshot?.totalDraftPicks ?? 0)"
                : "\(turn.participant.teamName) is on the clock. Research now; you can pick on your turn."
            Text(text)
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// `drafted` excludes every picked movie; `drafters` only names who
    /// picked it, and skips teams with no active member.
    @ViewBuilder
    private func results(_ model: DraftMoviePickerModel, drafted: Set<TMDbID>, drafters: [TMDbID: LeagueMember]) -> some View {
        switch model.phase {
        case .loading:
            LoadingView(label: "Loading movies…")
                .frame(minHeight: 200)
        case .failed(let message):
            ErrorStateView(title: "Couldn't load movies", message: message, layout: .card) {
                Task { await model.reload(excluding: drafted) }
            }
        case .loaded where model.movies.isEmpty:
            EmptyStateView(
                title: model.tab == .wishlist && model.trimmedQuery.isEmpty ? "Your wishlist is empty" : "No movies found",
                message: emptyMessage(model),
                systemImage: model.tab == .wishlist ? "heart" : "film"
            )
        case .loaded:
            let available = model.movies.filter { !drafted.contains($0.tmdbID) }.count
            Text(available == 1 ? "1 available movie loaded" : "\(available) available movies loaded")
                .frFont(.label)
                .foregroundStyle(Color.frTextSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            LazyVStack(spacing: 0) {
                ForEach(model.movies) { movie in
                    row(movie, isDrafted: drafted.contains(movie.tmdbID), drafter: drafters[movie.tmdbID])
                        .overlay(alignment: .top) {
                            if movie.id != model.movies.first?.id {
                                Divider().padding(.leading, FRMetrics.separatorInset)
                            }
                        }
                        .onAppear {
                            if movie.id == model.movies.last?.id {
                                Task { await model.loadMore(excluding: drafted) }
                            }
                        }
                }
            }
            .background(Color.frSurface)
            .clipShape(RoundedRectangle(cornerRadius: FRMetrics.cardRadius, style: .continuous))
            if model.isLoadingMore {
                ProgressView().padding()
            } else if let message = model.loadMoreError {
                InlineBanner(tone: .warning, title: "Couldn't load more", message: message, actionTitle: "Try Again") {
                    Task { await model.loadMore(excluding: drafted) }
                }
            } else if model.hasMore {
                Button("Load More") { Task { await model.loadMore(excluding: drafted) } }
                    .buttonStyle(.fr(.neutral, size: .medium))
            }
        }
    }

    /// The link and Pick are siblings, so a tap on Pick never pushes the
    /// detail and VoiceOver reaches each one.
    private func row(_ movie: MovieSearchResult, isDrafted: Bool, drafter: LeagueMember?) -> some View {
        let date = movie.releaseDate?.formatted(.medium)
        let draftedBy = isDrafted
            ? drafter.map { "Drafted by \($0.userID == room.userID ? "you" : $0.firstName)" } ?? "Drafted"
            : nil
        let meta = [draftedBy, date, isDrafted ? nil : MovieGenre.primaryName(of: movie.genreIDs)]
            .compactMap { $0 }
            .joined(separator: " · ")
        return HStack(spacing: 0) {
            NavigationLink(value: LeagueRoute.movie(movie.tmdbID)) {
                MovieRow(title: movie.title, meta: meta, posterURL: movie.posterURL)
            }
            .buttonStyle(.frRow)
            .accessibilityHint("Shows movie details")
            if !isDrafted {
                Button("Pick") { pendingPick = movie }
                    .buttonStyle(.fr(.secondary, size: .compact))
                    .disabled(!room.canSubmit || room.myTurn?.kind != .draft)
                    .accessibilityLabel("Pick \(movie.title)")
                    .padding(.trailing, FRMetrics.rowPadding)
            }
        }
    }

    private func emptyMessage(_ model: DraftMoviePickerModel) -> String {
        if model.tab == .wishlist, model.trimmedQuery.isEmpty {
            return "Add movies from search to see them here."
        }
        if !model.trimmedQuery.isEmpty {
            return "No eligible movie matches “\(model.trimmedQuery)”. Try another title."
        }
        return "No eligible movies for these filters. Try a wider release window or fewer genres."
    }

    private func confirmationMessage(_ movie: MovieSearchResult) -> String {
        guard let turn = room.myTurn else { return "" }
        let date = movie.releaseDate.map { " It releases \($0.formatted(.full))." } ?? ""
        return "This is your round \(turn.round) pick (pick \(turn.overallPick)).\(date)"
    }
}

/// What a reload depends on; any change starts over from page one.
private struct ReloadKey: Hashable {
    let tab: CatalogTab
    let query: String
    let window: MovieBrowseRequest.ReleaseWindow
    let genres: Set<Int>

    @MainActor
    init(_ model: DraftMoviePickerModel) {
        tab = model.tab
        query = model.trimmedQuery
        window = model.window
        genres = model.genres
    }
}

/// Release window (All tab) and genres, as a menu with checkmarks.
private struct DraftCatalogFilterMenu: View {
    @Bindable var model: DraftMoviePickerModel
    let seasonYear: Int

    var body: some View {
        Menu {
            if model.tab == .all {
                Picker("Release window", selection: $model.window) {
                    ForEach(MovieBrowseRequest.ReleaseWindow.allCases, id: \.self) { window in
                        Text(window.title(seasonYear: seasonYear)).tag(window)
                    }
                }
            }
            Section("Genres") {
                ForEach(MovieGenre.tmdbMovieGenres) { genre in
                    Toggle(genre.name, isOn: Binding(
                        get: { model.genres.contains(genre.id) },
                        set: { isOn in
                            if isOn { model.genres.insert(genre.id) } else { model.genres.remove(genre.id) }
                        }
                    ))
                }
            }
            if model.activeFilterCount > 0 {
                Button("Clear Filters", role: .destructive) {
                    model.genres = []
                    model.window = .year
                }
            }
        } label: {
            Image(systemName: model.activeFilterCount > 0 ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
        .accessibilityLabel(model.activeFilterCount > 0 ? "Filters, \(model.activeFilterCount) on" : "Filters")
    }
}
