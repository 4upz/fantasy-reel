import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// The wishlist in the menu sheet (F-07; mockup V2Wishlist): the person's own
/// list, which belongs to them across every league, and the lists league-mates
/// share in the season the app is showing.
struct WishlistView: View {
    enum Mode: Hashable {
        case mine, league
    }

    @State private var mode: Mode
    @State private var sort: WishlistSort = .dateAdded

    @Environment(WishlistStore.self) private var wishlist
    @Environment(LeagueDirectoryStore.self) private var directory
    @Environment(LeagueResearchStore.self) private var research
    @Environment(ShellRouter.self) private var router

    init(initialMode: Mode = .mine) {
        _mode = State(initialValue: initialMode)
    }

    private var selection: LeagueSelection? { directory.selection }

    var body: some View {
        List {
            if selection != nil {
                FRSegmentedControl("Wishlist", selection: $mode, options: [.mine, .league], title: { mode in
                    mode == .mine ? "Mine" : "League"
                })
                .plainListRow()
            }
            switch mode {
            case .mine: myWishlist
            case .league: SharedWishlistsSection()
            }
        }
        .listStyle(.plain)
        .listSectionSpacing(FRMetrics.sectionSpacing)
        .scrollContentBackground(.hidden)
        .background(Color.frBackground)
        .environment(\.defaultMinListRowHeight, 0)
        .navigationTitle("Wishlist")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Find movies to add", systemImage: "plus") {
                    router.open(.movies, directory: directory)
                }
            }
        }
        .refreshable {
            async let mine: Void = wishlist.load()
            if let selection { await research.load(selection, force: true) }
            await mine
        }
        .task {
            if case .idle = wishlist.state { await wishlist.load() }
        }
        .task(id: selection?.season.id) {
            if let selection { await research.load(selection) }
        }
        .animation(.default, value: wishlist.failure)
    }

    @ViewBuilder
    private var myWishlist: some View {
        SharingToggle(leagueName: selection?.season.name)
            .plainListRow()
        WishlistFailureBanner()
            .plainListRow()
        switch wishlist.state {
        case .idle, .loading:
            ProgressView("Loading your wishlist…")
                .frame(maxWidth: .infinity)
                .padding(.vertical, 48)
                .plainListRow()
        case .failed(let message):
            ErrorStateView(message: message, layout: .card) {
                Task { await wishlist.load() }
            }
            .plainListRow()
        case .empty, .loaded:
            if wishlist.movies.isEmpty {
                EmptyStateView(
                    title: "Your wishlist is empty",
                    message: "Bookmark movies from search or a movie's page to keep track of ones you'd like to draft or bid on.",
                    systemImage: "bookmark"
                ) {
                    Button("Find Movies") { router.open(.movies, directory: directory) }
                        .buttonStyle(.fr(.primary, size: .medium, fullWidth: false))
                }
                .padding(.top, 24)
                .plainListRow()
            } else {
                movieRows
            }
        }
    }

    private var movieRows: some View {
        let movies = sort.sorted(wishlist.movies)
        let holdings = selection.map { research.holdings(in: $0.season.id) }
        return Section {
            ForEach(movies) { movie in
                let added = AddedDateText(movie.addedAt)
                ResearchMovieRow(
                    title: movie.title,
                    posterURL: movie.posterURL,
                    detail: "Added \(added.compact)",
                    spokenDetail: "Added \(added.spoken)",
                    status: holdings?.status(of: movie.tmdbID),
                    candidate: WishlistCandidate(movie),
                    showsBookmark: false
                )
                .groupedRow(isFirst: movie.id == movies.first?.id, isLast: movie.id == movies.last?.id)
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button("Remove", systemImage: "trash", role: .destructive) {
                        Task { await wishlist.remove(movie.tmdbID) }
                    }
                }
            }
        } header: {
            HStack(alignment: .firstTextBaseline) {
                SectionHeader("Movies", detail: "\(wishlist.count)")
                Menu {
                    Picker("Sort by", selection: $sort) {
                        ForEach(WishlistSort.allCases, id: \.self) { option in
                            Text(option.title).tag(option)
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text(sort.title)
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.caption.weight(.semibold))
                            .accessibilityHidden(true)
                    }
                    .frFont(.label)
                    .foregroundStyle(Color.frGold)
                    .frame(minHeight: FRMetrics.minTapTarget)
                }
                .accessibilityLabel("Sort by")
                .accessibilityValue(sort.title)
                .padding(.top, 12)
            }
            .listRowInsets(EdgeInsets(top: 0, leading: FRMetrics.pageMargin, bottom: 4, trailing: FRMetrics.pageMargin))
        } footer: {
            TMDbAttribution()
                .listRowInsets(EdgeInsets())
        }
    }
}

