import FantasyReelCore
import SwiftUI

/// The `.mrow` movie row: 36×54 poster, one-line title, one-line meta (or
/// `metaLineLimit` lines), a fixed 64pt trailing column and an optional chevron. 64pt minimum height (72 for
/// `isHero`), growing with Dynamic Type.
///
/// ```swift
/// Button { open(movie) } label: {
///     MovieRow(title: m.title, meta: "Released Jul 17 · RT 88%", posterURL: m.posterUrl,
///              points: m.fantasyPoints, preRelease: !m.hasReleased, showsChevron: true)
/// }
/// .buttonStyle(.frRow)
/// ```
///
/// VoiceOver reads one element: "Title, meta, points".
struct MovieRow<Trailing: View>: View {
    private let title: String
    private let meta: String?
    private let posterURL: String?
    private let showsChevron: Bool
    private let isHero: Bool
    private let metaLineLimit: Int
    private let accessibilityLabelOverride: String?
    private let trailing: Trailing

    /// A movie row with any trailing view (a price, a Bid button, an RT score).
    init(
        title: String,
        meta: String?,
        posterURL: String?,
        showsChevron: Bool = false,
        isHero: Bool = false,
        metaLineLimit: Int = 1,
        accessibilityLabel: String? = nil,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.title = title
        self.meta = meta
        self.posterURL = posterURL
        self.showsChevron = showsChevron
        self.isHero = isHero
        self.metaLineLimit = metaLineLimit
        self.accessibilityLabelOverride = accessibilityLabel
        self.trailing = trailing()
    }

    var body: some View {
        ListRow(
            title: title,
            meta: meta,
            showsChevron: showsChevron,
            isHero: isHero,
            metaLineLimit: metaLineLimit,
            accessibilityLabel: accessibilityLabelOverride
        ) {
            PosterImage(posterURL: posterURL, title: title)
        } trailing: {
            trailing
        }
    }
}

extension MovieRow where Trailing == PointsTrail {
    /// A movie row with fantasy points in the trailing column.
    init(
        title: String,
        meta: String?,
        posterURL: String?,
        points: Double?,
        preRelease: Bool = false,
        pointsCaption: String? = nil,
        showsChevron: Bool = false,
        isHero: Bool = false
    ) {
        let spoken = FantasyPoints.spokenLabel(points, preRelease: preRelease)
        let label = [title, meta, spoken]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
        self.init(
            title: title, meta: meta, posterURL: posterURL, showsChevron: showsChevron,
            isHero: isHero, accessibilityLabel: label
        ) {
            PointsTrail(points: points, preRelease: preRelease, caption: pointsCaption)
        }
    }
}

extension MovieRow where Trailing == EmptyView {
    /// A movie row with nothing trailing (franchise history, search results).
    init(title: String, meta: String?, posterURL: String?, showsChevron: Bool = false) {
        self.init(title: title, meta: meta, posterURL: posterURL, showsChevron: showsChevron) {
            EmptyView()
        }
    }
}

#if DEBUG
#Preview("Movie rows · dark") {
    FRPreviewCanvas {
        SectionHeader("My movies", actionTitle: "See roster") {}
        FRRowGroup {
            ForEach(FRSampleData.movies) { movie in
                Button {} label: {
                    MovieRow(
                        title: movie.title, meta: movie.meta, posterURL: movie.posterURL,
                        points: movie.points, preRelease: movie.preRelease, showsChevron: true
                    )
                }
                .buttonStyle(.frRow)
            }
        }
    }
}

#Preview("Movie rows · light, AX") {
    FRPreviewCanvas {
        FRRowGroup {
            ForEach(FRSampleData.movies.prefix(3)) { movie in
                MovieRow(
                    title: movie.title, meta: movie.meta, posterURL: movie.posterURL,
                    points: movie.points, preRelease: movie.preRelease
                )
            }
            MovieRow(title: "The Cat in the Hat", meta: "Nov 6 · No bids yet", posterURL: nil) {
                Button("Bid") {}
                    .buttonStyle(.fr(.secondary, size: .compact))
            }
        }
    }
    .preferredColorScheme(.light)
    .environment(\.dynamicTypeSize, .accessibility2)
}
#endif
