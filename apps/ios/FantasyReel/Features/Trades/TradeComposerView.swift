import FantasyReelCore
import SwiftUI

/// Trade composer: pick a team, what each side gives, then review (F-13).
struct TradeComposerView: View {
    let recipientTeamID: TeamID?

    var body: some View {
        FeaturePlaceholderView(title: "Propose Trade", requirements: "F-13", systemImage: "arrow.left.arrow.right", showsHeader: false)
    }
}
