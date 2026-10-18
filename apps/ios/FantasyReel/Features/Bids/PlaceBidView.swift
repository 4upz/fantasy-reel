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
    /// Lives here, not in the picker, so Back from the amount keeps the query
    /// and results.
    @State private var search: MovieSearchModel?

    var body: some View {
        Group {
            if let selected {
                BidAmountForm(subject: selected, canGoBack: canGoBack) { self.selected = nil }
            } else {
                switch target {
                case .newPickup, .pickup:
                    PickupMoviePicker(counterPhase: counterPhaseAtOpen ?? false, search: $search) { selected = .pickup($0) }
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
        }
    }

    init(target: BidTarget) {
        self.target = target
        _selected = State(initialValue: target.subject)
    }

    /// A sheet opened on one movie has nothing to go back to.
    private var canGoBack: Bool { target.subject == nil }
}

extension BidTarget {
    /// The movie the sheet opens on, or nil to pick one first.
    var subject: BidSubject? {
        switch self {
        case .newPickup, .newCounterpick: nil
        case .pickup(let movie): .pickup(movie)
        case .counterpick(let option): .counterpick(option)
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
    @Binding var search: MovieSearchModel?
    let onSelect: (BiddableMovie) -> Void

    @Environment(AppEnvironment.self) private var environment
    @Environment(LeagueSeasonStore.self) private var season

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                if counterPhase {
                    contests
                } else if let search {
                    results(search)
                }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .navigationTitle(counterPhase ? "Counter a Bid" : "Place a Bid")
        .modifier(SearchableIf(model: counterPhase ? nil : search))
        .onAppear {
            guard search == nil, !counterPhase else { return }
            search = MovieSearchModel(movies: environment.movies, upcomingOnly: true, seasonYear: season.season.seasonYear)
        }
    }

    // Before the cutoff: title search.

    @ViewBuilder
    private func results(_ search: MovieSearchModel) -> some View {
        let owned = Set(season.snapshot?.holdings.map(\.tmdbID) ?? [])
        let scored = season.bids.snapshot?.scoredTMDbIDs ?? []
        let movies = search.results.filter { !owned.contains($0.tmdbID) && BidEligibility.isBiddable(releaseDate: $0.releaseDate) }
        switch search.phase {
        case .idle:
            EmptyStateView(title: "Search for a movie", message: "Type a movie title to get started", systemImage: "magnifyingglass")
        case .searching:
            LoadingView(label: "Searching movies…")
        case .failed(let message):
            ErrorStateView(message: message) { Task { await search.submit() } }
        case .noResults:
            EmptyStateView(title: "No movies found", message: "Try a different search term", systemImage: "magnifyingglass")
        case .results:
            let biddable = movies.filter { !scored.contains($0.tmdbID) }.count
            Text("\(biddable) available \(biddable == 1 ? "movie" : "movies") loaded")
                .frFont(.caption)
                .foregroundStyle(Color.frTextSecondary)
                .padding(.horizontal, 4)
            if !movies.isEmpty {
                FRRowGroup {
                    ForEach(movies) { movie in
                        movieRow(movie, isScored: scored.contains(movie.tmdbID))
                    }
                }
            }
            if search.hasMore {
                Button(search.isLoadingMore ? "Loading more movies…" : "Load more movies") {
                    Task { await search.loadMore() }
                }
                .buttonStyle(.fr(.secondary, size: .medium, fullWidth: true))
                .disabled(search.isLoadingMore)
            }
            if let message = search.loadMoreError {
                InlineBanner(tone: .error, title: message)
            }
            TMDbAttribution()
        }
    }

    private func movieRow(_ result: MovieSearchResult, isScored: Bool) -> some View {
        let high = season.bids.highPickupBid(on: result.tmdbID)
        let mine = high?.teamID == season.myTeam?.id
        var meta = result.releaseDate.map { String($0.year) } ?? "Release date TBA"
        if isScored {
            meta += " · Already scored, can't be bid on"
        } else if let high {
            meta += mine ? " · Your bid \(SeasonFormat.budget(high.amount))" : " · High bid \(SeasonFormat.budget(high.amount))"
        }
        return Button {
            onSelect(BiddableMovie(
                tmdbID: result.tmdbID, title: result.title, overview: result.overview,
                releaseDate: result.releaseDate, posterURL: result.posterURL
            ))
        } label: {
            MovieRow(title: result.title, meta: meta, posterURL: result.posterURL, showsChevron: !isScored)
        }
        .buttonStyle(.frRow)
        .disabled(isScored)
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

/// Adds the search field and drives the model, only in search mode.
private struct SearchableIf: ViewModifier {
    let model: MovieSearchModel?

    @ViewBuilder
    func body(content: Content) -> some View {
        if let model {
            @Bindable var model = model
            content
                .searchable(text: $model.filter.query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search for a movie")
                .onSubmit(of: .search) { Task { await model.submit() } }
                .task(id: model.filter) { await model.run() }
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

// MARK: - Step 2: amount

/// The amount, the conditional drop (pickups) and the fit forecast.
private struct BidAmountForm: View {
    let subject: BidSubject
    let canGoBack: Bool
    let onBack: () -> Void

    @Environment(LeagueSeasonStore.self) private var season
    @Environment(ShellRouter.self) private var router
    @State private var amount = 0
    @State private var didSetAmount = false
    @State private var dropID: HoldingID?
    @State private var submit = AsyncAction()
    /// A refusal or warning that isn't an error from the request itself.
    @State private var notice: String?

    private var bids: BidsStore { season.bids }
    private var remainingBudget: Int? { season.myTeam?.budget?.remainingBudget }

    private var highBid: Int? {
        switch subject {
        case .pickup(let movie): bids.highPickupBid(on: movie.tmdbID)?.amount
        case .counterpick(let option): bids.highCounterpickBid(on: option.movieID)?.amount
        }
    }

    private var highBidIsMine: Bool {
        let myTeamID = season.myTeam?.id
        switch subject {
        case .pickup(let movie): return bids.highPickupBid(on: movie.tmdbID)?.teamID == myTeamID
        case .counterpick(let option): return bids.highCounterpickBid(on: option.movieID)?.teamID == myTeamID
        }
    }

    private var isCounterpick: Bool {
        if case .counterpick = subject { return true }
        return false
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                movieCard
                amountCard
                if case .pickup = subject {
                    dropCard
                }
                fitLine
                if let message = submit.errorMessage {
                    InlineBanner(tone: .error, title: message)
                } else if let notice {
                    InlineBanner(tone: .warning, title: notice)
                }
                Button(action: place) {
                    Text(submit.isRunning ? "Placing Bid…" : "Place \(SeasonFormat.budget(amount)) \(isCounterpick ? "Counterpick " : "")Bid")
                }
                .buttonStyle(.fr(.primary, isLoading: submit.isRunning))
                .disabled(problem != nil || submit.isRunning)
                Text("Whole dollars. You're charged only if you win.")
                    .frFont(.caption)
                    .foregroundStyle(Color.frTextSecondary)
                    .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .navigationTitle(title)
        .navigationBarBackButtonHidden()
        .toolbar {
            if canGoBack {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Back", systemImage: "chevron.left", action: onBack)
                        .accessibilityLabel(isCounterpick ? "Back to movie selection" : "Back to movies")
                }
            }
        }
        .onAppear {
            guard !didSetAmount else { return }
            amount = BidAmountRule.initialAmount(highBid: highBid)
            didSetAmount = true
        }
        .onChange(of: amount) { _, newValue in
            if newValue != BidAmountRule.initialAmount(highBid: highBid) { router.sheetHasUnsavedInput = true }
        }
        .onChange(of: dropID) { router.sheetHasUnsavedInput = true }
        .announcesError(submit.errorMessage)
        .onChange(of: notice) { _, newValue in
            if let newValue { Announcer.announce(newValue) }
        }
    }

    private var title: String {
        guard highBid != nil else { return "Set Your Bid" }
        if highBidIsMine { return "Raise Your Bid" }
        return isCounterpick ? "Counter Counterpick Bid" : "Counter Bid"
    }

    private var problem: String? {
        if case .counterpick(let option) = subject,
           !bids.hasCounterpickSlot(for: option.movieID, slots: season.season.biddingCounterpickSlots) {
            return "All counterpick slots used"
        }
        return BidAmountRule.problem(amount: amount, remainingBudget: remainingBudget, highBid: highBid)
    }

    // MARK: Sections

    private var movieCard: some View {
        FRRowGroup {
            MovieRow(title: subject.title, meta: movieMeta, posterURL: subject.posterURL)
        }
    }

    private var movieMeta: String {
        var parts = [DateOnly.display(subject.releaseDate, style: .short)]
        if case .counterpick(let option) = subject { parts.insert("vs \(option.ownerTeamName)", at: 0) }
        if let highBid {
            parts.append(highBidIsMine ? "Your bid \(SeasonFormat.budget(highBid))" : "High \(SeasonFormat.budget(highBid))")
        }
        return parts.joined(separator: " · ")
    }

    private var amountCard: some View {
        let maxAmount = min(remainingBudget ?? 0, BidAmountRule.maximum)
        let minAmount = highBid.map { $0 + 1 } ?? 0
        return FRCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Your bid")
                        .frFont(.rowLabel)
                        .foregroundStyle(Color.frText)
                    Spacer()
                    Text(SeasonFormat.budget(amount))
                        .frFont(.numberHero)
                        .foregroundStyle(Color.frGold)
                        .contentTransition(.numericText(value: Double(amount)))
                        .accessibilityHidden(true)
                }
                Stepper("Bid amount", value: $amount, in: 0...max(maxAmount, 0))
                    .labelsHidden()
                    .accessibilityValue("\(amount) dollars")
                // One row when it fits; two columns at large text sizes.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { quickButtons(min: minAmount, max: maxAmount) }
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible())], alignment: .leading, spacing: 8) {
                        quickButtons(min: minAmount, max: maxAmount)
                    }
                }
                FRHairline()
                HStack {
                    Text("Budget after")
                        .frFont(.meta)
                        .foregroundStyle(Color.frTextSecondary)
                    Spacer()
                    Text(remainingBudget.map { SeasonFormat.budget(max($0 - amount, 0)) } ?? "Unavailable")
                        .frFont(.label)
                        .foregroundStyle(Color.frText)
                        .monospacedDigit()
                }
                .accessibilityElement(children: .combine)
                Text(problem ?? (amount == 0
                    ? (isCounterpick ? "Claim this counterpick for free if no one else bids" : "Claim this movie for free if no one else bids")
                    : "You'll spend \(SeasonFormat.budget(amount)) from your budget if you win"))
                    .frFont(.caption)
                    .foregroundStyle(problem == nil ? Color.frTextSecondary : Color.frError)
            }
        }
    }

    @ViewBuilder
    private func quickButtons(min minAmount: Int, max maxAmount: Int) -> some View {
        quickButton("+$1") { amount = Swift.min(amount + 1, maxAmount) }
        quickButton("+$5") { amount = Swift.min(amount + 5, maxAmount) }
        if highBid != nil {
            quickButton("High + $1") { amount = Swift.min(minAmount, maxAmount) }
        }
        quickButton("Max \(SeasonFormat.budget(maxAmount))") { amount = maxAmount }
    }

    private func quickButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .buttonStyle(.fr(.neutral, size: .compact))
    }

    /// Holdings a conditional drop may name (`getDroppableBidHoldingIds`).
    private var droppableHoldings: [TeamHolding] {
        guard let team = season.myTeam else { return [] }
        let holdings = season.holdings(of: team.id)
        let ids = Set(BidFitForecast.droppableHoldingIDs(
            holdings, today: DateOnly.today(),
            counterpicksBlockDrops: season.season.counterpicksBlockDrops,
            contestedMovieIDs: season.snapshot?.contestedMovieIDs ?? []
        ))
        return holdings.filter { ids.contains($0.holdingID) }
    }

    @ViewBuilder
    private var dropCard: some View {
        let options = droppableHoldings
        let freeSlots = freeSlots
        if freeSlots == 0, dropID == nil {
            InlineBanner(
                tone: .warning,
                title: "Your roster is full",
                message: options.isEmpty
                    ? "None of your movies can be dropped: they have all released or been counterpicked. You can still place this bid, but it can only be honored if a slot frees up before bids are processed."
                    : "You can still place this bid, but it can only be honored if you choose a movie to drop below, or a slot frees up before bids are processed."
            )
        }
        if !options.isEmpty {
            FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                Menu {
                    Picker("If I need room, drop", selection: $dropID) {
                        Text("Nothing, keep my roster").tag(HoldingID?.none)
                        ForEach(options) { holding in
                            Text(holding.title).tag(HoldingID?.some(holding.holdingID))
                        }
                    }
                } label: {
                    HStack(spacing: 8) {
                        Text("If I need room, drop")
                            .frFont(.rowLabel)
                            .foregroundStyle(Color.frText)
                        Spacer(minLength: 8)
                        Text(options.first { $0.holdingID == dropID }?.title ?? "Nothing")
                            .frFont(.body)
                            .foregroundStyle(Color.frTextSecondary)
                            .lineLimit(1)
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Color.frTextMuted)
                            .accessibilityHidden(true)
                    }
                    .padding(.horizontal, FRMetrics.rowPadding)
                    .frame(minHeight: FRMetrics.minTapTarget)
                    .contentShape(Rectangle())
                }
                .accessibilityLabel("If I need room, drop")
                .accessibilityValue(options.first { $0.holdingID == dropID }?.title ?? "Nothing")
            }
        }
    }

    private var freeSlots: Int {
        guard let team = season.myTeam else { return 0 }
        return max(season.season.totalSlots - season.holdings(of: team.id).count, 0)
    }

    /// "Fits in your open slot" / "Fits by dropping …" / why it wouldn't fit,
    /// if every one of my bids won (a forecast; processing decides).
    @ViewBuilder
    private var fitLine: some View {
        if let forecast = fitForecast {
            Label(forecast.text, systemImage: forecast.fits ? "checkmark.circle" : "exclamationmark.triangle")
                .frFont(.meta)
                .foregroundStyle(forecast.fits ? Color.frSuccess : Color.frWarning)
                .padding(.horizontal, 4)
        }
    }

    private var fitForecast: (text: String, fits: Bool)? {
        switch subject {
        case .pickup(let movie):
            // My bids in priority order, this one replacing my existing bid
            // on the movie or joining at the end.
            var targets: [HoldingID?] = []
            var thisIndex: Int?
            for bid in bids.myPickupBids {
                if bid.tmdbID == movie.tmdbID {
                    thisIndex = targets.count
                    targets.append(dropID)
                } else {
                    targets.append(bid.conditionalDropHoldingID)
                }
            }
            if thisIndex == nil {
                thisIndex = targets.count
                targets.append(dropID)
            }
            let forecast = BidFitForecast.forecast(
                dropTargets: targets,
                freeSlots: freeSlots,
                remainingDrops: season.dropsRemaining,
                droppable: Set(droppableHoldings.map(\.holdingID))
            )
            switch forecast[thisIndex ?? 0] {
            case .slot?: return ("Fits in your open slot if all your bids win", true)
            case .drop?:
                let title = droppableHoldings.first { $0.holdingID == dropID }?.title ?? "your chosen movie"
                return ("Fits by dropping \(title) if all your bids win", true)
            case nil: return ("Won't fit if all your higher-priority bids win", false)
            }
        case .counterpick(let option):
            let slots = season.season.biddingCounterpickSlots - (bids.snapshot?.biddingCounterpickCount ?? 0)
            let mine = bids.myCounterpickBids
            let position = mine.firstIndex { $0.movieID == option.movieID } ?? mine.count
            return position < slots
                ? ("Uses an open counterpick slot if it wins", true)
                : ("Your higher-priority counterpick bids would fill your slots first", false)
        }
    }

    // MARK: Submit

    private func place() {
        guard problem == nil else { return }
        notice = nil
        if !BidEligibility.isBiddable(releaseDate: subject.releaseDate) {
            notice = "\(subject.title) has already released and can no longer be bid on"
            return
        }
        let amount = amount
        let leagueID = season.season.id
        let dropHolding = droppableHoldings.first { $0.holdingID == dropID }
        submit.run {
            let result: PlaceBidResult
            switch subject {
            case .pickup(let movie):
                result = try await bids.place(PlacePickupBid(
                    leagueID: leagueID, tmdbID: movie.tmdbID, amount: amount,
                    conditionalDrop: dropHolding.map { ($0.holdingID, $0.source) }
                ))
            case .counterpick(let option):
                result = try await bids.placeCounterpick(movie: option.movieID, amount: amount)
            }
            if result.raceCondition {
                // Saved, but an equal or higher bid landed at the same moment, so it's
                // already outbid. Stay open on the new high bid so they can counter.
                notice = result.message ?? "Someone else bid at the same time. You can counter."
                amount = BidAmountRule.initialAmount(highBid: highBid)
                router.sheetHasUnsavedInput = false
                return
            }
            if isCounterpick {
                Announcer.announce("Counterpick bid of \(SeasonFormat.budget(amount)) placed on \(subject.title)")
            } else if let dropHolding {
                Announcer.announce("Bid of \(SeasonFormat.budget(amount)) placed on \(subject.title). \(dropHolding.title) drops if it wins.")
            } else {
                Announcer.announce("Bid of \(SeasonFormat.budget(amount)) placed on \(subject.title)")
            }
            router.sheetHasUnsavedInput = false
            router.dismissSheet()
        }
    }
}
