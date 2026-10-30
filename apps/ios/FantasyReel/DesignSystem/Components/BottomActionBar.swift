import SwiftUI

extension View {
    /// A tab's main action, pinned above the tab bar where the thumb already is
    /// and reachable however far the page scrolls ("Place Bid", "Propose
    /// Trade"). Use it only for the one or two actions the whole tab exists for;
    /// actions on a single row or card stay on that row or card, and the action
    /// is not repeated in the top bar or in the page. Pass the primary action
    /// first: at accessibility text sizes the buttons stack in that order.
    ///
    /// `safeAreaBar` gives the bar the iOS 26 scroll-edge effect, so content
    /// scrolling under it fades out instead of colliding with the buttons.
    func bottomActionBar<Actions: View>(
        isPresented: Bool = true,
        @ViewBuilder actions: () -> Actions
    ) -> some View {
        safeAreaBar(edge: .bottom) {
            if isPresented {
                BottomActionBarContent(actions: actions())
            }
        }
    }
}

/// Side by side, or stacked when two labelled buttons can't share the width.
private struct BottomActionBarContent<Actions: View>: View {
    let actions: Actions

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: 12))
            : AnyLayout(HStackLayout(spacing: 12))
        layout {
            actions
        }
        .padding(.horizontal, FRMetrics.pageMargin)
        .padding(.vertical, 8)
    }
}
