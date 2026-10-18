import Foundation
import Testing
@testable import FantasyReelCore

struct MovieResearchDecodingTests {
    @Test func searchPageKeepsUpstreamIdentityAndToleratesBlankDates() throws {
        let json = """
        {"page":2,"total_pages":5,"total_results":91,"total_results_scope":"upstream","has_more":true,
         "results":[
          {"tmdb_id":1,"title":"Dune","overview":"x","release_date":"2026-12-18","poster_url":"https://image.tmdb.org/t/p/w500/a.jpg","vote_average":7.1,"popularity":3,"genre_ids":[878]},
          {"tmdb_id":2,"title":"Untitled","overview":null,"release_date":"","poster_url":null,"vote_average":0,"popularity":0,"genre_ids":[]}
         ]}
        """
        let page = try FRJSON.decode(DiscoveryPage<MovieSearchResult>.self, from: Data(json.utf8))
        #expect(page.page == 2)
        #expect(page.hasMore)
        #expect(page.totalResults == 91)
        #expect(page.results[0].releaseDate == DateOnly(year: 2026, month: 12, day: 18))
        #expect(page.results[1].releaseDate == nil)
    }

    @Test func anEmptyFilteredPageStillAdvances() throws {
        let json = #"{"page":1,"total_pages":3,"total_results":40,"results":[]}"#
        let page = try FRJSON.decode(DiscoveryPage<MovieSearchResult>.self, from: Data(json.utf8))
        #expect(page.results.isEmpty)
        #expect(page.hasMore, "has_more falls back to the page count, not the visible results")
    }

    @Test func detailsDecodeWithMissingOptionalFacts() throws {
        let json = """
        {"tmdb_id":7,"imdb_id":"","title":"Street Fighter","tagline":"","overview":"Fight.","release_date":null,
         "runtime":112,"status":"Post Production","poster_url":null,"backdrop_url":null,"vote_average":0,"vote_count":0,
         "genres":[{"id":28,"name":"Action"}],"cast":[{"id":1,"name":"A","character":"B","profile_url":null}],"director":null}
        """
        let details = try FRJSON.decode(MovieDetails.self, from: Data(json.utf8))
        #expect(details.imdbID == nil)
        #expect(details.imdbURL == nil)
        #expect(details.tagline == nil)
        #expect(details.releaseDate == nil)
        #expect(details.runtime == 112)
        #expect(details.genres.map(\.name) == ["Action"])
        #expect(details.cast.first?.character == "B")
    }

    @Test func imdbLinkOnlyForPlainIDs() {
        var details = MovieDetails(tmdbID: 1, imdbID: "tt0111161", title: "X")
        #expect(details.imdbURL?.absoluteString == "https://www.imdb.com/title/tt0111161")
        details.imdbID = "tt1/../evil"
        #expect(details.imdbURL == nil)
    }
}

struct MovieFactsTests {
    @Test func runtimeReadsLikeTheMockups() {
        #expect(MovieFacts.runtime(112) == "1 hr 52 min")
        #expect(MovieFacts.runtime(120) == "2 hr")
        #expect(MovieFacts.runtime(45) == "45 min")
        #expect(MovieFacts.runtime(0) == nil)
        #expect(MovieFacts.runtime(nil) == nil)
        #expect(MovieFacts.spokenRuntime(61) == "1 hour 1 minute")
        #expect(MovieFacts.spokenRuntime(135) == "2 hours 15 minutes")
    }

    @Test func unknownReleaseDatesAreExplained() {
        let now = DateOnly(year: 2026, month: 10, day: 17)!.date()
        #expect(MovieFacts.releaseLine(nil, now: now) == "Release date not announced")
        let past = MovieFacts.releaseLine(DateOnly(year: 2026, month: 7, day: 17), now: now)
        let future = MovieFacts.releaseLine(DateOnly(year: 2026, month: 12, day: 18), now: now)
        #expect(past.hasPrefix("Released "))
        #expect(future.hasPrefix("Releases "))
    }

