import SwiftUI

/// The app's one haptic map (docs/IOS-DELIGHT-PLAN.md, 5.4), named by what
/// happened rather than by how it feels, so the choice is made once here.
///
/// Haptics confirm **your own** actions. Things other people do never buzz
/// the phone, with one exception: it becoming your turn in a live draft.
/// Never for scrolling, opening screens, switching tabs, values changing
/// because of someone else, or anything that can fire for many rows at once.
/// Every haptic is paired with something visible ("Bid placed", a checkmark).
///
/// There is no in-app switch: iOS's Settings › Sounds & Haptics › System
/// Haptics turns these off.
///
/// ```swift
/// .frHaptic(.bidPlaced, trigger: model.placedBidCount)
/// ```
nonisolated enum FRHaptic: Sendable, CaseIterable {
    /// A draft pick or counterpick was saved.
    case pickSaved
    /// It became your turn in a live draft.
    case yourTurn
    /// A movie was saved to or removed from your wishlist.
    case wishlistToggled
    /// A bid was placed or cancelled.
    case bidSubmitted
    /// The bid amount stepped up or down.
    case amountStepped
    /// The bid amount hit your budget or the league's limit.
    case limitReached
    /// A trade was proposed, accepted or countered.
    case tradeSubmitted
    /// A movie was dropped from your roster.
    case movieDropped
    /// A join code or invite link was copied.
    case copied
    /// A league was created or joined, a season started, or a draft started.
    case leagueMilestone
    /// An action you submitted failed.
    case actionFailed
    /// The champion reveal, on its first view only.
    case championRevealed

    var feedback: SensoryFeedback {
        switch self {
        case .pickSaved, .bidSubmitted, .tradeSubmitted, .movieDropped,
             .copied, .leagueMilestone, .championRevealed:
            .success
        case .yourTurn:
            .impact(weight: .light)
        case .wishlistToggled, .amountStepped:
            .selection
        case .limitReached:
            .impact(flexibility: .rigid)
        case .actionFailed:
            .error
        }
    }
}

extension View {
    /// Plays `haptic` whenever `trigger` changes. Use a value that changes
    /// once per action of yours (a count of saved picks, a sent offer's id),
    /// never one that a refresh or someone else can change.
    func frHaptic<T: Equatable>(_ haptic: FRHaptic, trigger: T) -> some View {
        sensoryFeedback(haptic.feedback, trigger: trigger)
    }

    /// Plays `haptic` when `trigger` changes and `condition(old, new)` holds.
    func frHaptic<T: Equatable>(
        _ haptic: FRHaptic,
        trigger: T,
        condition: @escaping (_ oldValue: T, _ newValue: T) -> Bool
    ) -> some View {
        sensoryFeedback(haptic.feedback, trigger: trigger, condition: condition)
    }

    /// Picks the haptic from the change, or none (`nil`). For a control with
    /// more than one outcome, like a bid stepper that ticks on each step and
    /// knocks at the limit.
    func frHaptic<T: Equatable>(
        trigger: T,
        _ haptic: @escaping (_ oldValue: T, _ newValue: T) -> FRHaptic?
    ) -> some View {
        sensoryFeedback(trigger: trigger) { old, new in haptic(old, new)?.feedback }
    }
}
