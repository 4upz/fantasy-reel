import Foundation

/// A movie's projected Tomatometer (Beta, F-19), as `get-movie-projections`
/// returns it. Only reached through that function, which applies the server's
/// feature gate; a released and scored movie never has one.
public struct MovieProjection: Codable, Sendable, Hashable {
    public struct Contribution: Codable, Sendable, Hashable {
        public var factor: String
        public var label: String
        /// Tomatometer points from the genre baseline.
        public var deltaRT: Double

        public init(factor: String, label: String, deltaRT: Double) {
            self.factor = factor
            self.label = label
            self.deltaRT = deltaRT
        }

        public enum CodingKeys: String, CodingKey {
            case factor
            case label
            case deltaRT = "delta_rt"
        }
    }

    public struct EarlyRT: Codable, Sendable, Hashable {
        public var score: Double
        public var reviews: Int

        public init(score: Double, reviews: Int) {
            self.score = score
            self.reviews = reviews
        }
    }

    public var tmdbID: TMDbID
    /// Point estimate, 0–100.
    public var projectedRT: Double
    /// The middle 50% of likely outcomes.
    public var range50: [Double]
    public var range80: [Double]
    public var lowConfidence: Bool
    public var insufficientHistory: Bool
    public var pRotten: Double
    public var pFresh: Double
    public var p90: Double
    /// Already under the league's 90+ rule. A counterpick scores its negation.
    public var expectedPoints: Double
    public var baselineRT: Double
    public var contributions: [Contribution]
    public var coverage: Double
    public var partial: Bool
    public var includesEarlyReviews: Bool
    public var earlyRT: EarlyRT?
    public var computedAt: Date?

    public init(
        tmdbID: TMDbID,
        projectedRT: Double,
        range50: [Double],
        range80: [Double],
        lowConfidence: Bool = false,
        insufficientHistory: Bool = false,
        pRotten: Double = 0,
        pFresh: Double = 0,
        p90: Double = 0,
        expectedPoints: Double = 0,
        baselineRT: Double = 0,
        contributions: [Contribution] = [],
        coverage: Double = 1,
        partial: Bool = false,
        includesEarlyReviews: Bool = false,
        earlyRT: EarlyRT? = nil,
        computedAt: Date? = nil
    ) {
        self.tmdbID = tmdbID
        self.projectedRT = projectedRT
        self.range50 = range50
        self.range80 = range80
        self.lowConfidence = lowConfidence
        self.insufficientHistory = insufficientHistory
        self.pRotten = pRotten
        self.pFresh = pFresh
        self.p90 = p90
        self.expectedPoints = expectedPoints
        self.baselineRT = baselineRT
        self.contributions = contributions
        self.coverage = coverage
        self.partial = partial
        self.includesEarlyReviews = includesEarlyReviews
        self.earlyRT = earlyRT
        self.computedAt = computedAt
    }

    public enum CodingKeys: String, CodingKey {
        case tmdbID = "tmdb_id"
        case projectedRT = "projected_rt"
        case range50
        case range80
        case lowConfidence = "low_confidence"
        case insufficientHistory = "insufficient_history"
        case pRotten = "p_rotten"
        case pFresh = "p_fresh"
        case p90 = "p_90"
        case expectedPoints = "expected_points"
        case baselineRT = "baseline_rt"
        case contributions
        case coverage
        case partial
        case includesEarlyReviews = "includes_early_reviews"
        case earlyRT = "early_rt"
        case computedAt = "computed_at"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tmdbID = try c.decode(TMDbID.self, forKey: .tmdbID)
        projectedRT = try c.decodeRequiredNumeric(forKey: .projectedRT)
        range50 = try c.decode([Double].self, forKey: .range50, default: [])
        range80 = try c.decode([Double].self, forKey: .range80, default: [])
        lowConfidence = try c.decode(Bool.self, forKey: .lowConfidence, default: false)
        insufficientHistory = try c.decode(Bool.self, forKey: .insufficientHistory, default: false)
        pRotten = try c.decodeNumeric(forKey: .pRotten) ?? 0
        pFresh = try c.decodeNumeric(forKey: .pFresh) ?? 0
        p90 = try c.decodeNumeric(forKey: .p90) ?? 0
        expectedPoints = try c.decodeNumeric(forKey: .expectedPoints) ?? 0
        baselineRT = try c.decodeNumeric(forKey: .baselineRT) ?? 0
        contributions = try c.decode([Contribution].self, forKey: .contributions, default: [])
        coverage = try c.decodeNumeric(forKey: .coverage) ?? 0
        partial = try c.decode(Bool.self, forKey: .partial, default: false)
        includesEarlyReviews = try c.decode(Bool.self, forKey: .includesEarlyReviews, default: false)
        earlyRT = try c.decodeIfPresent(EarlyRT.self, forKey: .earlyRT)
        computedAt = try? c.decodeIfPresent(Date.self, forKey: .computedAt)
    }

