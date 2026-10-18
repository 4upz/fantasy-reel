import SwiftUI

extension View {
    /// For a pushed screen that draws its own large `ScreenHeader`: keeps
    /// `title` as the navigation title (the back button's long-press menu and
    /// VoiceOver's screen name) while showing no duplicate centered title in
    /// the bar, the same way the league tab roots do.
    func headerScreenTitle(_ title: String) -> some View {
        navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text(verbatim: "").accessibilityHidden(true)
                }
            }
    }
}