/// Share with league-mates. Sharing is one setting across every league the
/// person plays in, so the copy doesn't name just one.
private struct SharingToggle: View {
    let leagueName: String?

    @Environment(WishlistStore.self) private var wishlist

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle(isOn: Binding(
                get: { wishlist.isShared },
                set: { shared in Task { await wishlist.setSharing(shared) } }
            )) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Share with league-mates")
                        .frFont(.rowLabel)
                        .foregroundStyle(Color.frText)
                    Text(wishlist.isShared ? "Everyone in your leagues can see this list" : "Only you can see this list")
                        .frFont(.meta)
                        .foregroundStyle(Color.frTextSecondary)
                }
            }
            .tint(Color.frSuccess)
            .disabled(wishlist.isSavingSharing || wishlist.state.value == nil)
            .padding(.horizontal, FRMetrics.rowPadding)
            .frame(minHeight: FRMetrics.rowHeight)
            .frCardBackground()

            if let error = wishlist.sharingError {
                Text(error)
                    .frFont(.meta)
                    .foregroundStyle(Color.frError)
                    .padding(.horizontal, 4)
            } else if let leagueName {
                Text("Private unless you share it. Status is for \(leagueName).")
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
                    .padding(.horizontal, 4)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}

/// League-mates in this season who share their wishlists.
private struct SharedWishlistsSection: View {
    @State private var counts: LoadState<[UserID: Int]> = .idle

    @Environment(AppEnvironment.self) private var environment
    @Environment(LeagueDirectoryStore.self) private var directory
    @Environment(LeagueResearchStore.self) private var research

    private var selection: LeagueSelection? { directory.selection }

    private var mates: [LeagueMember] {
        research.members(of: selection?.season.id).filter { $0.userID != selection?.userID }
    }

    private var sharing: [LeagueMember] { mates.filter { $0.profile?.wishlistPublic == true } }

    var body: some View {
        Group {
            if let failure = selection.flatMap({ research.failures[$0.season.id] }), mates.isEmpty {
                ErrorStateView(message: "Couldn't load your league-mates. \(failure)", layout: .card) {
                    if let selection { Task { await research.load(selection, force: true) } }
                }
                .plainListRow()
            } else if mates.isEmpty, selection.flatMap({ research.snapshots[$0.season.id] }) == nil {
                ProgressView("Loading league-mates…")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 48)
                    .plainListRow()
            } else if sharing.isEmpty {
                EmptyStateView(
                    title: "No shared wishlists yet",
                    message: "When league-mates in \(selection?.season.name ?? "this league") share their wishlists, they show up here.",
                    systemImage: "person.2"
                )
                .padding(.top, 24)
                .plainListRow()
            } else {
                Section {
                    ForEach(Array(sharing.enumerated()), id: \.element.id) { index, member in
                        let owner = SharedWishlistOwner(
                            userID: member.userID,
                            displayName: member.displayName,
                            avatarURL: member.profile?.avatarURL,
                            movieCount: counts.value?[member.userID] ?? 0
                        )
                        NavigationLink(value: MenuRoute.sharedWishlist(owner)) {
                            ListRow(title: member.displayName, meta: meta(for: member, owner: owner), showsChevron: true) {
                                Avatar(name: member.displayName, imageURL: member.profile?.avatarURL, size: .medium)
                            } trailing: {
                                EmptyView()
                            }
                        }
                        .buttonStyle(.frRow)
                        .groupedRow(isFirst: index == 0, isLast: index == sharing.count - 1)
                    }
                } header: {
                    SectionHeader("Shared with you", detail: "\(sharing.count)")
                        .listRowInsets(EdgeInsets(top: 0, leading: FRMetrics.pageMargin, bottom: 4, trailing: FRMetrics.pageMargin))
                } footer: {
                    if mates.count > sharing.count {
                        let hidden = mates.count - sharing.count
                        Text("\(hidden) \(hidden == 1 ? "league-mate keeps their list" : "league-mates keep their lists") private.")
                            .frFont(.meta)
                            .foregroundStyle(Color.frTextSecondary)
                            .padding(.horizontal, 4)
                            .padding(.top, 8)
                            .listRowInsets(EdgeInsets(top: 0, leading: FRMetrics.pageMargin, bottom: 0, trailing: FRMetrics.pageMargin))
                    }
                }
            }
        }
        .task(id: sharing.map(\.userID)) { await loadCounts() }
    }

    private func meta(for member: LeagueMember, owner: SharedWishlistOwner) -> String {
        let team = member.team?.name
        guard counts.value != nil else { return team ?? "" }
        return [team, owner.countText].compactMap { $0 }.joined(separator: " · ")
    }

    private func loadCounts() async {
        let ids = sharing.map(\.userID)
        guard !ids.isEmpty else { return }
        do {
            counts = .loaded(try await environment.wishlists.fetchVisibleCounts(of: ids))
        } catch {
            // Counts are a nicety; rows still open each list without them.
            if counts.value == nil { counts = .failed(message: error.userMessage) }
        }
    }
}

