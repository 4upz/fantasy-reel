import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// Trade composer (F-13, mockup V2TradeComposer): pick a partner, choose what
/// each side gives, then review with a message and an expiry. A counter starts
/// from the offer's items, can add any of my movies, and can only keep or
/// remove the movies the other team offered.
struct TradeComposerView: View {
    enum Mode: Hashable {
        case propose(TeamID?)
        case counter(TradeOfferID)
    }

    let mode: Mode

    @Environment(LeagueSeasonStore.self) private var season
    @Environment(ShellRouter.self) private var router
    @State private var partnerID: TeamID?
    @State private var draft = TradeDraft()
    @State private var reviewing = false
    @State private var didStart = false
    /// The draft the sheet opened with: a counter starts prefilled, and only
    /// changes from that count as unsaved input.
    @State private var startingDraft = TradeDraft()

    private var counterOffer: TradeOffer? {
        if case .counter(let id) = mode { return season.trades.offer(id) }
        return nil
    }

    var body: some View {
        Group {
            if case .counter = mode, counterOffer == nil {
                EmptyStateView(
                    title: "This offer is gone",
                    message: "It was answered, cancelled or expired.",
                    systemImage: "arrow.left.arrow.right"
                )
            } else if let partnerID, let partner = season.team(partnerID) {
                if reviewing {
                    TradeReviewStep(
                        mode: mode, partner: partner, draft: $draft,
                        onEdit: { reviewing = false }
                    )
                } else {
                    TradeBuildStep(
                        mode: mode, partner: partner, counterOffer: counterOffer, draft: $draft,
                        canChangePartner: mode == .propose(nil),
                        onChangePartner: {
                            self.partnerID = nil
                            draft = TradeDraft()
                        },
                        onReview: { reviewing = true }
                    )
                }
            } else {
                TradePartnerStep { partnerID = $0 }
            }
        }
        .background(Color.frSheetBackground)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { router.dismissSheet() }
            }
        }
        .onAppear(perform: start)
        .onChange(of: draft) { router.sheetHasUnsavedInput = draft != startingDraft }
    }

    private func start() {
        guard !didStart else { return }
        didStart = true
        switch mode {
        case .propose(let teamID):
            partnerID = teamID
        case .counter:
            guard let offer = counterOffer else { return }
            partnerID = offer.initiatorTeamID
            // I was the recipient: what I gave is the offer's recipient side.
            draft = TradeDraft(
                give: Set(offer.recipientItems.movies.map(\.sourceID)),
                giveBudget: offer.recipientItems.budget,
                receive: Set(offer.initiatorItems.movies.map(\.sourceID)),
                receiveBudget: offer.initiatorItems.budget
            )
            startingDraft = draft
        }
    }
}

/// What the composer has chosen so far.
struct TradeDraft: Hashable {
    var give: Set<String> = []
    var giveBudget = 0
    var receive: Set<String> = []
    var receiveBudget = 0
    var message = ""
    var expiry: TradeExpiryChoice?

    var isEmpty: Bool { give.isEmpty && receive.isEmpty && giveBudget == 0 && receiveBudget == 0 }
}

// MARK: - Step 1: partner

private struct TradePartnerStep: View {
    let onPick: (TeamID) -> Void

    @Environment(LeagueSeasonStore.self) private var season

    var body: some View {
        let partners = season.teams.filter { season.canProposeTrade(to: $0.id) }
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                if partners.isEmpty {
                    EmptyStateView(
                        title: "No one to trade with",
                        message: tradingClosedMessage,
                        systemImage: "arrow.left.arrow.right"
                    )
                } else {
                    Text("Choose a team to trade with.")
                        .frFont(.bodySmall)
                        .foregroundStyle(Color.frTextSecondary)
                    FRRowGroup {
                        ForEach(partners) { team in
                            Button { onPick(team.id) } label: {
                                ListRow(
                                    title: team.name,
                                    meta: team.ownerDisplayName,
                                    showsChevron: true
                                ) {
                                    Avatar(name: team.name, imageURL: team.avatarURL)
                                } trailing: {
                                    EmptyView()
                                }
                            }
                            .buttonStyle(.frRow)
                        }
                    }
                }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .navigationTitle("Select Trade Partner")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var tradingClosedMessage: String {
        let league = season.season
        if !league.tradesEnabled { return "Trading is off for this season." }
        if league.status != .active { return "Trades open once the season is active." }
        if let deadline = league.tradeDeadline, deadline < DateOnly.today() { return "The trade deadline has passed." }
        return "There are no other active teams in this season."
    }
}

// MARK: - Step 2: items

private struct TradeBuildStep: View {
    let mode: TradeComposerView.Mode
    let partner: SeasonTeam
    let counterOffer: TradeOffer?
    @Binding var draft: TradeDraft
    let canChangePartner: Bool
    let onChangePartner: () -> Void
    let onReview: () -> Void

