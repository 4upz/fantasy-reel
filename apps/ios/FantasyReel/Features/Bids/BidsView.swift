import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// What the bid sheet opens on.
enum BidTarget: Hashable {
    /// Pick a movie to bid on (search before the cutoff, contests after).
    case newPickup
    /// Bid on one movie: a new bid, or raise or counter the bids on it.
    case pickup(BiddableMovie)
    /// Pick an opponent's movie to counterpick.
    case newCounterpick
    /// Counterpick one opponent's movie, or raise or counter the bids on it.
    case counterpick(CounterpickOption)
}

/// Bids tab (F-12, mockup V2Bids): budget and the bidding week, then my
/// outbid offers, my leading bids and the league's open contests; History
/// shows settled rounds.
struct BidsView: View {
    private enum Section: Hashable { case active, history }

    @Environment(LeagueSeasonStore.self) private var season
    @Environment(ShellRouter.self) private var router
    @State private var section: Section = .active

    private var bids: BidsStore { season.bids }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                ScreenHeader("Bids", eyebrow: season.season.name)
                FRSegmentedControl("Bids view", selection: $section, options: [.active, .history]) { option in
                    option == .active ? "Active" : "History"
                }
                switch section {
                case .active:
                    LoadStateView(
                        bids.state,
                        loadingLabel: "Loading active bids…",
                        retry: { Task { await bids.refresh() } },
                        content: { snapshot in ActiveBidsContent(snapshot: snapshot) },
                        empty: { EmptyView() }
                    )
                case .history:
                    BidHistoryContent()
                }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .background(Color.frBackground)
        .refreshable {
            await bids.refresh()
            if section == .history { await bids.loadHistory() }
        }
        .leagueTopBarPrimaryAction(.init(accessibilityLabel: "Place bid") {
            router.present(.placeBid(.newPickup))
        })
    }
}

// MARK: - Active

private struct ActiveBidsContent: View {
    let snapshot: BidsStore.Snapshot

    @Environment(LeagueSeasonStore.self) private var season
    @Environment(ShellRouter.self) private var router

    private var bids: BidsStore { season.bids }

    var body: some View {
        let myPickups = bids.myPickupBids
        let myCounterpicks = bids.myCounterpickBids
        let teamID = season.myTeam?.id
        let competingPickups = snapshot.pickupBids.filter { $0.teamID != teamID && $0.status == .active }
        let competingCounterpicks = snapshot.counterpickBids.filter { $0.teamID != teamID && $0.status == .active }
        let outbidPickups = myPickups.filter { $0.status == .outbid }
        let outbidCounterpicks = myCounterpicks.filter { $0.status == .outbid }
        let leadingPickups = myPickups.filter { $0.status == .active }
        let leadingCounterpicks = myCounterpicks.filter { $0.status == .active }

        BudgetCard(snapshot: snapshot)
        if let message = bids.cancelling.errorMessage {
            InlineBanner(tone: .error, title: message)
        }

        if !outbidPickups.isEmpty || !outbidCounterpicks.isEmpty {
            SectionHeader("Action required", detail: String(outbidPickups.count + outbidCounterpicks.count))
            FRRowGroup {
                ForEach(outbidPickups) { PickupBidRow(bid: $0) }
                ForEach(outbidCounterpicks) { CounterpickBidRow(bid: $0) }
            }
        }

        if !leadingPickups.isEmpty || !leadingCounterpicks.isEmpty {
            if canReorder(myPickups.count, myCounterpicks.count) {
                SectionHeader("My active bids", actionTitle: "Priorities") { router.push(.bidPriorities) }
            } else {
                SectionHeader("My active bids", detail: String(leadingPickups.count + leadingCounterpicks.count))
            }
            FRRowGroup {
                ForEach(leadingPickups) { PickupBidRow(bid: $0) }
                ForEach(leadingCounterpicks) { CounterpickBidRow(bid: $0) }
            }
        } else if !outbidPickups.isEmpty, canReorder(myPickups.count, myCounterpicks.count) {
            Button("Edit bid priority") { router.push(.bidPriorities) }
                .buttonStyle(.fr(.secondary, size: .compact))
        }

        if !myPickups.isEmpty || !myCounterpicks.isEmpty {
            Text(snapshot.week.isCounterBidPhase()
                ? "Bids are locked in until this week's bids process. You're charged only if you win."
                : "Touch and hold one of your bids to cancel it. You're charged only if you win.")
                .frFont(.caption)
                .foregroundStyle(Color.frTextSecondary)
                .padding(.horizontal, 16)
        }

        if !competingPickups.isEmpty || !competingCounterpicks.isEmpty {
            SectionHeader("Open contests", detail: String(competingPickups.count + competingCounterpicks.count))
            FRRowGroup {
                ForEach(competingPickups) { PickupBidRow(bid: $0) }
                ForEach(competingCounterpicks) { CounterpickBidRow(bid: $0) }
            }
        }

        if myPickups.isEmpty, myCounterpicks.isEmpty, competingPickups.isEmpty, competingCounterpicks.isEmpty {
            EmptyStateView(
                title: "No active bids",
                message: "Place a bid on upcoming movies to add them to your roster."
                    + (season.season.biddingCounterpickSlots > 0
                        ? " Or place a counterpick bid to bet against opponent movies."
                        : " Movies are awarded to the highest bidder when bidding closes."),
                systemImage: "tag"
            )
        }

        if !snapshot.pickupBids.isEmpty || !snapshot.counterpickBids.isEmpty { TMDbAttribution() }
    }

