import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation
import SwiftUI

/// State for the owner settings screen (F-15, F-16): the season's active
/// members, and one `AsyncAction` per section so each section's Save shows its
/// own progress and its own server error.
///
/// Every save goes through `update-league` and then re-reads the league
/// directory, so the shell (tabs, top bar, every section's current value)
/// follows the server's answer. Nothing auto-retries: an uncertain result
/// refreshes state and leaves the decision to the owner (N-04).
@Observable
@MainActor
final class SettingsModel {
    let seasonID: LeagueID

    /// Active members of this season, in draft order.
    private(set) var members: LoadState<[LeagueMember]> = .idle

    let general = AsyncAction()
    let joining = AsyncAction()
    let season = AsyncAction()
    let scoring = AsyncAction()
    let roster = AsyncAction()
    let counterpicks = AsyncAction()
    let trades = AsyncAction()
    let removal = AsyncAction()
    let completion = AsyncAction()
    let deletion = AsyncAction()
    let announcement = AsyncAction()

    private let leagues: any LeagueRepository
    private let lifecycle: any LeagueLifecycleRepository
    private let announcements: any AnnouncementRepository
    private let directory: LeagueDirectoryStore

    init(
        seasonID: LeagueID,
        leagues: any LeagueRepository,
        lifecycle: any LeagueLifecycleRepository,
        announcements: any AnnouncementRepository,
        directory: LeagueDirectoryStore
    ) {
        self.seasonID = seasonID
        self.leagues = leagues
        self.lifecycle = lifecycle
        self.announcements = announcements
        self.directory = directory
    }

    /// Active members (`fetchMembers` returns only active participants).
    var activeMembers: [LeagueMember] { members.value ?? [] }

    /// The active count once members have loaded; nil before.
    var activeCount: Int? { members.value.map(\.count) }

    /// True once members have loaded (or the season has none).
    var hasLoadedMembers: Bool {
        switch members {
        case .loaded, .empty: true
        case .idle, .loading, .failed: false
        }
    }

    func loadMembers() async {
        if members.value == nil { members = .loading }
        do {
            let list = try await leagues.fetchMembers(of: seasonID)
            // `fetchMembers` already returns draft order.
            members = list.isEmpty ? .empty : .loaded(list)
        } catch {
            // A cancelled read (the screen went away) didn't fail.
            if error.isCancellation || Task.isCancelled { return }
            // Keep the list we had if a background re-read fails.
            if members.value == nil {
                members = .failed(message: error.userMessage)
            }
        }
    }

    /// Sends `updates` in order (stopping at the first refusal), then re-reads
    /// the directory so the shell's season reflects what the server saved.
    func save(
        _ updates: [LeagueUpdate],
        with action: AsyncAction,
        onSuccess: (@MainActor () async -> Void)? = nil
    ) {
        guard !updates.isEmpty else { return }
        action.run {
            try await self.send(updates)
            if let onSuccess { await onSuccess() }
        }
    }

    private func send(_ updates: [LeagueUpdate]) async throws {
        do {
            for update in updates {
                _ = try await lifecycle.update(seasonID, update)
            }
        } catch {
            // A partial save (first update landed, second refused) or an
            // uncertain result: show the server's current values.
            await directory.refresh()
            throw error
        }
        await directory.refresh()
    }

    func save(_ update: LeagueUpdate, with action: AsyncAction, onSuccess: (@MainActor () async -> Void)? = nil) {
        save([update], with: action, onSuccess: onSuccess)
    }

    // MARK: Unsaved edits

    /// Each section's unsaved edits, reported by the section itself
    /// (`tracksUnsavedEdits`). Leaving Settings with any of them asks first.
    private(set) var unsavedEdits: [SettingsSectionKey: SettingsEdits] = [:]

    var hasUnsavedChanges: Bool { !unsavedEdits.isEmpty }

    /// True when every unsaved section could be saved as it stands (no field error).
    var canSaveAllUnsaved: Bool { unsavedEdits.values.allSatisfy { $0.updates != nil } }

    func setUnsavedEdits(_ edits: SettingsEdits?, for key: SettingsSectionKey) {
        guard unsavedEdits[key] != edits else { return }
        unsavedEdits[key] = edits
    }

    func action(for key: SettingsSectionKey) -> AsyncAction {
        switch key {
        case .general: general
        case .season: season
        case .scoring: scoring
        case .roster: roster
        case .counterpicks: counterpicks
        case .trades: trades
        case .joining: joining
        }
    }