    @Environment(LeagueSeasonStore.self) private var season

    var body: some View {
        let mine = myTradeables
        let theirs = partnerTradeables
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                if canChangePartner {
                    Button("Change trade partner", systemImage: "chevron.left", action: onChangePartner)
                        .frFont(.label)
                        .foregroundStyle(Color.frGold)
                        .frame(minHeight: FRMetrics.minTapTarget)
                }
                TradeChecklist(
                    title: "You give (\(season.myTeam?.name ?? "your team"))",
                    movies: mine,
                    selection: $draft.give,
                    budget: $draft.giveBudget,
                    maxBudget: season.myTeam?.budget?.remainingBudget,
                    showsBudget: season.showsBudget
                )
                TradeChecklist(
                    title: "You get (\(partner.name))",
                    movies: theirs,
                    selection: $draft.receive,
                    budget: $draft.receiveBudget,
                    maxBudget: counterOffer == nil ? partner.budget?.remainingBudget : nil,
                    showsBudget: season.showsBudget
                )
                if counterOffer != nil {
                    Text("A counter can only ask for movies from \(partner.name)'s offer.")
                        .frFont(.caption)
                        .foregroundStyle(Color.frTextSecondary)
                }
                Button("Review Offer", action: onReview)
                    .buttonStyle(.fr(.primary))
                    .disabled(draft.isEmpty)
                if draft.isEmpty {
                    Text("Add at least one movie or some budget.")
                        .frFont(.caption)
                        .foregroundStyle(Color.frTextSecondary)
                        .frame(maxWidth: .infinity)
                }
                if !(mine.isEmpty && theirs.isEmpty) { TMDbAttribution() }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .navigationTitle(counterOffer == nil ? "Trade with \(partner.name)" : "Counter \(partner.name)")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var teamNames: [TeamID: String] {
        Dictionary(season.teams.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
    }

    private var myTradeables: [TradeableMovie] {
        guard let me = season.myTeam else { return [] }
        return TradeableMovie.list(holdings: season.holdings(of: me.id), counterpicks: season.counterpicks(by: me.id), teamNames: teamNames)
    }

    /// The partner's assets; for a counter, only what their offer named.
    private var partnerTradeables: [TradeableMovie] {
        if let counterOffer {
            return counterOffer.initiatorItems.movies.map { item in
                TradeableMovie(
                    movieID: item.movieID, source: item.source, sourceID: item.sourceID,
                    title: item.displayTitle, posterURL: item.posterURL, releaseDate: item.releaseDate
                )
            }
        }
        return TradeableMovie.list(holdings: season.holdings(of: partner.id), counterpicks: season.counterpicks(by: partner.id), teamNames: teamNames)
    }
}

/// One side's checklist and budget.
private struct TradeChecklist: View {
    let title: String
    let movies: [TradeableMovie]
    @Binding var selection: Set<String>
    @Binding var budget: Int
    let maxBudget: Int?
    let showsBudget: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title, detail: selection.isEmpty ? "" : "\(selection.count) selected")
            if movies.isEmpty {
                FRCard {
                    Text("No tradeable movies")
                        .frFont(.bodySmall)
                        .foregroundStyle(Color.frTextSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                FRRowGroup {
                    ForEach(movies) { movie in
                        TradeChecklistRow(movie: movie, isSelected: selection.contains(movie.sourceID)) {
                            if selection.contains(movie.sourceID) {
                                selection.remove(movie.sourceID)
                            } else if !movie.isScoreLocked {
                                selection.insert(movie.sourceID)
                            }
                        }
                    }
                }
            }
            if showsBudget {
                FRCard {
                    Stepper(value: $budget, in: 0...max(maxBudget ?? 100, 0)) {
                        HStack {
                            Text("Budget")
                                .frFont(.rowLabel)
                                .foregroundStyle(Color.frText)
                            if let maxBudget {
                                Text("max \(SeasonFormat.budget(maxBudget))")
                                    .frFont(.meta)
                                    .foregroundStyle(Color.frTextSecondary)
                            }
                            Spacer()
                            Text(SeasonFormat.budget(budget))
                                .frFont(.number)
                                .foregroundStyle(Color.frGold)
                        }
                    }
                    .accessibilityLabel("Budget")
                    .accessibilityValue("\(budget) dollars")
                }
            }
        }
    }
}

private struct TradeChecklistRow: View {
    let movie: TradeableMovie
    let isSelected: Bool
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            MovieRow(title: movie.title, meta: meta, posterURL: movie.posterURL, accessibilityLabel: accessibilityText) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(isSelected ? Color.frGold : Color.frTextMuted)
                    .accessibilityHidden(true)
            }
            .background(isSelected ? Color.frGoldTint : .clear)
            .opacity(movie.isScoreLocked && !isSelected ? 0.6 : 1)
        }
        .buttonStyle(.frRow)
        .disabled(movie.isScoreLocked && !isSelected)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityHint(movie.isScoreLocked && !isSelected ? "Already scored, can't be traded" : "")
    }

    private var meta: String {
        var parts: [String] = []
        if movie.isScoreLocked { parts.append("Already scored, can't be traded") }
        if movie.source == .counterpick { parts.append(movie.counterpickTargetTeamName.map { "Counterpick vs. \($0)" } ?? "Counterpick") }
        parts.append(DateOnly.display(movie.releaseDate, style: .short))
        return parts.joined(separator: " · ")
    }

    private var accessibilityText: String { "\(movie.title), \(meta)" }
}