    @Test func queriesAreTrimmedAndCapped() {
        #expect(MovieSearchQuery.normalized("  ") == nil)
        #expect(MovieSearchQuery.normalized(" Dune ") == "Dune")
        #expect(MovieSearchQuery.normalized(String(repeating: "a", count: 140))?.count == 100)
    }

    @Test func yearOptionsMatchTheWebFilter() {
        let now = DateOnly(year: 2026, month: 1, day: 1)!.date()
        #expect(MovieSearchQuery.yearOptions(now: now) == [2028, 2027, 2026, 2025, 2024, 2023, 2022])
    }
}

struct FranchiseTests {
    func history(films: [Double?], average: Double? = nil, entry: Int = 3, name: String = "The Avengers Collection") -> FranchiseHistory {
        FranchiseHistory(
            collectionID: 1,
            collectionName: name,
            entryNumber: entry,
            films: films.enumerated().map { FranchiseFilm(tmdbID: TMDbID($0.offset + 1), title: "F\($0.offset)", rtScore: $0.element) },
            averageRT: average
        )
    }

    @Test func ordinals() {
        #expect(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "111th"] ==
            [1, 2, 3, 4, 11, 12, 13, 21, 22, 111].map(FranchiseText.ordinal))
    }

    @Test func entryLabelDropsSuffixAndArticle() {
        #expect(FranchiseText.entryLabel(history(films: [], entry: 5)) == "5th Avengers film")
        #expect(FranchiseText.entryLabel(history(films: [], entry: 2, name: "Shrek Collection")) == "2nd Shrek film")
        #expect(FranchiseText.seriesName(history(films: [], name: "Shrek")) == "Shrek")
    }

    @Test func summaryCountsBreakEvenAndProjectsTheAverage() {
        let mixed = history(films: [80, 40, nil, 60], average: 60)
        #expect(FranchiseText.summary(mixed, doublePointsOver90: false)
            == "2 of 3 prior films landed above the 60% break-even; at the series average this pick would score 0 pts.")
        let strong = history(films: [96], average: 96)
        #expect(FranchiseText.summary(strong, doublePointsOver90: true)
            == "1 of 1 prior film landed above the 60% break-even; at the series average this pick would score +42 pts.")
        #expect(FranchiseText.summary(history(films: [nil]), doublePointsOver90: false)
            == "None of the prior films have a Tomatometer yet.")
    }

    @Test func responseMapsNullToNoHistory() throws {
        let json = """
        {"histories":{"10":null,"11":{"collection_id":9,"collection_name":"Shrek Collection","entry_number":2,
          "films":[{"tmdb_id":808,"title":"Shrek","release_date":"2001-05-18","poster_url":null,"rt_score":88}],
          "average_rt":88,"last_rt":88}}}
        """
        let response = try FRJSON.decode(FranchiseHistoriesResponse.self, from: Data(json.utf8))
        let byID = response.byTMDbID
        #expect(byID.keys.contains(TMDbID(10)))
        #expect(byID[TMDbID(10)] == .some(nil))
        #expect(byID[TMDbID(11)]??.films.first?.rtScore == 88)
        #expect(byID[TMDbID(12)] == nil)
    }
}

struct WishlistTests {
    func movie(_ id: Int, _ title: String, daysAgo: Double, now: Date) -> WishlistedMovie {
        WishlistedMovie(
            id: WishlistItemID("w\(id)"), userID: "u", tmdbID: TMDbID(id), title: title,
            addedAt: now.addingTimeInterval(-daysAgo * 86_400)
        )
    }