    /// Saves every section with unsaved edits, one after another, through the
    /// same path as each section's Save button, so a refusal shows inline in
    /// its section. True only when every one saved.
    func saveAllUnsaved() async -> Bool {
        var allSaved = true
        for key in SettingsSectionKey.allCases {
            guard let edits = unsavedEdits[key] else { continue }
            guard let updates = edits.updates else {
                allSaved = false
                continue
            }
            guard !updates.isEmpty else { continue }
            let saved = await action(for: key).runAndWait {
                try await self.send(updates)
            }
            if saved {
                Announcer.announce(key.savedAnnouncement)
            } else {
                allSaved = false
            }
        }
        return allSaved
    }

    /// Removes a member (setup only), then re-reads the member list.
    func remove(_ member: LeagueMember) {
        save(.removeParticipant(member.id), with: removal) { [weak self] in
            Announcer.announce("\(member.displayName) was removed from the league.")
            await self?.loadMembers()
        }
    }

    /// Posts a commissioner announcement; `onPosted` gets the channel count
    /// (0 when no channel is linked).
    func postAnnouncement(_ message: String, onPosted: @escaping @MainActor (Int) -> Void) {
        let seasonID = seasonID
        let announcements = announcements
        announcement.run {
            let count = try await announcements.postAnnouncement(message, to: seasonID)
            onPosted(count)
        }
    }
}

// MARK: - Unsaved edits

/// The settings sections with their own Save button, in screen order.
enum SettingsSectionKey: Hashable, CaseIterable {
    case general, season, scoring, roster, counterpicks, trades, joining

    /// Spoken after the section saves.
    var savedAnnouncement: String {
        switch self {
        case .general: "League info updated."
        case .season: "Season settings updated."
        case .scoring: "Scoring updated."
        case .roster: "Bidding configuration updated."
        case .counterpicks: "Counterpick configuration updated."
        case .trades: "Trade settings updated."
        case .joining: "Joining settings updated."
        }
    }
}

/// A section's unsaved edits: the updates its Save button would send, or nil
/// while a field is invalid (the edits can't be saved as they stand).
struct SettingsEdits: Equatable {
    let updates: [LeagueUpdate]?
}

extension View {
    /// Reports a section's unsaved edits (nil: none) to the model while the
    /// section is on screen, so leaving Settings can offer to save them.
    @MainActor
    func tracksUnsavedEdits(
        _ edits: SettingsEdits?,
        for key: SettingsSectionKey,
        in model: SettingsModel
    ) -> some View {
        onAppear { model.setUnsavedEdits(edits, for: key) }
            .onChange(of: edits) { _, new in model.setUnsavedEdits(new, for: key) }
            .onDisappear { model.setUnsavedEdits(nil, for: key) }
    }
}

// MARK: - Limits

/// `update-league`'s limits, mirrored for inline validation. The server stays
/// authoritative.
enum SettingsLimits {
    static let maxNameLength = CreateLeagueRequest.maxNameLength
    static let participants = 2...20
    static let totalSlots = 1...20
    static let minDraftSlots = 1
    static let dropLimit = 0...10
    static let counterbidHours = 1...72
    static let newBidCutoffHours = 0...144
    /// `update-league` allows 0–5 for both (create allows bidding 0–3).
    static let counterpickSlots = 0...5
    static let vetoHours = 0...168
    static let expiryDefaultHours = 1...2160
    static let expiryMinHours = 1...168
    static let expiryMaxDays = 1...90
    /// App-level fallbacks used when an expiry bound is nil (`utils/tradeExpiry.ts`).
    static let appDefaultExpiryHours = 48
    static let appMinExpiryHours = 1
    static let appMaxExpiryDays = 14
}

// MARK: - Helpers

enum SettingsText {
    /// "1 hour", "24 hours".
    static func hours(_ value: Int) -> String {
        value == 1 ? "1 hour" : "\(value) hours"
    }

    static func days(_ value: Int) -> String {
        value == 1 ? "1 day" : "\(value) days"
    }

    static func plural(_ value: Int, _ singular: String, _ plural: String) -> String {
        "\(value) \(value == 1 ? singular : plural)"
    }

    /// Parses a whole number typed into a field; nil when empty or not a number.
    static func integer(_ text: String) -> Int? {
        Int(text.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    /// A whole number typed into a field, or nil when empty, not a number, or outside `range`.
    static func integer(_ text: String, in range: ClosedRange<Int>) -> Int? {
        integer(text).flatMap { range.contains($0) ? $0 : nil }
    }
}

extension DateOnly {
    /// The UTC calendar day a date picker (shown in UTC) landed on.
    static func fromPicker(_ date: Date) -> DateOnly {
        DateOnly.today(now: date, timeZone: .gmt)
    }

    /// Midnight UTC, for a date picker shown in UTC.
    var pickerDate: Date { date(in: .gmt) }
}