    /// The 50% range's ends, or the point estimate twice when it is malformed.
    var range50Bounds: (low: Double, high: Double) { Self.bounds(range50, fallback: projectedRT) }
    public var range80Bounds: (low: Double, high: Double) { Self.bounds(range80, fallback: projectedRT) }

    private static func bounds(_ range: [Double], fallback: Double) -> (low: Double, high: Double) {
        guard range.count == 2 else { return (fallback, fallback) }
        return (range[0], range[1])
    }
}

/// `get-movie-projections`' answer: off (render nothing), or projections keyed
/// by TMDb id, any of which can be null (render nothing for that movie).
public enum MovieProjectionsResponse: Sendable, Hashable, Decodable {
    case disabled
    case enabled(modelVersion: Int, projections: [TMDbID: MovieProjection])

    private enum CodingKeys: String, CodingKey {
        case enabled
        case modelVersion = "model_version"
        case projections
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard try c.decode(Bool.self, forKey: .enabled, default: false) else {
            self = .disabled
            return
        }
        let raw = try c.decode([String: MovieProjection?].self, forKey: .projections, default: [:])
        var projections: [TMDbID: MovieProjection] = [:]
        for (key, value) in raw {
            if let id = Int(key), let value { projections[TMDbID(id)] = value }
        }
        self = .enabled(modelVersion: try c.decodeInteger(forKey: .modelVersion) ?? 0, projections: projections)
    }

    /// The projection for one movie, when the league has projections on and
    /// the movie has one.
    public func projection(for tmdbID: TMDbID) -> MovieProjection? {
        guard case .enabled(_, let projections) = self else { return nil }
        return projections[tmdbID]
    }
}

/// How a projection reads on screen, ported from the web's `utils/projections.ts`.
public enum ProjectionText {
    public static let breakEven: Double = 60
    /// A middle-50% range wider than this is no help as a range.
    public static let maxRangeWidth: Double = 10
    public static let disclaimer =
        "Projections are a Beta estimate from genre, filmmakers, cast and franchise history. They never count toward your total."
    public static let rangeExplainer =
        "The range is the middle half of likely outcomes: about half of real scores should land inside it."
    private static let maxNamedFactors = 5

    public enum ChipState: Sendable, Hashable {
        case early(score: Int, reviews: Int)
        case insufficient
        case range(low: Int, high: Int)
        case point(value: Int, lowConfidence: Bool)
    }

    public enum Tone: Sendable, Hashable {
        case fresh, rotten, uncertain
    }

    public struct Factor: Sendable, Hashable, Identifiable {
        public var key: String
        public var label: String
        public var delta: Double
        public var id: String { key }
    }

    public struct BarSegment: Sendable, Hashable, Identifiable {
        public var key: String
        /// Percent of the 0–100 bar.
        public var start: Double
        public var width: Double
        public var positive: Bool
        public var id: String { key }
    }

    /// Early reviews win; then "not enough history"; then a tight range, or
    /// the point estimate when the range is too wide or rounds to one value.
    public static func chipState(_ projection: MovieProjection) -> ChipState {
        if let early = projection.earlyRT {
            return .early(score: Int(JSMath.round(early.score)), reviews: early.reviews)
        }
        if projection.insufficientHistory { return .insufficient }
        let (low, high) = projection.range50Bounds
        let wide = projection.lowConfidence || high - low > maxRangeWidth
        let roundedLow = Int(JSMath.round(low))
        let roundedHigh = Int(JSMath.round(high))
        if wide || roundedLow == roundedHigh {
            return .point(value: Int(JSMath.round(projection.projectedRT)), lowConfidence: wide)
        }
        return .range(low: roundedLow, high: roundedHigh)
    }

