import SwiftUI
import UIKit

/// The app's one set of animation timings (docs/IOS-DELIGHT-PLAN.md, 5.3).
///
/// Every animation picks a tier by what it is for, never its own numbers:
///
/// | Tier | For | Length |
/// | --- | --- | --- |
/// | `.feedback` | Answering a tap: heart fill, amount step | 0.2 s |
/// | `.change` | A value or list updating: score rolls, rows reorder, a banner appears | 0.35 s |
/// | `.moment` | A celebration played once: draft pick lands, champion reveal | 0.8 s |
///
/// Reduce Motion is handled here, not in each screen. Go through
/// `.frAnimation(_:value:)`, `frWithAnimation(_:_:)`, `.frTransition(_:)`,
/// `.frNumericTransition(value:)` or `FRArrival`, and the Reduce Motion
/// version comes for free (see `animation(reduceMotion:)`).
nonisolated enum FRMotion: Sendable {
    case feedback
    case change
    case moment

    /// The animation for this tier with motion allowed.
    var animation: Animation {
        switch self {
        case .feedback: .snappy(duration: 0.2)
        case .change: .snappy(duration: 0.35)
        case .moment: .spring(duration: 0.8, bounce: 0.2)
        }
    }

    /// The animation to use, given the Reduce Motion setting.
    ///
    /// With Reduce Motion on, feedback and changes happen instantly (a rolling
    /// number just swaps, a reordered row is simply in its new place) and a
    /// moment becomes a short cross-fade. Movement itself must also go: use
    /// `.frTransition(_:)` for views that come and go, and `FRArrival` for
    /// arrival animations, both of which drop the movement on their own.
    func animation(reduceMotion: Bool) -> Animation? {
        guard reduceMotion else { return animation }
        return self == .moment ? FRMotion.fade : nil
    }

    /// Pressing a control: the dimming of a pressed button. Opacity only, so
    /// it stays with Reduce Motion on.
    static var press: Animation { .easeOut(duration: 0.12) }

    /// A cross-fade: the Reduce Motion stand-in for a moment, and for images
    /// fading in once loaded.
    static var fade: Animation { .easeInOut(duration: 0.2) }
}

extension View {
    /// Animates changes to `value` with a motion tier, honoring Reduce Motion.
    ///
    /// ```swift
    /// Text(points, format: .number)
    ///     .frNumericTransition(value: Double(points))
    ///     .frAnimation(.change, value: points)
    /// ```
    func frAnimation<V: Equatable>(_ tier: FRMotion, value: V) -> some View {
        modifier(FRAnimationModifier(tier: tier, value: value))
    }

    /// A transition that moves when motion is allowed and fades with Reduce
    /// Motion on. Pair it with `.frAnimation` or `frWithAnimation`.
    func frTransition(_ transition: AnyTransition) -> some View {
        modifier(FRTransitionModifier(transition: transition))
    }

    /// Digits roll to their new value (`contentTransition(.numericText)`);
    /// with Reduce Motion on they swap.
    func frNumericTransition(value: Double) -> some View {
        modifier(FRNumericTransitionModifier(value: value))
    }
}

/// `withAnimation` with a motion tier, honoring Reduce Motion. For state
/// changed from an action (a button, a store update):
///
/// ```swift
/// frWithAnimation(.change) { showsAll.toggle() }
/// ```
@MainActor
@discardableResult
func frWithAnimation<Result>(_ tier: FRMotion, _ body: () throws -> Result) rethrows -> Result {
    try withAnimation(tier.animation(reduceMotion: UIAccessibility.isReduceMotionEnabled), body)
}

private struct FRAnimationModifier<V: Equatable>: ViewModifier {
    let tier: FRMotion
    let value: V
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.animation(tier.animation(reduceMotion: reduceMotion), value: value)
    }
}

private struct FRTransitionModifier: ViewModifier {
    let transition: AnyTransition
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.transition(reduceMotion ? .opacity : transition)
    }
}

private struct FRNumericTransitionModifier: ViewModifier {
    let value: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.contentTransition(reduceMotion ? .identity : .numericText(value: value))
    }
}
