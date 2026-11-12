import SwiftUI

/// Remembers which arrival animations have played, so each plays once per
/// visit (docs/IOS-DELIGHT-PLAN.md, 5.3 and 8).
///
/// Without a scope, a visit lasts as long as the app is running: an arrival
/// plays the first time it is seen and never again until relaunch. Put
/// `.frVisitScope()` on a screen that should count each opening as a new
/// visit (a pushed screen or a sheet); arrivals inside it then replay when the
/// screen is next opened. Either way an arrival does not replay on refresh,
/// on returning to a tab, or when an iPhone Duo is opened or closed: those
/// keep the same log.
@MainActor
final class FRArrivalLog {
    /// The app-wide log, used where no `.frVisitScope()` is set.
    static let shared = FRArrivalLog()

    private var played: Set<String> = []

    /// Records `id` as played. Returns `true` only the first time.
    func claim(_ id: String) -> Bool {
        played.insert(id).inserted
    }

    func hasPlayed(_ id: String) -> Bool {
        played.contains(id)
    }
}

extension EnvironmentValues {
    @Entry var frArrivalLog: FRArrivalLog? = nil
}

extension View {
    /// Starts a new visit for arrivals inside this view: they play again each
    /// time the view is created (each time the screen or sheet is opened).
    func frVisitScope() -> some View {
        modifier(FRVisitScope())
    }

    /// Runs `action` once per visit when the view first appears, for a
    /// one-time effect that is not drawn (a haptic on a first view). `id`
    /// names it within the visit; include the season or league when the same
    /// screen can show different ones.
    func frOnArrival(_ id: String, perform action: @escaping () -> Void) -> some View {
        modifier(FROnArrival(id: id, action: action))
    }
}

/// Draws `content` settled, and on the first appearance of the visit animates
/// it there from its arriving state (M9: the parts of an illustration slide
/// and snap into place).
///
/// ```swift
/// FRArrival("trades-empty") { settled in
///     ZStack {
///         Image("Marquee/TradesLeft").offset(x: settled ? 0 : -24)
///         Image("Marquee/TradesRight").offset(x: settled ? 0 : 24)
///     }
///     .opacity(settled ? 1 : 0)
/// }
/// ```
///
/// With Reduce Motion on it is simply settled, with no animation. It never
/// blocks taps, and coming back to it later shows it settled.
@MainActor
struct FRArrival<Content: View>: View {
    private let id: String
    private let tier: FRMotion
    private let content: (_ settled: Bool) -> Content

    @Environment(\.frArrivalLog) private var scopedLog
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var settled: Bool?

    /// - Parameters:
    ///   - id: names this arrival within the visit.
    ///   - tier: `.moment` for illustrations and celebrations, `.change` for
    ///     smaller arrivals like a new card.
    init(_ id: String, tier: FRMotion = .moment, @ViewBuilder content: @escaping (_ settled: Bool) -> Content) {
        self.id = id
        self.tier = tier
        self.content = content
    }

    var body: some View {
        let log = scopedLog ?? .shared
        content(settled ?? (reduceMotion || log.hasPlayed(id)))
            .onAppear {
                guard settled == nil else { return }
                // Claimed even with Reduce Motion on, so turning it off later
                // doesn't replay an arrival already seen.
                if log.claim(id) && !reduceMotion {
                    withAnimation(tier.animation) { settled = true }
                } else {
                    settled = true
                }
            }
    }
}

@MainActor
private struct FRVisitScope: ViewModifier {
    @State private var log = FRArrivalLog()

    func body(content: Content) -> some View {
        content.environment(\.frArrivalLog, log)
    }
}

@MainActor
private struct FROnArrival: ViewModifier {
    let id: String
    let action: () -> Void

    @Environment(\.frArrivalLog) private var scopedLog

    func body(content: Content) -> some View {
        content.onAppear {
            if (scopedLog ?? .shared).claim(id) { action() }
        }
    }
}
