import SwiftUI

/// Owner settings: every F-15 section, end season, start next season, delete (F-15, F-16).
struct LeagueSettingsView: View {
    var body: some View {
        FeaturePlaceholderView(title: "Settings", requirements: "F-15, F-16", systemImage: "gearshape", showsHeader: false)
    }
}

/// Every season of the series with champions (F-16).
struct LeagueHistoryView: View {
    var body: some View {
        FeaturePlaceholderView(title: "History", requirements: "F-16", systemImage: "clock.arrow.circlepath", showsHeader: false)
    }
}
