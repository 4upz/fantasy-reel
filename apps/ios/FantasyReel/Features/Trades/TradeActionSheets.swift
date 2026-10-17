import FantasyReelAPI
import FantasyReelCore
import SwiftUI

/// The confirmations an offer card opens.
enum TradeActionSheet: String, Identifiable {
    case accept, veto, approve, extend
    var id: String { rawValue }
}

/// Accept, veto, approve and extend: each confirms before it acts, since none
/// can be undone.
struct TradeActionSheetView: View {
    let offer: TradeOffer
    let sheet: TradeActionSheet

    @Environment(LeagueSeasonStore.self) private var season
    @Environment(\.dismiss) private var dismiss
    @State private var action = AsyncAction()
    @State private var reason = ""
    @State private var extendHours: Int?

    private var trades: TradesStore { season.trades }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                content
                if let message = action.errorMessage {
                    InlineBanner(tone: .error, title: message)
                }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .background(Color.frSheetBackground)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
                    .disabled(action.isRunning)
            }
        }
        .interactiveDismissDisabled(action.isRunning)
        .announcesError(action.errorMessage)
    }

    private var title: String {
        switch sheet {
        case .accept: "Confirm Trade"
        case .veto: "Veto Trade"
        case .approve: "Approve Trade"
        case .extend: "Extend Offer"
        }
    }

    @ViewBuilder
    private var content: some View {
        switch sheet {
        case .accept: accept
        case .veto: veto
        case .approve: approve
        case .extend: extend
        }
    }

    // MARK: Accept

    private var accept: some View {
        let mineIsInitiator = offer.initiatorTeamID == season.myTeam?.id
        let other = mineIsInitiator ? offer.recipientName : offer.initiatorName
        let reviewHours = season.season.tradeReviewEnabled && season.season.tradeVetoHours > 0 ? season.season.tradeVetoHours : nil
        return VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
            Text("Review the trade details before accepting.")
                .frFont(.bodySmall)
                .foregroundStyle(Color.frTextSecondary)
            FRCard {
                VStack(alignment: .leading, spacing: 14) {
                    TradeSideView(
                        title: "You send to \(other)",
                        items: mineIsInitiator ? offer.initiatorItems : offer.recipientItems,
                        contested: offer.contestedSourceIDs, isMine: true
                    )
                    TradeSideView(
                        title: "You receive from \(other)",
                        items: mineIsInitiator ? offer.recipientItems : offer.initiatorItems,
                        contested: offer.contestedSourceIDs, isMine: false
                    )
                }
            }
            InlineBanner(
                tone: .warning,
                title: "This can't be undone",
                message: reviewHours.map { "The trade enters a \($0)-hour review and completes automatically unless the commissioner vetoes it." }
                    ?? "The trade completes in the next few minutes."
            )
            Button(action.isRunning ? "Accepting…" : "Confirm Accept") {
                action.run {
                    _ = try await trades.accept(offer)
                    Announcer.announce("You accepted the trade with \(other).")
                    dismiss()
                }
            }
            .buttonStyle(.fr(.primary, isLoading: action.isRunning))
        }
    }

    // MARK: Veto

    private var veto: some View {
        VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
            Text("Veto the trade between \(offer.initiatorName) and \(offer.recipientName)?")
                .frFont(.body)
                .foregroundStyle(Color.frText)
            VStack(alignment: .leading, spacing: 6) {
                Text("Reason (optional)")
                    .frFont(.label)
                    .foregroundStyle(Color.frTextSecondary)
                TextField("Explain why you're vetoing this trade…", text: $reason, axis: .vertical)
                    .lineLimit(3...6)
                    .padding(12)
                    .background(Color.frElevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .onChange(of: reason) { _, value in
                        if value.count > 1500 { reason = String(value.prefix(1500)) }
                    }
                Text("Both teams see the reason.")
                    .frFont(.caption)
                    .foregroundStyle(Color.frTextSecondary)
            }
            InlineBanner(tone: .warning, title: "This can't be undone", message: "The trade is cancelled and both teams are notified.")
            Button(action.isRunning ? "Vetoing…" : "Veto Trade") {
                let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
                action.run {
                    try await trades.veto(offer, reason: trimmed.isEmpty ? nil : trimmed)
                    dismiss()
                }
            }
            .buttonStyle(.fr(.destructive, isLoading: action.isRunning))
        }
    }

    // MARK: Approve

    private var approve: some View {
        VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
            Text("Process the trade between \(offer.initiatorName) and \(offer.recipientName) now, without waiting for the review period to end?")
                .frFont(.body)
                .foregroundStyle(Color.frText)
            Text("Movies and budget change hands immediately, and both teams are notified that you approved the trade.")
                .frFont(.bodySmall)
                .foregroundStyle(Color.frTextSecondary)
            if offer.isContested {
                InlineBanner(
                    tone: .info,
                    title: "Contested",
                    message: "A movie in this trade is also in another open offer. Approving settles it here and expires the competing offer."
                )
            }
            InlineBanner(tone: .warning, title: "This can't be undone", message: "The trade can no longer be vetoed once processed.")
            Button(action.isRunning ? "Approving…" : "Approve & Process") {
                action.run {
                    try await trades.approve(offer)
                    await season.refresh()
                    dismiss()
                }
            }
            .buttonStyle(.fr(.primary, isLoading: action.isRunning))
        }
    }

    // MARK: Extend

    @ViewBuilder
    private var extend: some View {
        let bounds = TradeExpiryBounds(league: season.season)
        if let current = offer.expiresAt {
            let presets = bounds.extendPresets(currentExpiry: current)
            let selected = extendHours ?? presets.first
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                Text("Give \(offer.recipientName) more time to answer. An offer can only be extended, never shortened.")
                    .frFont(.bodySmall)
                    .foregroundStyle(Color.frTextSecondary)
                Text("Currently expires \(TradeExpiry.absolute(current))")
                    .frFont(.label)
                    .foregroundStyle(Color.frText)
                if presets.isEmpty {
                    InlineBanner(
                        tone: .info,
                        title: "This offer already runs as long as the league allows, no more than \(bounds.maxDaysText) from now."
                    )
                } else {
                    if offer.expiryAnchor == "movie_release" {
                        InlineBanner(
                            tone: .warning,
                            title: "This offer runs until \(offer.anchorMovieTitle ?? "its movie") releases",
                            message: "Extending it replaces the release with a fixed time, so it stops following the movie's schedule."
                        )
                    }
                    FRSegmentedControl("Extend by", selection: Binding(
                        get: { selected ?? presets[0] },
                        set: { extendHours = $0 }
                    ), options: presets) { hours in
                        Text("+\(TradeExpiryBounds.label(hours: hours))")
                    }
                    if let selected {
                        Text("New expiry: \(TradeExpiry.absolute(current.addingTimeInterval(TimeInterval(selected) * 3600)))")
                            .frFont(.meta)
                            .foregroundStyle(Color.frTextSecondary)
                    }
                    Button(action.isRunning ? "Extending…" : "Extend Offer") {
                        guard let selected else { return }
                        let newExpiry = current.addingTimeInterval(TimeInterval(selected) * 3600)
                        action.run {
                            try await trades.extend(offer, until: newExpiry)
                            dismiss()
                        }
                    }
                    .buttonStyle(.fr(.primary, isLoading: action.isRunning))
                }
            }
        }
    }
}