    @Test func sortsByDateAddedOrTitle() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let movies = [movie(1, "Zootopia 2", daysAgo: 3, now: now), movie(2, "avatar 3", daysAgo: 1, now: now), movie(3, "Barbie", daysAgo: 2, now: now)]
        #expect(WishlistSort.dateAdded.sorted(movies).map(\.tmdbID.rawValue) == [2, 3, 1])
        #expect(WishlistSort.title.sorted(movies).map(\.tmdbID.rawValue) == [2, 3, 1])
    }

    @Test func posterIsStoredAsTheBareTMDbPath() {
        #expect(WishlistLimits.storablePosterPath("https://image.tmdb.org/t/p/w500/abc.jpg") == "/abc.jpg")
        #expect(WishlistLimits.storablePosterPath("/abc.jpg") == "/abc.jpg")
        #expect(WishlistLimits.storablePosterPath("https://cdn.example.com/abc.jpg") == nil)
        #expect(WishlistLimits.storablePosterPath(nil) == nil)
        let long = WishlistCandidate(tmdbID: 1, title: String(repeating: "x", count: 600), posterURL: nil).row
        #expect(long?.title.count == 500)
        #expect(WishlistCandidate(tmdbID: 1, title: "  ", posterURL: nil).row == nil)
    }

    @Test func leagueStatusUsesEveryHolding() {
        let index = LeagueHoldingsIndex(myTeamID: "mine", holders: [
            TMDbID(1): .init(teamID: "mine", teamName: "Reel Deal", source: .draft),
            TMDbID(2): .init(teamID: "other", teamName: "Coppola Cut", source: .pickup),
            TMDbID(3): .init(teamID: "other", teamName: "Coppola Cut", source: .draft),
        ])
        #expect(index.status(of: 1).label == "On your roster")
        #expect(index.status(of: 2).label == "Picked up by Coppola Cut")
        #expect(index.status(of: 3).label == "Drafted by Coppola Cut")
        #expect(index.status(of: 4) == .available)
    }

    @Test func addedDatesAreCompactAndSpoken() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let gmt = TimeZone(identifier: "UTC")!
        let locale = Locale(identifier: "en_US")
        func text(_ days: Double) -> AddedDateText {
            AddedDateText(now.addingTimeInterval(-days * 86_400), now: now, locale: locale, timeZone: gmt)
        }
        #expect(text(0.2).compact == "today")
        #expect(text(1.5).spoken == "yesterday")
        #expect(text(3).compact == "3d ago")
        #expect(text(3).spoken == "3 days ago")
        #expect(text(15).compact == "2w ago")
        #expect(text(7).spoken == "1 week ago")
        #expect(text(45).compact == text(45).spoken)
    }

    @Test func wishlistRowsDecode() throws {
        let json = #"[{"id":"0b3c","user_id":"u1","tmdb_id":5,"title":"Shrek 5","poster_url":"/s.jpg","added_at":"2026-10-01T12:00:00.123456+00:00"}]"#
        let rows = try FRJSON.decode([WishlistedMovie].self, from: Data(json.utf8))
        #expect(rows.first?.tmdbID == 5)
    }
}

/// Fixtures from `scripts/tests/projections.test.cjs`, so the chip reads the
/// same on both clients (F-19).
struct ProjectionTextTests {
    func projection(
        projected: Double = 76,
        range50: [Double] = [72, 80],
        lowConfidence: Bool = false,
        insufficient: Bool = false,
        early: MovieProjection.EarlyRT? = nil,
        contributions: [MovieProjection.Contribution]? = nil
    ) -> MovieProjection {
        MovieProjection(
            tmdbID: 1, projectedRT: projected, range50: range50, range80: [64, 86],
            lowConfidence: lowConfidence, insufficientHistory: insufficient,
            pRotten: 0.12, pFresh: 0.88, p90: 0.08, expectedPoints: 16, baselineRT: 61,
            contributions: contributions ?? [
                .init(factor: "director", label: "Director", deltaRT: 9),
                .init(factor: "writers", label: "Writers", deltaRT: 3),
                .init(factor: "studio", label: "Studio and festival", deltaRT: 4),
                .init(factor: "cast", label: "Cast", deltaRT: -1),
            ],
            earlyRT: early
        )
    }

    func label(_ p: MovieProjection) -> String { ProjectionText.chipLabel(ProjectionText.chipState(p)) }
    func spoken(_ p: MovieProjection) -> String { ProjectionText.chipSpokenLabel(ProjectionText.chipState(p)) }