    private func canReorder(_ pickups: Int, _ counterpicks: Int) -> Bool {
        pickups > 1 || (season.season.biddingCounterpickSlots > 0 && counterpicks > 1)
    }
}

/// Budget, capacity and the week, with the bid buttons.
private struct BudgetCard: View {
    let snapshot: BidsStore.Snapshot

    @Environment(LeagueSeasonStore.self) private var season
    @Environment(ShellRouter.self) private var router

    var body: some View {
        let bids = season.bids
        let league = season.season
        let team = season.myTeam
        let budget = team?.budget?.remainingBudget
        let used = team.map { season.holdings(of: $0.id).count } ?? 0
        let counterPhase = snapshot.week.isCounterBidPhase()
        let hasContests = snapshot.pickupBids.contains { $0.status.isPending }
        let canBid = budget != nil && (!counterPhase || hasContests)
        let counterpickSlots = league.biddingCounterpickSlots
        let canCounterpick = budget != nil && counterpickSlots > 0 && snapshot.biddingCounterpickCount < counterpickSlots

        FRCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(budget.map(SeasonFormat.budget) ?? "—")
                                .frFont(.numberHero)
                                .foregroundStyle(Color.frText)
                            Text("available")
                                .frFont(.meta)
                                .foregroundStyle(Color.frTextSecondary)
                        }
                        if bids.amountInOpenBids > 0 {
                            Text("\(SeasonFormat.budget(bids.amountInOpenBids)) in open bids")
                                .frFont(.meta)
                                .foregroundStyle(Color.frTextSecondary)
                        }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(budgetLabel(budget))
                    Spacer()
                    WeekDeadline(week: snapshot.week)
                }
                StatColumns([
                    StatItem("Roster", value: "\(used)", suffix: "of \(league.totalSlots)", accessibilityLabel: "\(used) of \(league.totalSlots) roster slots used"),
                ] + (counterpickSlots > 0 ? [
                    StatItem(
                        "Counterpicks", value: "\(snapshot.biddingCounterpickCount)", suffix: "of \(counterpickSlots)",
                        accessibilityLabel: "\(snapshot.biddingCounterpickCount) of \(counterpickSlots) bidding counterpick slots used"
                    ),
                ] : []), valueRole: .number)
                WeekTimeline(week: snapshot.week)
                if budget == nil {
                    Text("Your team budget is not available yet. Bidding will be available once it is ready.")
                        .frFont(.caption)
                        .foregroundStyle(Color.frTextSecondary)
                } else if counterPhase, !hasContests {
                    Text("New bids are closed and no movies are currently being bid on.")
                        .frFont(.caption)
                        .foregroundStyle(Color.frTextSecondary)
                }
                HStack(spacing: 12) {
                    Button(counterPhase ? "Counter a Bid" : "Place Bid", systemImage: counterPhase ? "arrow.up.circle" : "plus") {
                        router.present(.placeBid(.newPickup))
                    }
                    .buttonStyle(.fr(.primary, size: .medium, fullWidth: true))
                    .disabled(!canBid)
                    if canCounterpick {
                        Button("Counterpick", systemImage: "scope") {
                            router.present(.placeBid(.newCounterpick))
                        }
                        .buttonStyle(.fr(.secondary, size: .medium, fullWidth: true))
                        .accessibilityLabel("Place counterpick bid")
                    }
                }
            }
        }
    }

    private func budgetLabel(_ budget: Int?) -> String {
        guard let budget else { return "Fantasy Budget not available yet" }
        let open = season.bids.amountInOpenBids
        return "\(budget) dollars of Fantasy Budget available" + (open > 0 ? ", \(open) dollars in open bids" : "")
    }
}