/// A league-mate's shared wishlist, with this season's status for each movie
/// and a bookmark to copy any of them onto your own list.
struct SharedWishlistView: View {
    let owner: SharedWishlistOwner

    @State private var state: LoadState<[WishlistedMovie]> = .idle

    @Environment(AppEnvironment.self) private var environment
    @Environment(WishlistStore.self) private var wishlist
    @Environment(LeagueDirectoryStore.self) private var directory
    @Environment(LeagueResearchStore.self) private var research

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                HStack(spacing: 12) {
                    Avatar(name: owner.displayName, imageURL: owner.avatarURL, size: .large)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(owner.displayName)
                            .frFont(.panelTitle)
                            .foregroundStyle(Color.frText)
                            .accessibilityAddTraits(.isHeader)
                        if let movies = state.value {
                            Text(overlapText(movies))
                                .frFont(.meta)
                                .foregroundStyle(Color.frTextSecondary)
                        }
                    }
                }
                .padding(.top, 8)
                WishlistFailureBanner()
                LoadStateView(
                    state,
                    loadingLabel: "Loading wishlist…",
                    emptyTitle: "Nothing here yet",
                    emptyMessage: "\(owner.displayName) hasn't added any movies.",
                    emptySystemImage: "bookmark",
                    retry: { Task { await load() } }
                ) { movies in
                    VStack(spacing: FRMetrics.sectionSpacing) {
                        LazyRowGroup(items: movies) { movie in
                            ResearchMovieRow(
                                title: movie.title,
                                posterURL: movie.posterURL,
                                detail: wishlist.contains(movie.tmdbID) ? "Also on yours" : nil,
                                status: directory.selection.map { _ in research.holdings(in: directory.selection?.season.id).status(of: movie.tmdbID) },
                                candidate: WishlistCandidate(movie)
                            )
                        }
                        TMDbAttribution()
                    }
                }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
            .animation(.default, value: wishlist.failure)
        }
        .background(Color.frBackground)
        .navigationTitle("\(owner.displayName)'s Wishlist")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { if state.value == nil { await load() } }
    }

    private func overlapText(_ movies: [WishlistedMovie]) -> String {
        let shared = movies.filter { wishlist.contains($0.tmdbID) }.count
        let count = "\(movies.count) \(movies.count == 1 ? "movie" : "movies")"
        return shared > 0 ? "\(count) · \(shared) also on yours" : count
    }

    private func load() async {
        if state.value == nil { state = .loading }
        do {
            let movies = try await environment.wishlists.fetchWishlist(of: owner.userID)
            state = movies.isEmpty ? .empty : .loaded(movies)
        } catch {
            if error.isCancellation { return }
            if state.value == nil { state = .failed(message: "Couldn't load \(owner.displayName)'s wishlist. \(error.userMessage)") }
        }
    }
}

// MARK: - List styling

private extension View {
    /// A full-width list row with no background or separator (controls,
    /// banners, empty states between the grouped rows).
    func plainListRow() -> some View {
        self
            .listRowInsets(EdgeInsets(top: 6, leading: FRMetrics.pageMargin, bottom: 6, trailing: FRMetrics.pageMargin))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
    }

    /// A row on the grouped surface (the `.grp` look): rounded ends on the
    /// first and last row, hairlines inset past the poster between.
    func groupedRow(isFirst: Bool, isLast: Bool) -> some View {
        self
            .listRowInsets(EdgeInsets())
            .listRowBackground(
                UnevenRoundedRectangle(
                    topLeadingRadius: isFirst ? FRMetrics.cardRadius : 0,
                    bottomLeadingRadius: isLast ? FRMetrics.cardRadius : 0,
                    bottomTrailingRadius: isLast ? FRMetrics.cardRadius : 0,
                    topTrailingRadius: isFirst ? FRMetrics.cardRadius : 0,
                    style: .continuous
                )
                .fill(Color.frSurface)
                .padding(.horizontal, FRMetrics.pageMargin)
            )
            .listRowSeparator(isFirst ? .hidden : .visible, edges: .top)
            .listRowSeparator(isLast ? .hidden : .visible, edges: .bottom)
            .listRowSeparatorTint(Color.frSeparator)
            .alignmentGuide(.listRowSeparatorLeading) { _ in FRMetrics.pageMargin + FRMetrics.separatorInset }
            .alignmentGuide(.listRowSeparatorTrailing) { dimensions in dimensions.width - FRMetrics.pageMargin }
            .padding(.horizontal, FRMetrics.pageMargin)
    }
}
