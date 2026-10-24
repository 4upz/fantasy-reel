import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// Trades tab (F-13, mockup V2Trades): offers awaiting me, my open offers,
/// everything open in the league, and settled history.
///
/// "Pending" here is what needs the viewer (an answer, or a commissioner's
/// review); the web's Pending and All Active lists are the same list, which
/// "League" covers.
struct TradesView: View {
    enum Section: Hashable { case pending, mine, league, history }

    @Environment(LeagueSeasonStore.self) private var season
    @Environment(ShellRouter.self) private var router
    @State private var section: Section = .pending
    @State private var didPickInitialSection = false

    private var trades: TradesStore { season.trades }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                ScreenHeader("Trades", eyebrow: season.season.name)
                if !season.season.tradesEnabled {
                    EmptyStateView(
                        title: "Trading is off",
                        message: "The commissioner hasn't turned on trading for this season.",
                        systemImage: "arrow.left.arrow.right"
                    )
                } else {
                    BudgetLine()
                    FRSegmentedControl("Trade lists", selection: $section, options: [.pending, .mine, .league, .history]) { option in
                        Text(title(option))
                    }
                    LoadStateView(
                        trades.state,
                        loadingLabel: "Loading trades…",
                        retry: { Task { await trades.refresh() } },
                        content: { _ in list },
                        empty: { EmptyView() }
                    )
                }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .background(Color.frBackground)
        .bottomActionBar(isPresented: season.season.tradesEnabled && canPropose) {
            Button("Propose Trade", systemImage: "arrow.left.arrow.right") {
                router.present(.proposeTrade(nil))
            }
            .buttonStyle(.fr(.primary, size: .large))
        }
        .refreshable { await trades.refresh() }
        .onChange(of: trades.trades.isEmpty, initial: true) {
            // Open on Mine when nothing waits on me but I have offers out.
            guard !didPickInitialSection, case .loaded = trades.state else { return }
            didPickInitialSection = true
            if pendingForMe.isEmpty, !trades.mine.isEmpty { section = .mine }
        }
    }

    private var canPropose: Bool {
        season.season.status == .active && season.teams.contains { season.canProposeTrade(to: $0.id) }
    }

    /// Offers I must answer, plus reviews when I'm the commissioner.
    private var pendingForMe: [TradeOffer] {
        let isCommissioner = season.isCommissioner
        return trades.pending.filter { offer in
            TradePermissions(offer: offer, myTeamID: season.myTeam?.id, isCommissioner: isCommissioner).canRespond
                || (isCommissioner && offer.status == .review)
        }
    }

    private func title(_ option: Section) -> String {
        switch option {
        case .pending:
            let count = pendingForMe.count
            return count > 0 ? "Pending \(count)" : "Pending"
        case .mine: return "Mine"
        case .league: return "League"
        case .history: return "History"
        }
    }

    @ViewBuilder
    private var list: some View {
        let offers: [TradeOffer] = switch section {
        case .pending: pendingForMe
        case .mine: trades.mine
        case .league: trades.pending
        case .history: trades.history
        }
        if offers.isEmpty {
            EmptyStateView(title: emptyTitle, message: emptyMessage, systemImage: "arrow.left.arrow.right")
        } else {
            LazyVStack(spacing: 12) {
                ForEach(offers) { TradeOfferCard(offer: $0) }
            }
            if offers.contains(where: { !$0.allMovies.isEmpty }) { TMDbAttribution() }
        }
    }

    private var emptyTitle: String {
        switch section {
        case .pending: "Nothing waiting on you"
        case .mine: "You have no active trades"
        case .league: "No active trades in this league"
        case .history: "No trade history yet"
        }
    }

    private var emptyMessage: String? {
        switch section {
        case .pending, .mine: canPropose ? "Propose a trade to swap movies or budget with another team." : nil
        case .league, .history: nil
        }
    }
}

/// "Available budget $54" above the lists.
private struct BudgetLine: View {
    @Environment(LeagueSeasonStore.self) private var season

    var body: some View {
        if season.showsBudget, let team = season.myTeam {
            HStack {
                Text("Available budget")
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
                Spacer()
                Text(team.budget.map { SeasonFormat.budget($0.remainingBudget) } ?? "Unavailable")
                    .frFont(.number)
                    .foregroundStyle(Color.frGold)
            }
            .accessibilityElement(children: .combine)
        }
    }
}

// MARK: - Offer card

/// One offer: who, status, both sides, messages, and the viewer's actions.
struct TradeOfferCard: View {
    let offer: TradeOffer

