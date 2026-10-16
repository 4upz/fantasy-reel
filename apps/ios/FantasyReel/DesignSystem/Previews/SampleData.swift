#if DEBUG
import SwiftUI

/// Preview-only sample data, deliberately *not* the FantasyReelCore models so
/// design-system previews don't couple to wire types. Values follow the v2
/// mockups (Popcorn Syndicate, 2026 season).
enum FRSampleData {
    struct Movie: Identifiable, Hashable, Sendable {
        let id: Int
        let title: String
        let meta: String
        let points: Double?
        let preRelease: Bool
        let posterURL: String?
    }

    struct Team: Identifiable, Hashable, Sendable {
        let id: Int
        let rank: String
        let name: String
        let owner: String
        let points: Double
        let isYou: Bool
    }

    static let movies: [Movie] = [
        Movie(id: 1, title: "Street Fighter", meta: "Releases Oct 16 · RT 74%", points: 14, preRelease: true, posterURL: nil),
        Movie(
            id: 2, title: "The Hunger Games: Sunrise on the Reaping", meta: "Releases Nov 20 · Pickup",
            points: nil, preRelease: false, posterURL: nil
        ),
        Movie(id: 3, title: "The Odyssey", meta: "Released Jul 17 · RT 88%", points: 28, preRelease: false, posterURL: nil),
        Movie(id: 4, title: "Supergirl", meta: "Released Jun 26 · RT 56%", points: -4, preRelease: false, posterURL: nil),
        Movie(id: 5, title: "Toy Story 5", meta: "R2 · Jun 19 · RT 81%", points: 21, preRelease: false, posterURL: nil),
    ]

    static let teams: [Team] = [
        Team(id: 1, rank: "1", name: "Nolan's Notebook", owner: "Bob Nolan", points: 131, isYou: false),
        Team(id: 2, rank: "2", name: "Reel Deal", owner: "Alice Spielberg", points: 113, isYou: true),
        Team(id: 3, rank: "T-3", name: "Coppola Cut", owner: "Carol Coppola", points: 98, isYou: false),
        Team(id: 4, rank: "T-3", name: "Kubrick's Cube", owner: "Dave Kubrick", points: 98, isYou: false),
        Team(id: 5, rank: "5", name: "Final Cut Pros", owner: "Eve Lumet", points: 77, isYou: false),
    ]
}

/// A scrolling page in the app's layout for previews: page background, 16pt
/// margins, 12pt section spacing.
struct FRPreviewCanvas<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FRMetrics.sectionSpacing) {
                content
            }
            .padding(FRMetrics.pageMargin)
        }
        .background(Color.frBackground)
    }
}
#endif
