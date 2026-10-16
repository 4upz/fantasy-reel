import Foundation
import Testing
@testable import FantasyReelCore

struct LeagueDirectoryTests {
    @Test func foldsSeasonsOfOneSeries() throws {
        let leagues = [
            Fixtures.league(id: "s24", series: "A", year: 2024, status: .completed, name: "Old Name", created: "2024-01-01T00:00:00Z"),
            Fixtures.league(id: "s26", series: "A", year: 2026, status: .active, name: "Culture", created: "2026-01-01T00:00:00Z"),
            Fixtures.league(id: "s25", series: "A", year: 2025, status: .completed, name: "Culture", created: "2025-01-01T00:00:00Z"),
        ]
        let entries = LeagueDirectory.entries(from: leagues)
        #expect(entries.count == 1)
        let entry = try #require(entries.first)
        #expect(entry.seriesID == "A")
        #expect(entry.seasons.map(\.seasonYear) == [2026, 2025, 2024])
        #expect(entry.entrySeason.id == "s26")
        #expect(entry.name == "Culture")
        #expect(entry.isRunning)
        #expect(entries.entry(containing: "s24")?.seriesID == "A")
        #expect(entries.entry(containing: "zzz") == nil)
    }

    @Test func entryIsNewestRunningSeasonEvenIfANewerOneIsDone() throws {
        // Not a real lifecycle, but the rule must still prefer a running season.
        let leagues = [
            Fixtures.league(id: "a26", series: "A", year: 2026, status: .completed, created: "2026-01-01T00:00:00Z"),
            Fixtures.league(id: "a25", series: "A", year: 2025, status: .active, created: "2025-01-01T00:00:00Z"),
        ]
        let entry = try #require(LeagueDirectory.entries(from: leagues).first)
        #expect(entry.entrySeason.id == "a25")
    }

    @Test func completedSeriesOpensOnNewestSeason() throws {
        let leagues = [
            Fixtures.league(id: "b24", series: "B", year: 2024, status: .completed, created: "2024-01-01T00:00:00Z"),
            Fixtures.league(id: "b25", series: "B", year: 2025, status: .completed, created: "2025-01-01T00:00:00Z"),
        ]
        let entry = try #require(LeagueDirectory.entries(from: leagues).first)
        #expect(entry.entrySeason.id == "b25")
        #expect(!entry.isRunning)
    }

    @Test func ordersLikeTheWebDashboard() {
        // The web lists leagues newest-created first and keeps first appearance,
        // so a series sorts by its most recently created season.
        let leagues = [
            Fixtures.league(id: "a25", series: "A", year: 2025, status: .completed, created: "2025-01-01T00:00:00Z"),
            Fixtures.league(id: "b26", series: "B", year: 2026, status: .setup, created: "2026-03-01T00:00:00Z"),
            Fixtures.league(id: "c26", series: "C", year: 2026, status: .active, created: "2026-01-15T00:00:00Z"),
            Fixtures.league(id: "a26", series: "A", year: 2026, status: .drafting, created: "2026-02-01T00:00:00Z"),
        ]
        let entries = LeagueDirectory.entries(from: leagues)
        #expect(entries.map(\.seriesID) == ["B", "A", "C"])
        #expect(entries.map(\.entrySeason.id) == ["b26", "a26", "c26"])
    }

    @Test func emptyInputGivesNoEntries() {
        #expect(LeagueDirectory.entries(from: []).isEmpty)
        #expect(LeagueDirectory.currentSeason(of: []) == nil)
    }
}