    @Environment(LeagueSeasonStore.self) private var season
    @Environment(ShellRouter.self) private var router
    @State private var action = AsyncAction()
    @State private var sheet: TradeActionSheet?

    private var trades: TradesStore { season.trades }
    private var myTeamID: TeamID? { season.myTeam?.id }
    private var permissions: TradePermissions {
        TradePermissions(offer: offer, myTeamID: myTeamID, isCommissioner: season.isCommissioner)
    }

    var body: some View {
        FRCard {
            VStack(alignment: .leading, spacing: 14) {
                header
                badges
                if let message = offer.initiatorMessage { quote(offer.initiatorName, message) }
                if let message = offer.responseMessage { quote(offer.recipientName, message) }
                TradeSideView(
                    title: side(isInitiator: true),
                    items: offer.initiatorItems,
                    contested: offer.contestedSourceIDs,
                    isMine: offer.initiatorTeamID == myTeamID
                )
                TradeSideView(
                    title: side(isInitiator: false),
                    items: offer.recipientItems,
                    contested: offer.contestedSourceIDs,
                    isMine: offer.recipientTeamID == myTeamID
                )
                notes
                if let message = action.errorMessage {
                    InlineBanner(tone: .error, title: message)
                }
                if permissions.hasAny { buttons }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Trade offer from \(offer.initiatorName) to \(offer.recipientName)")
        .sheet(item: $sheet) { sheet in
            NavigationStack {
                TradeActionSheetView(offer: offer, sheet: sheet)
            }
            .presentationDetents([.medium, .large])
        }
        .announcesError(action.errorMessage)
    }

    // MARK: Parts

    private var header: some View {
        HStack(spacing: 10) {
            ZStack(alignment: .bottomTrailing) {
                Avatar(name: offer.initiatorName, imageURL: offer.initiatorTeam?.avatarURL, size: .medium)
                Avatar(name: offer.recipientName, imageURL: offer.recipientTeam?.avatarURL, size: .small)
                    .offset(x: 12, y: 6)
            }
            .padding(.trailing, 12)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(offer.initiatorName) → \(offer.recipientName)")
                    .frFont(.rowTitle)
                    .foregroundStyle(Color.frText)
                    .accessibilityLabel("\(offer.initiatorName) to \(offer.recipientName)")
                Text(offer.proposedAt.formatted(.relative(presentation: .named)))
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
            }
            Spacer(minLength: 8)
            FRBadge(offer.status.displayName, tone: statusTone)
        }
    }

    private var statusTone: FRTone {
        switch offer.status {
        case .proposed, .unknown: .info
        case .countered, .review: .warning
        case .accepted, .completed: .success
        case .rejected, .vetoed: .error
        case .cancelled, .expired: .neutral
        }
    }

    @ViewBuilder
    private var badges: some View {
        let expiry = offer.status.awaitsResponse ? offer.expiresAt : nil
        if expiry != nil || offer.isContested {
            HStack(spacing: 8) {
                if let expiry { ExpiryPill(expiresAt: expiry) }
                if offer.isContested {
                    FRBadge("Contested", tone: .warning, systemImage: "exclamationmark.triangle")
                        .accessibilityLabel("Contested. Another open trade wants a movie in this deal. Only the first trade to go through will happen.")
                }
            }
        }
    }

    private func side(isInitiator: Bool) -> String {
        let teamID = isInitiator ? offer.initiatorTeamID : offer.recipientTeamID
        if teamID == myTeamID { return "You give" }
        let otherIsMe = (isInitiator ? offer.recipientTeamID : offer.initiatorTeamID) == myTeamID
        if otherIsMe { return "You get" }
        return "\(isInitiator ? offer.initiatorName : offer.recipientName) gives"
    }

    private func quote(_ name: String, _ message: String) -> some View {
        Text("“\(message)”")
            .frFont(.bodySmall)
            .italic()
            .foregroundStyle(Color.frTextSecondary)
            .accessibilityLabel("\(name): \(message)")
    }

    @ViewBuilder
    private var notes: some View {
        if offer.status == .review, let ends = offer.reviewEndsAt {
            note(
                "Review period ends \(ends.formatted(.relative(presentation: .named)))"
                    + (season.isCommissioner ? ". It processes automatically then. Approve to process it now, or veto to block it." : ""),
                tone: .warning
            )
        }
        if offer.status == .expired,
           let text = offer.expiredReason?.copy(anchorMovieTitle: offer.anchorMovieTitle) ?? offer.vetoReason {
            note("Expired: \(text)", tone: .neutral)
        }
        if offer.status == .vetoed, let reason = offer.vetoReason {
            note("Veto reason: \(reason)", tone: .error)
        }
    }

    private func note(_ text: String, tone: FRTone) -> some View {
        Text(text)
            .frFont(.meta)
            .foregroundStyle(tone == .neutral ? Color.frTextSecondary : tone.foreground)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(tone.background, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    // MARK: Actions

    @ViewBuilder
    private var buttons: some View {
        let permissions = permissions
        VStack(spacing: 8) {
            if permissions.canRespond {
                HStack(spacing: 8) {
                    Button("Counter") { router.present(.counterTrade(offer.id)) }
                        .buttonStyle(.fr(.secondary, size: .medium, fullWidth: true))
                    Button("Accept") { sheet = .accept }
                        .buttonStyle(.fr(.primary, size: .medium, fullWidth: true))
                }
                Button(action.isRunning ? "Rejecting…" : "Reject") {
                    action.run { try await trades.reject(offer) }
                }
                .buttonStyle(.fr(.neutral, size: .medium, fullWidth: true))
            }
            if permissions.canExtend || permissions.canCancel {
                HStack(spacing: 8) {
                    if permissions.canExtend {
                        Button("Extend") { sheet = .extend }
                            .buttonStyle(.fr(.secondary, size: .medium, fullWidth: true))
                    }
                    if permissions.canCancel {
                        Button(action.isRunning ? "Cancelling…" : "Cancel Trade") {
                            action.run { try await trades.cancel(offer) }
                        }
                        .buttonStyle(.fr(.destructive, size: .medium, fullWidth: true))
                    }
                }
            }
            if permissions.canReview {
                HStack(spacing: 8) {
                    Button("Veto…") { sheet = .veto }
                        .buttonStyle(.fr(.destructive, size: .medium, fullWidth: true))
                    Button("Approve Now") { sheet = .approve }
                        .buttonStyle(.fr(.primary, size: .medium, fullWidth: true))
                }
            }
        }
        .disabled(action.isRunning)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Trade actions")
    }
}

/// One side of an offer: its movies and budget.
struct TradeSideView: View {
    let title: String
    let items: TradeItems
    let contested: Set<String>
    /// Items the server refused (`invalid_source_ids`), marked "Can't be traded".
    var invalid: Set<String> = []
    let isMine: Bool

    @Environment(\.projectionStore) private var projections

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .frFont(.overline)
                .foregroundStyle(isMine ? Color.frCrimsonText : Color.frSuccess)
                .accessibilityAddTraits(.isHeader)
            if items.isEmpty {
                Text("Nothing")
                    .frFont(.meta)
                    .italic()
                    .foregroundStyle(Color.frTextMuted)
            }
            ForEach(items.movies) { item in
                MovieRow(
                    title: item.displayTitle, meta: meta(item), posterURL: item.posterURL,
                    accessory: ProjectionAccessory(projections?.projection(forMovie: item.movieID), counterpick: item.isCounterpick)?.view
                )
            }
            if items.budget > 0 {
                HStack(spacing: 6) {
                    Text("+ \(SeasonFormat.budget(items.budget))")
                        .frFont(.number)
                        .foregroundStyle(Color.frGold)
                    Text("budget")
                        .frFont(.meta)
                        .foregroundStyle(Color.frTextSecondary)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func meta(_ item: TradeMovieItem) -> String {
        var parts: [String] = []
        if invalid.contains(item.sourceID) { parts.append("Can't be traded") }
        if item.isCounterpick { parts.append("Counterpick") }
        parts.append(DateOnly.display(item.releaseDate, style: .short))
        if contested.contains(item.sourceID) { parts.append("Also in another trade") }
        return parts.joined(separator: " · ")
    }
}

/// "Expires in 1 day", toned by urgency.
private struct ExpiryPill: View {
    let expiresAt: Date

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            let urgency = TradeExpiry.urgency(expiresAt, now: context.date)
            FRBadge(
                urgency == .lapsed ? "Expired" : "Expires \(expiresAt.formatted(.relative(presentation: .named, unitsStyle: .wide)))",
                tone: tone(urgency),
                systemImage: "clock"
            )
            .accessibilityHint(TradeExpiry.absolute(expiresAt))
        }
    }

    private func tone(_ urgency: TradeExpiry.Urgency) -> FRTone {
        switch urgency {
        case .lapsed, .relaxed: .neutral
        case .urgent: .error
        case .soon: .warning
        }
    }
}
