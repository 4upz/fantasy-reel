import FantasyReelCore
import SwiftUI

/// Standings tab: ranked teams with ties, summary strip, projected view (F-14, F-19).
struct StandingsView: View {
    var body: some View {
        FeaturePlaceholderView(title: "Standings", requirements: "F-14, F-19", systemImage: "trophy")
    }
}

/// One team's movies, pickups and counterpicks (F-14).
struct TeamDetailView: View {
    let teamID: TeamID

    var body: some View {
        FeaturePlaceholderView(title: "Team", requirements: "F-14", systemImage: "person.2", showsHeader: false)
    }
}