    @Test func chipLabels() {
        #expect(label(projection(range50: [68.4, 78.2])) == "Proj. 68–78%")
        #expect(label(projection(projected: 73.6, range50: [60, 80.5])) == "Proj. 74%")
        #expect(ProjectionText.chipState(projection(range50: [70, 80])) == .range(low: 70, high: 80))
        #expect(label(projection(insufficient: true)) == "Not enough history yet")
        #expect(label(projection(early: .init(score: 87.6, reviews: 24))) == "Early RT 88% (24 reviews)")
        #expect(label(projection(early: .init(score: 50, reviews: 1))) == "Early RT 50% (1 review)")
    }

    @Test func spokenLabels() {
        #expect(spoken(projection(range50: [68.4, 78.2])) == "Projected 68 to 78%")
        #expect(spoken(projection(projected: 73.6, range50: [60, 80.5])) == "Projected about 74%")
        #expect(spoken(projection(insufficient: true)) == "Projected score: not enough history yet")
        #expect(spoken(projection(early: .init(score: 87.6, reviews: 24))) == "Early Rotten Tomatoes score 88%, 24 reviews")
    }

    @Test func toneAndPoints() {
        #expect(ProjectionText.tone(projection()) == .fresh)
        #expect(ProjectionText.tone(projection(projected: 48, range50: [44, 52])) == .rotten)
        #expect(ProjectionText.tone(projection(lowConfidence: true)) == .uncertain)
        #expect(ProjectionText.projectedPoints(projection()) == 16)
        #expect(ProjectionText.projectedPoints(projection(), counterpick: true) == -16)
        #expect(ProjectionText.chance(0.123) == "12%")
        #expect(ProjectionText.chance(0.001) == "<1%")
        #expect(ProjectionText.chance(0.999) == ">99%")
    }

    @Test func barWalksFromTheBaseline() {
        let factors = ProjectionText.factors(projection())
        #expect(factors.map(\.key) == ["director", "studio", "writers", "cast"])
        let segments = ProjectionText.barSegments(baseline: 61, factors: factors)
        #expect(segments.map(\.start) == [0, 61, 70, 74, 76])
        #expect(segments.map(\.width) == [61, 9, 4, 3, 1])
        #expect(segments.map(\.positive) == [true, true, true, true, false])
        let clamped = ProjectionText.barSegments(baseline: 95, factors: [.init(key: "a", label: "A", delta: 12)])
        #expect(clamped.map { $0.start + $0.width } == [95, 100])
    }

    @Test func longTailFolds() {
        let contributions = [9.0, -6, 5, 4, 3, 2, 1].enumerated().map {
            MovieProjection.Contribution(factor: "f\($0.offset)", label: "F\($0.offset)", deltaRT: $0.element)
        }
        let factors = ProjectionText.factors(projection(contributions: contributions))
        #expect(factors.count == 5)
        #expect(factors[4].label == "Other factors")
        #expect(factors[4].delta == 6)
    }

    @Test func responseGatesOnTheServerFlag() throws {
        let off = try FRJSON.decode(MovieProjectionsResponse.self, from: Data(#"{"enabled":false}"#.utf8))
        #expect(off == .disabled)
        #expect(off.projection(for: 1) == nil)
        let json = """
        {"enabled":true,"model_version":3,"projections":{"5":null,"6":{"tmdb_id":6,"projected_rt":71,"range50":[66,75],
         "range80":[58,82],"low_confidence":false,"insufficient_history":false,"p_rotten":0.2,"p_fresh":0.8,"p_90":0.05,
         "expected_points":11,"baseline_rt":58,"contributions":[],"coverage":0.9,"partial":false,
         "includes_early_reviews":false,"early_rt":null,"computed_at":"2026-10-12T08:00:00Z"}}}
        """
        let on = try FRJSON.decode(MovieProjectionsResponse.self, from: Data(json.utf8))
        #expect(on.projection(for: 5) == nil)
        #expect(on.projection(for: 6)?.projectedRT == 71)
    }
}
