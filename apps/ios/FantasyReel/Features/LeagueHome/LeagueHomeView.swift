import SwiftUI

/// League Home tab: team header, my movies, around the league, phase cards (F-10).
///
/// A completed season shows `CompletedSeasonHomeView` instead (F-16, owned by
/// the league lifecycle work in `Features/LeagueSettings`); F-10 owns the rest.
struct LeagueHomeView: View {
    @Environment(\.leagueSelection) private var selection

    var body: some View {
        if selection?.season.isCompleted == true {
            CompletedSeasonHomeView()
        } else {
            FeaturePlaceholderView(title: "Home", requirements: "F-10", systemImage: "house")
        }
    }
}
