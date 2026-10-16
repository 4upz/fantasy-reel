import FantasyReelCore
import SwiftUI

/// League movie detail: score, ownership, franchise history, projection, actions (F-06, F-11, F-19).
struct LeagueMovieDetailView: View {
    let tmdbID: TMDbID

    var body: some View {
        FeaturePlaceholderView(title: "Movie", requirements: "F-06, F-19", systemImage: "film", showsHeader: false)
    }
}
