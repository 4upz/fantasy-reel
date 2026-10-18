import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation
import SwiftUI

/// The season the shell is showing, and what the shell derives from it.
/// Feature screens read it with `@Environment(\.leagueSelection)`.
struct LeagueSelection: Equatable {
    let userID: UserID
    /// The selected season (`leagues` row). Its `id` is the league ID every
    /// gameplay read and mutation must use.
    let season: League
    /// Every visible season of the same series, newest first.
    let seriesSeasons: [League]

    var isOwner: Bool { season.ownerID == userID }
    var tabs: [LeagueTab] { LeagueNavigation.tabs(for: season.status) }
    var showsSearchTab: Bool { LeagueNavigation.showsSearchTab(beside: tabs) }
    var defaultTab: LeagueTab { LeagueNavigation.defaultTab(for: season.status) }
    var menuItems: [LeagueMenuItem] {
        LeagueNavigation.menuItems(status: season.status, isOwner: isOwner, seasonCount: seriesSeasons.count)
    }
}

extension EnvironmentValues {
    /// The selected season, or nil outside a league (no-league screen, menu sheet roots).
    @Entry var leagueSelection: LeagueSelection? = nil
}

/// Loads the leagues this account can see and remembers which season is selected.
///
/// The selection is restored per account (keyed by user ID in UserDefaults), so a
/// different account on the same phone never opens on someone else's league, and
/// a season that's no longer visible falls back to the first entry.
@Observable
@MainActor
final class LeagueDirectoryStore {
    private(set) var state: LoadState<[LeagueDirectoryEntry]> = .idle
    private(set) var selectedSeasonID: LeagueID?

    let userID: UserID
    private let repository: any LeagueRepository
    private let defaults: UserDefaults
    private var selectionKey: String { "fr.selectedSeason.\(userID.rawValue)" }

    init(userID: UserID, repository: any LeagueRepository, defaults: UserDefaults = .standard) {
        self.userID = userID
        self.repository = repository
        self.defaults = defaults
        self.selectedSeasonID = defaults.string(forKey: "fr.selectedSeason.\(userID.rawValue)").map(LeagueID.init(rawValue:))
    }

    /// True once the directory has loaded, with or without leagues.
    var isReady: Bool {
        switch state {
        case .loaded, .empty: true
        case .idle, .loading, .failed: false
        }
    }

    var entries: [LeagueDirectoryEntry] {
        if case .loaded(let entries) = state { return entries }
        return []
    }

    var selection: LeagueSelection? {
        guard let selectedSeasonID,
              let entry = entries.first(where: { entry in entry.seasons.contains { $0.id == selectedSeasonID } }),
              let season = entry.seasons.first(where: { $0.id == selectedSeasonID })
        else { return nil }
        return LeagueSelection(userID: userID, season: season, seriesSeasons: entry.seasons)
    }

    /// First load; shows a full-screen loading state.
    func load() async {
        if case .loaded = state { return }
        state = .loading
        await refresh()
    }

    /// Re-reads the directory in place (after a join, a phase change, a rollover).
    func refresh() async {
        do {
            let seasons = try await repository.fetchVisibleSeasons()
            let entries = LeagueDirectory.entries(from: seasons)
            let newState: LoadState<[LeagueDirectoryEntry]> = entries.isEmpty ? .empty : .loaded(entries)
            // Skip identical writes so a no-op refresh doesn't re-render the shell.
            if newState != state { state = newState }
            reconcileSelection(with: entries)
        } catch {
            // Keep showing what we had if a background refresh fails.
            if isReady { return }
            state = .failed(message: error.userMessage)
        }
    }

    /// Selects a visible season. Returns false when this account can't see it.
    @discardableResult
    func select(_ seasonID: LeagueID) -> Bool {
        guard entries.contains(where: { entry in entry.seasons.contains { $0.id == seasonID } }) else {
            return false
        }
        setSelection(seasonID)
        return true
    }

    private func reconcileSelection(with entries: [LeagueDirectoryEntry]) {
        let visible = entries.contains { entry in entry.seasons.contains { $0.id == selectedSeasonID } }
        if !visible {
            setSelection(entries.first?.entrySeason.id)
        }
    }

    private func setSelection(_ id: LeagueID?) {
        selectedSeasonID = id
        if let id {
            defaults.set(id.rawValue, forKey: selectionKey)
        } else {
            defaults.removeObject(forKey: selectionKey)
        }
    }
}
