#if DEBUG
import SwiftUI

/// A Debug-only page for checking the motion and haptics foundations on a
/// simulator or a phone: an empty state with a stand-in illustration that
/// settles in, a number rolling at each motion tier, and every haptic in the
/// map. Also the `motionFoundations` screenshot scene.
///
/// The card illustration is a stand-in drawn with shapes. The real Marquee
/// art comes from the illustration work (docs/IOS-DELIGHT-PLAN.md, D-art).
struct MotionFoundationsGallery: View {
    @State private var visit = 0
    @State private var points = 28
    @State private var hapticTaps = 0
    @State private var lastHaptic: FRHaptic?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                ScreenHeader("Motion and haptics", subtitle: "Design system foundations")

                EmptyStateView(
                    title: "No pending trades",
                    message: "Have a swap in mind? Propose a trade to another team.",
                    illustration: { settled in TradeCardsStandIn(settled: settled) }
                ) {
                    Button("Replay arrival") { visit += 1 }
                        .buttonStyle(.fr(.secondary, size: .medium))
                }
                // A new scope each replay, so the arrival counts as a new visit.
                .frVisitScope()
                .id(visit)
                .padding(.bottom, 12)

                SectionHeader("Motion tiers")
                FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                    ForEach([FRMotion.feedback, .change, .moment], id: \.self) { tier in
                        TierRow(tier: tier, points: points) {
                            frWithAnimation(tier) { points += 7 }
                        }
                    }
                }
                FRFootnote("Each row rolls the same number with its tier. With Reduce Motion on, the number swaps.")

                SectionHeader("Haptics")
                FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
                    ForEach(FRHaptic.allCases, id: \.self) { haptic in
                        Button {
                            lastHaptic = haptic
                            hapticTaps += 1
                        } label: {
                            HStack {
                                Text(haptic.galleryLabel)
                                    .frFont(.rowLabel)
                                    .foregroundStyle(Color.frText)
                                Spacer(minLength: 8)
                                Text(haptic.galleryFeel)
                                    .frFont(.meta)
                                    .foregroundStyle(Color.frTextSecondary)
                            }
                            .padding(.horizontal, FRMetrics.rowPadding)
                            .frame(minHeight: FRMetrics.minTapTarget + 8)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.frRow)
                    }
                }
                FRFootnote("Tap a row to feel it on a phone. The simulator has no haptics.")
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .background(Color.frBackground)
        .frHaptic(trigger: hapticTaps) { _, _ in lastHaptic }
    }
}

private struct TierRow: View {
    let tier: FRMotion
    let points: Int
    let bump: () -> Void

    var body: some View {
        Button(action: bump) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(tier.galleryLabel)
                        .frFont(.rowLabel)
                        .foregroundStyle(Color.frText)
                    Text(tier.galleryDetail)
                        .frFont(.meta)
                        .foregroundStyle(Color.frTextSecondary)
                }
                Spacer(minLength: 8)
                Text("+\(points)")
                    .frFont(.numberLarge)
                    .foregroundStyle(Color.frGold)
                    .frNumericTransition(value: Double(points))
            }
            .padding(.horizontal, FRMetrics.rowPadding)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.frRow)
        .accessibilityHint("Adds 7 points")
    }
}

/// Stand-in for illustration I1 (two poster cards and a pair of arrows), in
/// parts: the cards slide in from each side and the arrows snap into place.
private struct TradeCardsStandIn: View {
    let settled: Bool

    private static let ivory = FRPalette.fixed(0xF3E9D2)
    private static let blueGray = FRPalette.fixed(0x7FA8C9)

    var body: some View {
        HStack(spacing: 8) {
            card(Color.frCrimson, tilt: -8)
                .offset(x: settled ? 0 : -32)
            Image(systemName: "arrow.left.arrow.right")
                .font(.system(size: 30, weight: .black))
                .foregroundStyle(Color.frGold)
                .scaleEffect(settled ? 1 : 0.5)
            card(Self.blueGray, tilt: 8)
                .offset(x: settled ? 0 : 32)
        }
        .opacity(settled ? 1 : 0)
        .frame(height: 108)
    }

    private func card(_ fill: Color, tilt: Double) -> some View {
        let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        return shape
            .fill(fill)
            .overlay(alignment: .bottom) {
                Circle()
                    .fill(Self.ivory)
                    .frame(width: 46, height: 46)
                    .offset(y: 23)
            }
            .clipShape(shape)
            .overlay(shape.strokeBorder(Self.ivory, lineWidth: 4))
            .frame(width: 72, height: 96)
            .rotationEffect(.degrees(tilt))
    }
}

private extension FRMotion {
    var galleryLabel: String {
        switch self {
        case .feedback: "Feedback"
        case .change: "Change"
        case .moment: "Moment"
        }
    }

    var galleryDetail: String {
        switch self {
        case .feedback: "Answering a tap · 0.2 s"
        case .change: "A value or list updating · 0.35 s"
        case .moment: "A celebration, once · 0.8 s"
        }
    }
}

private extension FRHaptic {
    var galleryLabel: String {
        switch self {
        case .pickSaved: "Pick saved"
        case .yourTurn: "Your turn"
        case .wishlistToggled: "Wishlist save"
        case .bidSubmitted: "Bid placed or cancelled"
        case .amountStepped: "Bid amount step"
        case .limitReached: "Bid limit reached"
        case .tradeSubmitted: "Trade sent"
        case .movieDropped: "Movie dropped"
        case .copied: "Code copied"
        case .leagueMilestone: "League milestone"
        case .actionFailed: "Action failed"
        case .championRevealed: "Champion reveal"
        }
    }

    var galleryFeel: String {
        switch self {
        case .pickSaved, .bidSubmitted, .tradeSubmitted, .movieDropped,
             .copied, .leagueMilestone, .championRevealed:
            "Success"
        case .yourTurn: "Light"
        case .wishlistToggled, .amountStepped: "Selection"
        case .limitReached: "Rigid"
        case .actionFailed: "Error"
        }
    }
}

#Preview("Motion and haptics · dark") {
    MotionFoundationsGallery()
}

#Preview("Motion and haptics · light") {
    MotionFoundationsGallery()
        .preferredColorScheme(.light)
}
#endif
