import FantasyReelCore
import SwiftUI

/// Reorders my pending bids. Priority never decides who wins a contest (the
/// highest bid does); it decides which of my own wins I keep when I win more
/// than I have room or budget for. The cut line forecasts that from the same
/// rules `process-bids` uses (`BidFitForecast`).
struct BidPrioritiesView: View {
    @Environment(LeagueSeasonStore.self) private var season
    @Environment(\.dismiss) private var dismiss
    @State private var pickupOrder: [BidID] = []
    @State private var counterpickOrder: [BidID] = []
    @State private var didLoad = false
    @State private var save = AsyncAction()

    private static let saveFailedMessage = "Could not save priority. Your unsaved changes are still here. Try again."

    private var bids: BidsStore { season.bids }
    private var showsCounterpicks: Bool { season.season.biddingCounterpickSlots > 0 && !bids.myCounterpickBids.isEmpty }

    private var isDirty: Bool {
        pickupOrder != bids.myPickupBids.map(\.id) || counterpickOrder != bids.myCounterpickBids.map(\.id)
    }

    var body: some View {
        List {
            if save.errorMessage != nil {
                InlineBanner(tone: .error, title: Self.saveFailedMessage)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            if !pickupOrder.isEmpty {
                pickupSection
            }
            if showsCounterpicks {
                counterpickSection
            }
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text("How priority works")
                        .frFont(.cardTitle)
                        .foregroundStyle(Color.frText)
                    Text(howItWorks)
                        .frFont(.bodySmall)
                        .foregroundStyle(Color.frTextSecondary)
                }
                .padding(.vertical, 4)
                .listRowBackground(Color.frSurface)
            }
        }
        .listStyle(.insetGrouped)
        .contentMargins(.horizontal, FRMetrics.pageMargin, for: .scrollContent)
        .scrollContentBackground(.hidden)
        .background(Color.frBackground)
        .environment(\.editMode, .constant(.active))
        .navigationTitle("Bid Priorities")
        .navigationBarTitleDisplayMode(.large)
        .navigationBarBackButtonHidden(isDirty)
        .toolbar {
            if isDirty {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { resetOrder() }
                        .disabled(save.isRunning)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(save.isRunning ? "Saving…" : "Save", action: saveOrder)
                        .disabled(save.isRunning)
                }
            }
        }
        .onAppear {
            guard !didLoad else { return }
            resetOrder()
            didLoad = true
        }
        .onChange(of: bids.myPickupBids.map(\.id)) { _, _ in reconcile() }
        .onChange(of: bids.myCounterpickBids.map(\.id)) { _, _ in reconcile() }
        .announcesError(save.errorMessage == nil ? nil : Self.saveFailedMessage)
    }

    // MARK: Pickups

    private var pickupBids: [PickupBid] {
        let byID = Dictionary(uniqueKeysWithValues: bids.myPickupBids.map { ($0.id, $0) })
        return pickupOrder.compactMap { byID[$0] }
    }

    /// How each bid in the shown order would find room if all of them won.
    private var pickupFunding: [BidFunding?] {
        guard let team = season.myTeam else { return pickupBids.map { _ in nil } }
        let holdings = season.holdings(of: team.id)
        let contested = Set(bids.snapshot?.counterpickBids.map(\.movieID) ?? [])
        let droppable = BidFitForecast.droppableHoldingIDs(
            holdings, today: DateOnly.today(),
            counterpicksBlockDrops: season.season.counterpicksBlockDrops,
            contestedMovieIDs: contested
        )
        return BidFitForecast.forecast(
            dropTargets: pickupBids.map(\.conditionalDropHoldingID),
            freeSlots: freeSlots,
            remainingDrops: season.dropsRemaining,
            droppable: Set(droppable)
        )
    }

    private var freeSlots: Int {
        guard let team = season.myTeam else { return 0 }
        return max(season.season.totalSlots - season.holdings(of: team.id).count, 0)
    }

    private var pickupSection: some View {
        let list = pickupBids
        let funding = pickupFunding
        let cutIndex = funding.firstIndex { $0 == nil }
        let slots = freeSlots
        return Section {
            ForEach(Array(list.enumerated()), id: \.element.id) { index, bid in
                PriorityRow(
                    rank: index + 1,
                    count: list.count,
                    title: bid.title,
                    posterURL: bid.posterURL,
                    meta: pickupMeta(bid, funding: funding[index]),
                    fits: funding[index] != nil,
                    cutAbove: index == cutIndex,
                    belowCut: cutIndex.map { index >= $0 } ?? false,
                    cutLabel: "Roster runs out",
                    move: { movePickup(from: index, by: $0) }
                )
            }
            .onMove { pickupOrder.move(fromOffsets: $0, toOffset: $1) }
        } header: {
            Text("Pickups")
        } footer: {
            Text("If these bids win in this order, they use your \(slots) open \(slots == 1 ? "slot" : "slots") first, then eligible drops (\(season.dropsRemaining) left). Budget and other bids can change the result.")
        }
    }

    private func pickupMeta(_ bid: PickupBid, funding: BidFunding?) -> String {
        var parts = [SeasonFormat.budget(bid.amount), bid.status == .outbid ? "Outbid" : "Leading"]
        switch funding {
        case .slot?: parts.append("Uses open slot")
        case .drop?: parts.append("Uses conditional drop")
        case nil: parts.append("No room currently")
        }
        return parts.joined(separator: " · ")
    }

    private func movePickup(from index: Int, by offset: Int) {
        let target = index + offset
        guard pickupOrder.indices.contains(target) else { return }
        pickupOrder.swapAt(index, target)
    }

    // MARK: Counterpicks

    private var counterpickBids: [CounterpickBid] {
        let byID = Dictionary(uniqueKeysWithValues: bids.myCounterpickBids.map { ($0.id, $0) })
        return counterpickOrder.compactMap { byID[$0] }
    }

    private var openCounterpickSlots: Int {
        max(season.season.biddingCounterpickSlots - (bids.snapshot?.biddingCounterpickCount ?? 0), 0)
    }

    private var counterpickSection: some View {
        let list = counterpickBids
        let slots = openCounterpickSlots
        let cutIndex = slots < list.count ? slots : nil
        return Section {
            ForEach(Array(list.enumerated()), id: \.element.id) { index, bid in
                PriorityRow(
                    rank: index + 1,
                    count: list.count,
                    title: bid.title,
                    posterURL: bid.movie?.posterURL,
                    meta: [
                        "vs \(bid.targetTeamName ?? "Unknown team")",
                        SeasonFormat.budget(bid.amount),
                        index < slots ? "Uses open slot" : "No slot currently",
                    ].joined(separator: " · "),
                    fits: index < slots,
                    cutAbove: index == cutIndex,
                    belowCut: cutIndex.map { index >= $0 } ?? false,
                    cutLabel: "Slots run out",
                    move: { moveCounterpick(from: index, by: $0) }
                )
            }
            .onMove { counterpickOrder.move(fromOffsets: $0, toOffset: $1) }
        } header: {
            Text("Counterpicks")
        } footer: {
            Text(slots > 0
                ? "If more of your bids win than you have slots for, you keep the top \(slots)."
                : "Your counterpick slots are full, so these bids will pass to the next-highest bidder.")
        }
    }

    private func moveCounterpick(from index: Int, by offset: Int) {
        let target = index + offset
        guard counterpickOrder.indices.contains(target) else { return }
        counterpickOrder.swapAt(index, target)
    }

    // MARK: Order state

    private var howItWorks: String {
        var text = "The highest bid always wins a movie. Priority only decides which of your own wins you keep when you win more than you have room or budget for. Drag the handles to reorder. Outbid bids can still win if higher bids can't be honored."
        if let deadline = bids.snapshot?.week.processingDeadline {
            text += " Results are final when bids process on \(BidTiming.shortDeadline(deadline))."
        }
        return text
    }

    private func resetOrder() {
        pickupOrder = bids.myPickupBids.map(\.id)
        counterpickOrder = bids.myCounterpickBids.map(\.id)
        save.clearError()
    }

    /// Keeps my edits when bids change underneath (a new bid joins at the
    /// end, a settled or cancelled one leaves).
    private func reconcile() {
        pickupOrder = Self.reconciled(pickupOrder, with: bids.myPickupBids.map(\.id))
        counterpickOrder = Self.reconciled(counterpickOrder, with: bids.myCounterpickBids.map(\.id))
    }

    private static func reconciled(_ order: [BidID], with current: [BidID]) -> [BidID] {
        let live = Set(current)
        let kept = order.filter { live.contains($0) }
        let keptSet = Set(kept)
        return kept + current.filter { !keptSet.contains($0) }
    }

    private func saveOrder() {
        let pickups = pickupOrder != bids.myPickupBids.map(\.id) ? pickupOrder : nil
        let counterpicks = counterpickOrder != bids.myCounterpickBids.map(\.id) ? counterpickOrder : nil
        save.run {
            try await bids.savePriorities(pickups: pickups, counterpicks: counterpicks)
            Announcer.announce("Bid priority saved")
            dismiss()
        }
    }
}

