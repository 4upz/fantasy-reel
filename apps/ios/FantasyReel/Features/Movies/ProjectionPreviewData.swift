#if DEBUG
import FantasyReelCore
import Foundation

/// Projections (Beta, F-19) for previews and screenshot scenes: a projected
/// Tomatometer from its middle-50% range, with plausible factors and chances.
enum ProjectionPreviewData {
    static func projection(
        _ tmdbID: TMDbID,
        range50: ClosedRange<Double>,
        lowConfidence: Bool = false,
        insufficientHistory: Bool = false,
        earlyRT: MovieProjection.EarlyRT? = nil,
        doublePointsOver90: Bool = false
    ) -> MovieProjection {
        let projected = earlyRT?.score ?? (range50.lowerBound + range50.upperBound) / 2
        let baseline = 61.0
        let rest = projected - baseline
        // Rough chances from where the middle 50% sits against the Fresh line.
        let spread = range50.upperBound - range50.lowerBound + 18
        let pRotten = min(0.97, max(0.03, (60 - range50.lowerBound) / spread))
        return MovieProjection(
            tmdbID: tmdbID,
            projectedRT: projected,
            range50: [range50.lowerBound, range50.upperBound],
            range80: [max(0, range50.lowerBound - 9), min(100, range50.upperBound + 9)],
            lowConfidence: lowConfidence,
            insufficientHistory: insufficientHistory,
            pRotten: pRotten,
            pFresh: 1 - pRotten,
            p90: max(0.005, (range50.upperBound - 82) / 40),
            expectedPoints: FantasyPoints.fantasyPointsForTomatometer(projected, doublePointsOver90: doublePointsOver90),
            baselineRT: baseline,
            contributions: [
                .init(factor: "director", label: "Director", deltaRT: rest * 0.5),
                .init(factor: "collection", label: "Franchise", deltaRT: rest * 0.3),
                .init(factor: "cast", label: "Cast", deltaRT: rest * 0.2),
            ],
            coverage: 0.85,
            includesEarlyReviews: earlyRT != nil,
            earlyRT: earlyRT,
            computedAt: Date().addingTimeInterval(-6 * 3600)
        )
    }

    /// An enabled response over these projections.
    static func response(_ projections: [MovieProjection]) -> MovieProjectionsResponse {
        .enabled(modelVersion: 3, projections: Dictionary(uniqueKeysWithValues: projections.map { ($0.tmdbID, $0) }))
    }
}
#endif
