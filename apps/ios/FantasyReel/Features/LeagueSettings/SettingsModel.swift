import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation

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

    func loadMembers() async {
        if members.value == nil { members = .loading }
        do {
            let list = try await leagues.fetchMembers(of: seasonID)
            members = list.isEmpty ? .empty : .loaded(list.sortedByDraftOrder())
        } catch {
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
        let seasonID = seasonID
        let lifecycle = lifecycle
        let directory = directory
        action.run {
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
            if let onSuccess { await onSuccess() }
        }
    }

    func save(_ update: LeagueUpdate, with action: AsyncAction, onSuccess: (@MainActor () async -> Void)? = nil) {
        save([update], with: action, onSuccess: onSuccess)
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
}

extension DateOnly {
    /// The UTC calendar day a date picker (shown in UTC) landed on.
    static func fromPicker(_ date: Date) -> DateOnly {
        DateOnly.today(now: date, timeZone: .gmt)
    }

    /// Midnight UTC, for a date picker shown in UTC.
    var pickerDate: Date { date(in: .gmt) }
}