    /// "Proj. 68–79%", "Proj. 74%", "Early RT 88% (24 reviews)".
    public static func chipLabel(_ state: ChipState) -> String {
        switch state {
        case .early(let score, let reviews):
            return "Early RT \(score)% (\(reviews) \(reviews == 1 ? "review" : "reviews"))"
        case .insufficient:
            return "Not enough history yet"
        case .range(let low, let high):
            return "Proj. \(low)–\(high)%"
        case .point(let value, _):
            return "Proj. \(value)%"
        }
    }

    /// The chip as VoiceOver should say it.
    public static func chipSpokenLabel(_ state: ChipState) -> String {
        switch state {
        case .early(let score, let reviews):
            return "Early Rotten Tomatoes score \(score)%, \(reviews) \(reviews == 1 ? "review" : "reviews")"
        case .insufficient:
            return "Projected score: not enough history yet"
        case .range(let low, let high):
            return "Projected \(low) to \(high)%"
        case .point(let value, _):
            return "Projected about \(value)%"
        }
    }

    /// Gold at or above break-even, crimson below, neutral for a loose guess.
    public static func tone(_ projection: MovieProjection, state: ChipState? = nil) -> Tone {
        let state = state ?? chipState(projection)
        switch state {
        case .insufficient, .point(_, true):
            return .uncertain
        case .early(let score, _):
            return Double(score) >= breakEven ? .fresh : .rotten
        default:
            return projection.projectedRT >= breakEven ? .fresh : .rotten
        }
    }

    /// The breakdown's big number: "74%", "68–79%", "~74%".
    public static func headline(_ state: ChipState, projection: MovieProjection) -> String {
        switch state {
        case .early(let score, _): return "\(score)%"
        case .range(let low, let high): return "\(low)–\(high)%"
        case .point(let value, _): return "~\(value)%"
        case .insufficient: return "~\(Int(JSMath.round(projection.projectedRT)))%"
        }
    }

    public static func spokenHeadline(_ state: ChipState, projection: MovieProjection) -> String {
        switch state {
        case .early(let score, _): return "\(score)%"
        case .range(let low, let high): return "\(low) to \(high)%"
        case .point(let value, _): return "about \(value)%"
        case .insufficient: return "about \(Int(JSMath.round(projection.projectedRT)))%"
        }
    }

    /// What the holder scores: a counterpick scores the negation.
    public static func projectedPoints(_ projection: MovieProjection, counterpick: Bool = false) -> Double {
        counterpick ? -projection.expectedPoints : projection.expectedPoints
    }

    /// "12%" for a probability; never "0%" or "100%".
    public static func chance(_ probability: Double) -> String {
        let percent = Int(JSMath.round(probability * 100))
        if percent <= 0 { return "<1%" }
        if percent >= 100 { return ">99%" }
        return "\(percent)%"
    }

    /// Largest contributions first, the tail folded into "Other factors".
    public static func factors(_ projection: MovieProjection) -> [Factor] {
        let sorted = projection.contributions
            .filter { abs($0.deltaRT) >= 0.05 }
            .map { Factor(key: $0.factor, label: $0.label, delta: $0.deltaRT) }
            .sorted { abs($0.delta) > abs($1.delta) }
        guard sorted.count > maxNamedFactors else { return sorted }
        let named = Array(sorted.prefix(maxNamedFactors - 1))
        let rest = sorted.dropFirst(maxNamedFactors - 1).reduce(0) { $0 + $1.delta }
        return named + [Factor(key: "other", label: "Other factors", delta: rest)]
    }

    /// The stacked bar: the baseline from 0, then each factor walking the
    /// total up or down from where the last one left it.
    public static func barSegments(baseline: Double, factors: [Factor]) -> [BarSegment] {
        func clamp(_ value: Double) -> Double { min(100, max(0, value)) }
        var segments = [BarSegment(key: "baseline", start: 0, width: clamp(baseline), positive: true)]
        var cursor = baseline
        for factor in factors {
            let next = cursor + factor.delta
            let start = clamp(min(cursor, next))
            let width = clamp(max(cursor, next)) - start
            if width > 0 { segments.append(BarSegment(key: factor.key, start: start, width: width, positive: factor.delta >= 0)) }
            cursor = next
        }
        return segments
    }
}