/// One reorderable bid: rank, poster, title and how it would fit.
private struct PriorityRow: View {
    let rank: Int
    let count: Int
    let title: String
    let posterURL: String?
    let meta: String
    let fits: Bool
    /// Draws the cut line above this row: the first bid that wouldn't fit.
    let cutAbove: Bool
    let belowCut: Bool
    let cutLabel: String
    let move: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if cutAbove {
                CutLine(label: cutLabel)
                    .accessibilityHidden(true)
            }
            row
        }
        .padding(.vertical, 4)
        .listRowBackground(Color.frSurface)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Priority \(rank), \(title)")
        .accessibilityValue(belowCut ? "\(meta), below the cut: \(cutLabel.lowercased())" : meta)
        .accessibilityActions {
            if rank > 1 { Button("Move up") { move(-1) } }
            if rank < count { Button("Move down") { move(1) } }
        }
    }

    private var row: some View {
        HStack(spacing: 12) {
            Text("\(rank)")
                .frFont(.number)
                .foregroundStyle(fits ? Color.frGold : Color.frTextMuted)
                .frame(minWidth: 20)
            PosterImage(posterURL: posterURL, title: title)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .frFont(.rowTitle)
                    .foregroundStyle(Color.frText)
                    .lineLimit(2)
                Text(meta)
                    .frFont(.meta)
                    .foregroundStyle(fits ? Color.frTextSecondary : Color.frWarning)
            }
            Spacer(minLength: 0)
        }
    }
}

/// "Roster runs out": bids below it would not fit if every bid above won.
private struct CutLine: View {
    let label: String

    var body: some View {
        HStack(spacing: 8) {
            Rectangle().fill(Color.frWarning).frame(height: 1)
            Text(label)
                .frFont(.captionStrong)
                .foregroundStyle(Color.frWarning)
                .fixedSize()
            Rectangle().fill(Color.frWarning).frame(height: 1)
        }
    }
}