/// "New bids close Thu 8:00 PM" / "Counter bids only".
private struct WeekDeadline: View {
    let week: BidWeek

    var body: some View {
        if let cutoff = week.cutoffAt {
            VStack(alignment: .trailing, spacing: 2) {
                Text(week.isCounterBidPhase() ? "Counter bids only" : "New bids close")
                    .frFont(.caption)
                    .foregroundStyle(Color.frTextSecondary)
                Text(BidTiming.shortDeadline(week.isCounterBidPhase() ? (week.processingDeadline ?? cutoff) : cutoff))
                    .frFont(.label)
                    .foregroundStyle(week.isCounterBidPhase() ? Color.frWarning : Color.frText)
            }
            .accessibilityElement(children: .combine)
        } else if let deadline = week.processingDeadline {
            VStack(alignment: .trailing, spacing: 2) {
                Text("Bids process")
                    .frFont(.caption)
                    .foregroundStyle(Color.frTextSecondary)
                Text(BidTiming.shortDeadline(deadline))
                    .frFont(.label)
                    .foregroundStyle(Color.frText)
            }
            .accessibilityElement(children: .combine)
        }
    }
}

/// The week bar: open bidding up to the cutoff notch, then counter bids.
private struct WeekTimeline: View {
    let week: BidWeek

    var body: some View {
        if let fractions = week.fractions(), let cutoff = week.cutoffAt, let deadline = week.processingDeadline {
            let counterPhase = week.isCounterBidPhase()
            VStack(alignment: .leading, spacing: 6) {
                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.frElevated)
                        Capsule().fill(counterPhase ? Color.frWarning : Color.frGold)
                            .frame(width: proxy.size.width * fractions.elapsed)
                        Rectangle().fill(Color.frText)
                            .frame(width: 2, height: 10)
                            .offset(x: proxy.size.width * fractions.cutoff - 1)
                    }
                }
                .frame(height: 6)
                HStack {
                    Text("Open bidding \(counterPhase ? "closed" : "to") \(BidTiming.shortDeadline(cutoff))")
                    Spacer()
                    Text("Counter bids to \(BidTiming.shortDeadline(deadline))")
                }
                .frFont(.caption)
                .foregroundStyle(Color.frTextSecondary)
                if counterPhase {
                    Text("Raise or counter bids on movies already in play. Movies nobody has bid on reopen after this week's bids are processed, and bids placed now can't be withdrawn.")
                        .frFont(.caption)
                        .foregroundStyle(Color.frTextSecondary)
                }
            }
            .accessibilityElement(children: .combine)
        }
    }
}

// MARK: - Rows

/// A pickup bid: mine (outbid or leading) or a rival's leading bid.
private struct PickupBidRow: View {
    let bid: PickupBid

    @Environment(LeagueSeasonStore.self) private var season
    @Environment(ShellRouter.self) private var router
    @State private var confirmingCancel = false