// MARK: - Step 3: review

private struct TradeReviewStep: View {
    let mode: TradeComposerView.Mode
    let partner: SeasonTeam
    @Binding var draft: TradeDraft
    let onEdit: () -> Void

    @Environment(LeagueSeasonStore.self) private var season
    @Environment(ShellRouter.self) private var router
    @State private var submit = AsyncAction()

    private var isCounter: Bool {
        if case .counter = mode { return true }
        return false
    }

    var body: some View {
        let bounds = TradeExpiryBounds(league: season.season)
        let give = items(draft.give, budget: draft.giveBudget, from: myMovies)
        let receive = items(draft.receive, budget: draft.receiveBudget, from: partnerMovies)
        let invalid = Set(submit.lastError?.invalidSourceIDs ?? [])
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                FRCard {
                    VStack(alignment: .leading, spacing: 14) {
                        TradeSideView(title: "You give", items: give, contested: [], invalid: invalid, isMine: true)
                        if let remaining = season.myTeam?.budget?.remainingBudget, draft.giveBudget > 0 {
                            Text("Leaves you \(SeasonFormat.budget(max(remaining - draft.giveBudget, 0)))")
                                .frFont(.caption)
                                .foregroundStyle(Color.frTextSecondary)
                        }
                        FRHairline()
                        TradeSideView(title: "You get", items: receive, contested: [], invalid: invalid, isMine: false)
                    }
                }
                Button("Edit Items", systemImage: "pencil", action: onEdit)
                    .buttonStyle(.fr(.neutral, size: .medium))
                messageField
                TradeExpiryPicker(choice: $draft.expiry, movies: give.movies + receive.movies, bounds: bounds)
                if let message = submit.errorMessage {
                    InlineBanner(tone: .error, title: message)
                }
                Button(submit.isRunning ? (isCounter ? "Sending…" : "Proposing…") : (isCounter ? "Send Counter" : "Propose Trade")) {
                    send(give: give, receive: receive, bounds: bounds)
                }
                .buttonStyle(.fr(.primary, isLoading: submit.isRunning))
                .disabled(submit.isRunning)
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .navigationTitle(isCounter ? "Review Counter" : "Review Offer")
        .navigationBarTitleDisplayMode(.inline)
        .interactiveDismissDisabled(submit.isRunning)
        .announcesError(submit.errorMessage)
    }

    private var messageField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Message (optional)")
                .frFont(.label)
                .foregroundStyle(Color.frTextSecondary)
            TextField(isCounter ? "Add a note to your counter-offer…" : "Add a note to your trade proposal…", text: $draft.message, axis: .vertical)
                .lineLimit(2...5)
                .padding(12)
                .background(Color.frElevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .onChange(of: draft.message) { _, value in
                    if value.count > 1500 { draft.message = String(value.prefix(1500)) }
                }
            Text("Everyone in the league can see this message.")
                .frFont(.caption)
                .foregroundStyle(Color.frTextSecondary)
        }
    }

    private var teamNames: [TeamID: String] {
        Dictionary(season.teams.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
    }

    private var myMovies: [TradeMovieItem] {
        guard let me = season.myTeam else { return [] }
        return TradeableMovie.list(holdings: season.holdings(of: me.id), counterpicks: season.counterpicks(by: me.id), teamNames: teamNames).map(\.item)
    }

    private var partnerMovies: [TradeMovieItem] {
        if case .counter(let id) = mode, let offer = season.trades.offer(id) { return offer.initiatorItems.movies }
        return TradeableMovie.list(holdings: season.holdings(of: partner.id), counterpicks: season.counterpicks(by: partner.id), teamNames: teamNames).map(\.item)
    }

    private func items(_ ids: Set<String>, budget: Int, from movies: [TradeMovieItem]) -> TradeItems {
        TradeItems(movies: movies.filter { ids.contains($0.sourceID) }, budget: budget)
    }

    private func send(give: TradeItems, receive: TradeItems, bounds: TradeExpiryBounds) {
        let choice = draft.expiry ?? .preset(hours: bounds.defaultHours)
        let candidates = TradeExpiry.releaseCandidates(
            (give.movies + receive.movies).map { ($0.movieID, $0.displayTitle, $0.releaseDate) }, bounds: bounds
        )
        let expiry: TradeExpiryRequest
        switch TradeExpiry.resolve(choice, candidates: candidates, bounds: bounds) {
        case .success(let request): expiry = request
        case .failure(let error):
            Announcer.announce(error.message)
            return
        }
        let trimmed = draft.message.trimmingCharacters(in: .whitespacesAndNewlines)
        let message = trimmed.isEmpty ? nil : trimmed
        let leagueID = season.season.id
        let partner = partner
        submit.run {
            switch mode {
            case .propose:
                try await season.trades.propose(ProposeTrade(
                    leagueID: leagueID, recipientTeamID: partner.id, give: give, receive: receive, message: message, expiry: expiry
                ))
                Announcer.announce("Trade proposed to \(partner.name).")
            case .counter(let id):
                try await season.trades.counter(CounterTrade(offerID: id, give: give, receive: receive, message: message, expiry: expiry))
                Announcer.announce("Counter-offer sent to \(partner.name).")
            }
            router.sheetHasUnsavedInput = false
            router.dismissSheet()
        }
    }
}

