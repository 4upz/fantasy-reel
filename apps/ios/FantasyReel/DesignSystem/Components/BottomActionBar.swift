import SwiftUI

extension View {
    /// A tab's main action, pinned above the tab bar where the thumb already is
    /// and reachable however far the page scrolls ("Place Bid", "Propose
    /// Trade"). Use it only for the one or two actions the whole tab exists for;
    /// actions on a single row or card stay on that row or card, and the action
    /// is not repeated in the top bar or in the page.
    ///
    /// `safeAreaBar` gives the bar the iOS 26 scroll-edge effect, so content
    /// scrolling under it fades out instead of colliding with the buttons.
    func bottomActionBar<Actions: View>(
        isPresented: Bool = true,
        @ViewBuilder actions: () -> Actions
    ) -> some View {
        safeAreaBar(edge: .bottom) {
            if isPresented {
                HStack(spacing: 12) {
                    actions()
                }
                .padding(.horizontal, FRMetrics.pageMargin)
                .padding(.vertical, 8)
            }
        }
    }
}