    var body: some View {
        let bids = season.bids
        let isMine = bid.teamID == season.myTeam?.id
        let high = bids.highPickupBid(on: bid.tmdbID)
        let scoreLocked = bids.snapshot?.scoredTMDbIDs.contains(bid.tmdbID) == true
        let canCounter = season.myTeam?.budget != nil && BidEligibility.isBiddable(releaseDate: bid.releaseDate) && !scoreLocked
        let week = bids.snapshot?.week ?? BidWeek(processingDeadline: nil, cutoffAt: nil)
        let canCancel = isMine && week.canCancel(bidProcessingDeadline: bid.processingDeadline)

        BidRowLayout(
            title: bid.title,
            posterURL: bid.posterURL,
            status: status(isMine: isMine),
            meta: meta(isMine: isMine, high: high, scoreLocked: scoreLocked),
            amount: bid.amount,
            amountCaption: isMine ? "your bid" : "high bid",
            actionTitle: canCounter ? actionTitle(isMine: isMine) : nil,
            action: {
                router.present(.placeBid(.pickup(BiddableMovie(
                    tmdbID: bid.tmdbID, title: bid.title, overview: bid.movieData?.overview,
                    releaseDate: bid.releaseDate, posterURL: bid.posterURL
                ))))
            }
        )
        .contextMenu {
            if canCancel {
                Button("Cancel Bid", systemImage: "trash", role: .destructive) { confirmingCancel = true }
            }
        }
        .accessibilityActions {
            if canCancel { Button("Cancel bid") { confirmingCancel = true } }
        }
        .confirmationDialog("Cancel your \(SeasonFormat.budget(bid.amount)) bid on \(bid.title)?", isPresented: $confirmingCancel, titleVisibility: .visible) {
            Button("Cancel Bid", role: .destructive) { bids.cancelling.run { try await bids.cancel(pickup: bid) } }
            Button("Keep Bid", role: .cancel) {}
        } message: {
            Text("This bid will no longer be eligible to win.")
        }
    }

    private func status(isMine: Bool) -> BidRowLayout.Status? {
        guard isMine else { return nil }
        return bid.status == .outbid ? .outbid : .leading
    }

    private func actionTitle(isMine: Bool) -> String {
        if isMine { return bid.status == .outbid ? "Counter" : "Raise" }
        return "Counter"
    }

    private func meta(isMine: Bool, high: PickupBid?, scoreLocked: Bool) -> String {
        if scoreLocked {
            return isMine ? "Already scored, this bid will be cancelled uncharged" : "Already scored, bids on it will be cancelled"
        }
        var parts: [String] = []
        if isMine, bid.status == .outbid {
            parts.append("Yours \(SeasonFormat.budget(bid.amount))")
            if let high { parts.append("High \(SeasonFormat.budget(high.amount))") }
            parts.append("\(BidTiming.timeRemaining(until: bid.responseDeadline)) to counter")
        } else {
            if let date = bid.releaseDate { parts.append(date.formattedShort) }
            parts.append(deadlineText(window: season.bids.counterWindow(forPickup: bid.tmdbID)))
        }
        return parts.joined(separator: " · ")
    }

    private func deadlineText(window: Date?) -> String {
        if let window { return "Counter window \(BidTiming.timeRemaining(until: window)) left" }
        let remaining = BidTiming.timeRemaining(until: bid.processingDeadline)
        return remaining == "Processing soon" ? remaining : "Processes in \(remaining)"
    }
}

/// A counterpick bid against another team's movie.
private struct CounterpickBidRow: View {
    let bid: CounterpickBid

    @Environment(LeagueSeasonStore.self) private var season
    @Environment(ShellRouter.self) private var router
    @State private var confirmingCancel = false

