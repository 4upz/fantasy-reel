import SwiftUI

/// Draft tab: setup (order, invites, start), live snake draft, counterpick round (F-08, F-09).
struct DraftView: View {
    var body: some View {
        FeaturePlaceholderView(title: "Draft", requirements: "F-08, F-09", systemImage: "list.number")
    }
}

/// The draft as a read-only record once the season is active (⋯ menu → Draft results).
struct DraftResultsView: View {
    var body: some View {
        FeaturePlaceholderView(title: "Draft Results", requirements: "F-08", systemImage: "list.number", showsHeader: false)
    }
}