// MARK: - Expiry

/// "Offer expires": presets, until a movie releases, a custom time, or never.
private struct TradeExpiryPicker: View {
    @Binding var choice: TradeExpiryChoice?
    let movies: [TradeMovieItem]
    let bounds: TradeExpiryBounds

    @State private var customDate = Date()

    private enum Option: Hashable {
        case preset(Int)
        case release(MovieID)
        case custom
        case none
    }

    var body: some View {
        let candidates = TradeExpiry.releaseCandidates(movies.map { ($0.movieID, $0.displayTitle, $0.releaseDate) }, bounds: bounds)
        let releaseOptions = (try? candidates.get()) ?? []
        let current = choice ?? .preset(hours: bounds.defaultHours)
        FRCard {
            VStack(alignment: .leading, spacing: 10) {
                Picker("Offer expires", selection: Binding(
                    get: { option(for: current, releaseOptions: releaseOptions) },
                    set: { choice = makeChoice(for: $0) }
                )) {
                    ForEach(bounds.presets, id: \.self) { hours in
                        Text("In \(TradeExpiryBounds.label(hours: hours))").tag(Option.preset(hours))
                    }
                    ForEach(releaseOptions) { candidate in
                        Text("When \(candidate.title) releases").tag(Option.release(candidate.movieID))
                    }
                    Text("Custom time…").tag(Option.custom)
                    Text("No expiry").tag(Option.none)
                }
                .pickerStyle(.menu)
                .frFont(.rowLabel)
                .tint(Color.frGold)
                if case .custom = current {
                    DatePicker(
                        "Expires at",
                        selection: $customDate,
                        in: Date().addingTimeInterval(TimeInterval(bounds.minMinutes) * 60)...Date().addingTimeInterval(TimeInterval(bounds.maxDays) * 86_400)
                    )
                    .onChange(of: customDate) { _, date in choice = .custom(date) }
                }
                Text(summary(current, candidates: candidates))
                    .frFont(.caption)
                    .foregroundStyle(Color.frTextSecondary)
                if case .failure(let reason) = candidates, case .release = current {
                    Text(reason.reason)
                        .frFont(.caption)
                        .foregroundStyle(Color.frError)
                }
            }
        }
    }

    private func option(for choice: TradeExpiryChoice, releaseOptions: [TradeReleaseCandidate]) -> Option {
        switch choice {
        case .preset(let hours): .preset(hours)
        case .release(let id): .release(id ?? releaseOptions.first?.movieID ?? MovieID(""))
        case .custom: .custom
        case .none: .none
        }
    }

    private func makeChoice(for option: Option) -> TradeExpiryChoice {
        switch option {
        case .preset(let hours): return .preset(hours: hours)
        case .release(let id): return .release(movieID: id)
        case .custom:
            customDate = Date().addingTimeInterval(TimeInterval(bounds.defaultHours) * 3600)
            return .custom(customDate)
        case .none: return .none
        }
    }

    private func summary(_ choice: TradeExpiryChoice, candidates: Result<[TradeReleaseCandidate], TradeExpiry.ReleaseUnavailable>) -> String {
        switch TradeExpiry.resolve(choice, candidates: candidates, bounds: bounds) {
        case .success(let request):
            return request.expiresAt.map { "Expires \(TradeExpiry.absolute($0))" } ?? "This offer will stand until answered."
        case .failure(let error):
            return error.message
        }
    }
}