    var body: some View {
        let bids = season.bids
        let isMine = bid.teamID == season.myTeam?.id
        let high = bids.highCounterpickBid(on: bid.movieID)
        let canCounter = season.myTeam?.budget != nil && BidEligibility.isBiddable(releaseDate: bid.releaseDate) && !bid.isScoreLocked
        let week = bids.snapshot?.week ?? BidWeek(processingDeadline: nil, cutoffAt: nil)
        let canCancel = isMine && week.canCancel(bidProcessingDeadline: bid.processingDeadline)

        BidRowLayout(
            title: bid.title,
            posterURL: bid.movie?.posterURL,
            status: isMine ? (bid.status == .outbid ? .outbid : .leading) : nil,
            meta: meta(isMine: isMine, high: high),
            amount: bid.amount,
            amountCaption: isMine ? "your bid" : "high bid",
            actionTitle: canCounter ? (isMine && bid.status == .active ? "Raise" : "Counter") : nil,
            action: {
                router.present(.placeBid(.counterpick(CounterpickOption(
                    movieID: bid.movieID, title: bid.title, posterURL: bid.movie?.posterURL, releaseDate: bid.releaseDate,
                    ownerTeamID: bid.targetTeamID,
                    ownerTeamName: bid.targetTeamName ?? season.team(bid.targetTeamID)?.team.name ?? "Unknown team",
                    fantasyPoints: bid.movie?.fantasyPoints
                ))))
            }
        )
        .contextMenu {
            if canCancel {
                Button("Cancel Counterpick Bid", systemImage: "trash", role: .destructive) { confirmingCancel = true }
            }
        }
        .accessibilityActions {
            if canCancel { Button("Cancel bid") { confirmingCancel = true } }
        }
        .confirmationDialog("Cancel your \(SeasonFormat.budget(bid.amount)) counterpick bid on \(bid.title)?", isPresented: $confirmingCancel, titleVisibility: .visible) {
            Button("Cancel Bid", role: .destructive) { bids.cancelling.run { try await bids.cancel(counterpick: bid) } }
            Button("Keep Bid", role: .cancel) {}
        } message: {
            Text("This bid will no longer be eligible to win.")
        }
    }

    private func meta(isMine: Bool, high: CounterpickBid?) -> String {
        if bid.isScoreLocked {
            return isMine ? "Already scored, this bid will be cancelled uncharged" : "Already scored, bids on it will be cancelled"
        }
        var parts = ["Counterpick vs \(bid.targetTeamName ?? season.team(bid.targetTeamID)?.team.name ?? "Unknown team")"]
        if isMine, bid.status == .outbid {
            if let high { parts.append("High \(SeasonFormat.budget(high.amount))") }
            parts.append("\(BidTiming.timeRemaining(until: bid.responseDeadline)) to counter")
        } else if let window = season.bids.counterWindow(forCounterpick: bid.movieID) {
            parts.append("Counter window \(BidTiming.timeRemaining(until: window)) left")
        } else {
            let remaining = BidTiming.timeRemaining(until: bid.processingDeadline)
            parts.append(remaining == "Processing soon" ? remaining : "Processes in \(remaining)")
        }
        return parts.joined(separator: " · ")
    }
}

/// Shared layout of a bid row: poster, title, status and meta, then either an
/// action button (Counter / Raise) or the amount.
private struct BidRowLayout: View {
    enum Status { case outbid, leading }

    let title: String
    let posterURL: String?
    let status: Status?
    let meta: String
    let amount: Int
    let amountCaption: String
    let actionTitle: String?
    let action: () -> Void

    var body: some View {
        // The row reads as one element; its button becomes a VoiceOver action.
        // Two meta lines: the amounts and the deadline are what the row is for.
        MovieRow(title: title, meta: metaLine, posterURL: posterURL, metaLineLimit: 2, accessibilityLabel: spokenLabel) {
            HStack(spacing: 8) {
                if status == .outbid, let actionTitle {
                    Button(actionTitle, action: action)
                        .buttonStyle(.fr(.primary, size: .compact))
                } else {
                    TrailingValue(SeasonFormat.budget(amount), caption: amountCaption)
                    if let actionTitle {
                        Button(actionTitle, action: action)
                            .buttonStyle(.fr(.secondary, size: .compact))
                    }
                }
            }
        }
        .background(status == .outbid ? Color.frWarningTint : Color.clear)
        .accessibilityActions {
            if let actionTitle { Button("\(actionTitle) bid", action: action) }
        }
    }

    private var metaLine: String {
        switch status {
        case .outbid: "Outbid · \(meta)"
        case .leading: "Leading · \(meta)"
        case nil: meta
        }
    }

    private var spokenLabel: String {
        "\(title), \(metaLine), \(amountCaption) \(amount) dollars"
    }
}
