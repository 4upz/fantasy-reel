import Foundation

/// One prior film in a movie's franchise (`get-franchise-history`).
public struct FranchiseFilm: Codable, Sendable, Hashable, Identifiable {
    public var tmdbID: TMDbID
    public var title: String
    public var releaseDate: DateOnly?
    public var posterURL: String?
    /// Tomatometer 0–100, or nil when the film has no RT score.
    public var rtScore: Double?

    public var id: TMDbID { tmdbID }

    public init(tmdbID: TMDbID, title: String, releaseDate: DateOnly? = nil, posterURL: String? = nil, rtScore: Double? = nil) {
        self.tmdbID = tmdbID
        self.title = title
        self.releaseDate = releaseDate
        self.posterURL = posterURL
        self.rtScore = rtScore
    }

    public enum CodingKeys: String, CodingKey {
        case tmdbID = "tmdb_id"
        case title
        case releaseDate = "release_date"
        case posterURL = "poster_url"
        case rtScore = "rt_score"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tmdbID = try c.decode(TMDbID.self, forKey: .tmdbID)
        title = try c.decode(String.self, forKey: .title)
        releaseDate = try c.decodeLenientDate(forKey: .releaseDate)
        posterURL = try c.decodeIfPresent(String.self, forKey: .posterURL)
        rtScore = try c.decodeNumeric(forKey: .rtScore)
    }
}

/// The Tomatometer record of the films before this one in its TMDb collection
/// (the web's `FranchiseHistory`). The endpoint answers null for a standalone
/// movie or the first of a series, which is "no history", not an error.
public struct FranchiseHistory: Codable, Sendable, Hashable {
    public var collectionID: Int
    public var collectionName: String
    /// Where this movie falls in the series by release order, 1-based.
    public var entryNumber: Int
    /// Prior released films, oldest first (capped to the most recent eight).
    public var films: [FranchiseFilm]
    public var averageRT: Double?
    public var lastRT: Double?

    public init(
        collectionID: Int,
        collectionName: String,
        entryNumber: Int,
        films: [FranchiseFilm],
        averageRT: Double? = nil,
        lastRT: Double? = nil
    ) {
        self.collectionID = collectionID
        self.collectionName = collectionName
        self.entryNumber = entryNumber
        self.films = films
        self.averageRT = averageRT
        self.lastRT = lastRT
    }

    public enum CodingKeys: String, CodingKey {
        case collectionID = "collection_id"
        case collectionName = "collection_name"
        case entryNumber = "entry_number"
        case films
        case averageRT = "average_rt"
        case lastRT = "last_rt"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        collectionID = try c.decodeInteger(forKey: .collectionID) ?? 0
        collectionName = try c.decode(String.self, forKey: .collectionName)
        entryNumber = try c.decodeInteger(forKey: .entryNumber) ?? 1
        films = try c.decode([FranchiseFilm].self, forKey: .films, default: [])
        averageRT = try c.decodeNumeric(forKey: .averageRT)
        lastRT = try c.decodeNumeric(forKey: .lastRT)
    }

    /// Prior films with a Tomatometer.
    public var scoredFilms: [FranchiseFilm] { films.filter { $0.rtScore != nil } }

    /// How many scored prior films landed at or above the 60% break-even.
    public var filmsAboveBreakEven: Int {
        scoredFilms.filter { ($0.rtScore ?? 0) >= FranchiseText.breakEven }.count
    }

    /// What this pick would score at the series average under the season's
    /// rule. Hypothetical: never actual points (F-06).
    public func pointsAtSeriesAverage(doublePointsOver90: Bool) -> Double? {
        averageRT.map { FantasyPoints.fantasyPointsForTomatometer($0, doublePointsOver90: doublePointsOver90) }
    }
}

/// `get-franchise-history`'s body: histories keyed by TMDb id as a string.
public struct FranchiseHistoriesResponse: Codable, Sendable {
    public var histories: [String: FranchiseHistory?]

    public init(histories: [String: FranchiseHistory?]) {
        self.histories = histories
    }

    /// Re-keyed by `TMDbID`. Ids the server didn't answer for are absent; an
    /// id with no franchise maps to nil.
    public var byTMDbID: [TMDbID: FranchiseHistory?] {
        var result: [TMDbID: FranchiseHistory?] = [:]
        for (key, value) in histories {
            if let id = Int(key) { result[TMDbID(id)] = value }
        }
        return result
    }
}

/// Franchise wording, ported from the web's `utils/franchise.ts`.
public enum FranchiseText {
    /// Points are RT − 60, so 60 is where a film starts earning.
    public static let breakEven: Double = 60

    /// "1st", "2nd", "3rd", "4th", "11th", "22nd".
    public static func ordinal(_ n: Int) -> String {
        let mod100 = n % 100
        if (11...13).contains(mod100) { return "\(n)th" }
        switch n % 10 {
        case 1: return "\(n)st"
        case 2: return "\(n)nd"
        case 3: return "\(n)rd"
        default: return "\(n)th"
        }
    }

    /// The collection name without TMDb's " Collection" suffix ("Shrek").
    public static func seriesName(_ history: FranchiseHistory) -> String {
        let name = history.collectionName
        guard let range = name.range(of: #"\s+collection$"#, options: [.regularExpression, .caseInsensitive]) else {
            return name
        }
        return String(name[..<range.lowerBound])
    }

    /// "5th Shrek film", dropping a leading article ("5th Avengers film").
    public static func entryLabel(_ history: FranchiseHistory) -> String {
        var name = seriesName(history)
        if let range = name.range(of: #"^(the|a|an)\s+"#, options: [.regularExpression, .caseInsensitive]) {
            name.removeSubrange(range)
        }
        return "\(ordinal(history.entryNumber)) \(name) film"
    }

    /// The panel's closing sentence (`FranchiseHistoryPanel`): how many prior
    /// films cleared break-even and what this pick would score at the series
    /// average.
    public static func summary(_ history: FranchiseHistory, doublePointsOver90: Bool) -> String {
        let scored = history.scoredFilms.count
        guard scored > 0 else { return "None of the prior films have a Tomatometer yet." }
        let films = scored == 1 ? "film" : "films"
        var sentence = "\(history.filmsAboveBreakEven) of \(scored) prior \(films) landed above the 60% break-even"
        if let points = history.pointsAtSeriesAverage(doublePointsOver90: doublePointsOver90) {
            sentence += "; at the series average this pick would score \(FantasyPoints.signed(points)) pts"
        }
        return sentence + "."
    }

    /// The Tomatometer as text ("74%"), or "--" when there is none.
    public static func tomatometer(_ score: Double?) -> String {
        guard let score, score.isFinite else { return "--" }
        return "\(Int(JSMath.round(score)))%"
    }
}
