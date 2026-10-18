import FantasyReelCore
import Foundation
import Testing
@testable import FantasyReelAPI

struct MovieRequestTests {
    func json(_ value: some Encodable) throws -> [String: JSONValue] {
        let data = try FRJSON.makeEncoder().encode(value)
        return try FRJSON.decode([String: JSONValue].self, from: data)
    }

    @Test func searchSendsOnlyWhatIsSet() throws {
        let plain = try json(MovieSearchRequest(query: "Dune"))
        #expect(Set(plain.keys) == ["query", "page"])
        let league = try json(MovieSearchRequest(query: "Dune", page: 2, year: 2026, upcomingOnly: true, seasonYear: 2026))
        #expect(league["upcoming_only"] == .bool(true))
        #expect(league["season_year"]?.doubleValue == 2026)
        #expect(league["year"]?.doubleValue == 2026)
        #expect(league["page"]?.doubleValue == 2)
    }

    @Test func browseUsesTheServerNames() throws {
        let body = try json(MovieBrowseRequest(genres: [28], releaseWindow: .next30, sortBy: .releaseDate, seasonYear: 2027))
        #expect(body["release_window"]?.stringValue == "next30")
        #expect(body["sort_by"]?.stringValue == "release_date")
        #expect(body["trending"] == nil)
    }

    @Test func fakeWishlistRefusesThe501stMovie() async throws {
        let user: UserID = "u1"
        let rows = (1...WishlistLimits.maxCount).map {
            WishlistedMovie(id: WishlistItemID("w\($0)"), userID: user, tmdbID: TMDbID($0), title: "M\($0)", addedAt: Date())
        }
        let repository = InMemoryWishlistRepository(rows: rows)
        await #expect(throws: APIError.self) {
            _ = try await repository.add(WishlistInsert(tmdbID: 9999, title: "One more", posterURL: nil), for: user)
        }
        // Adding one that's already there is not a 501st movie.
        let again = try await repository.add(WishlistInsert(tmdbID: 1, title: "M1", posterURL: nil), for: user)
        #expect(again.id == WishlistItemID("w1"))
    }

    @Test func projectionsOffMeansNothingForEveryBatch() async throws {
        let repository = InMemoryMovieRepository(projections: .disabled)
        let response = try await repository.projections(league: "l1", tmdbIDs: [1, 2])
        #expect(response.projection(for: 1) == nil)
    }
}
