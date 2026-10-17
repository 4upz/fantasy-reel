import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation

/// How the owner picks who to invite.
enum InviteMode: Hashable, CaseIterable {
    case name
    case email

    var title: String {
        switch self {
        case .name: "By name"
        case .email: "By email"
        }
    }
}

/// State for Invite Player (F-05): the user search, the selected person or
/// typed address, and the send with its uncertain-outcome handling.
///
/// `send-invite` is never retried. An uncertain result asks the owner to
/// check the invitations list before sending again.
@Observable
@MainActor
final class InviteModel {
    /// Call `modeDidChange()` after it changes.
    var mode: InviteMode = .name
    var query = ""
    var email = ""
    private(set) var results: LoadState<[UserSearchResult]> = .idle
    private(set) var searchRateLimited = false
    private(set) var selectedUser: UserSearchResult?

    private(set) var isRunning = false
    private(set) var localError: String?
    private(set) var sendError: String?
    private(set) var sendRateLimited = false
    private(set) var outcomeUncertain = false
    private(set) var sentMessage: String?
    private(set) var sentLink: URL?

    private let leagueID: LeagueID
    private let invitations: any InvitationRepository

    /// Pause after the last keystroke before searching.
    static let debounce: Duration = .milliseconds(300)

    init(leagueID: LeagueID, invitations: any InvitationRepository) {
        self.leagueID = leagueID
        self.invitations = invitations
    }

    var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    var trimmedEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines) }

    var canSend: Bool {
        switch mode {
        case .name: selectedUser != nil
        case .email: !trimmedEmail.isEmpty
        }
    }

    // MARK: Search

    /// Searches for `text` after the debounce, keeping the previous results on
    /// screen while the person types. Run from `.task(id: trimmedQuery)`, which
    /// cancels the wait when the query changes again.
    func search(_ text: String) async {
        guard text.count >= 2 else {
            results = .idle
            return
        }
        do {
            try await Task.sleep(for: Self.debounce)
        } catch {
            return
        }
        if results.value == nil { results = .loading }
        do {
            let users = try await invitations.searchUsers(text, in: leagueID)
            if Task.isCancelled { return }
            searchRateLimited = false
            results = users.isEmpty ? .empty : .loaded(users)
        } catch {
            if error.isCancellation || Task.isCancelled { return }
            if case .rateLimited = error {
                searchRateLimited = true
            } else {
                searchRateLimited = false
            }
            results = .failed(message: error.userMessage)
        }
    }

    /// Switching between name and email clears the last send's messages.
    func modeDidChange() {
        clearOutcome()
    }

    func choose(_ user: UserSearchResult) {
        selectedUser = user
        sentMessage = nil
        sentLink = nil
        Announcer.announce("\(user.displayName) selected")
    }

    func clearSelection() {
        selectedUser = nil
        sentMessage = nil
    }

    // MARK: Send

    /// Sends the invitation. True on success (the form resets and the
    /// confirmation shows); false when invalid, refused or uncertain.
    @discardableResult
    func send() async -> Bool {
        guard !isRunning else { return false }
        clearOutcome()

        let recipient: InviteRecipient
        let invitee: String?
        switch mode {
        case .name:
            guard let user = selectedUser else {
                localError = "Choose someone to invite"
                return false
            }
            recipient = .user(user.userID)
            invitee = user.displayName
        case .email:
            let address = trimmedEmail
            guard AuthMessages.looksLikeEmail(address) else {
                localError = AuthMessages.invalidEmail
                return false
            }
            recipient = .email(address)
            invitee = nil
        }

        isRunning = true
        defer { isRunning = false }
        let invitations = invitations
        let leagueID = leagueID
        let outcome = await MutationOutcome.of { () async throws(APIError) -> InviteResult in
            try await invitations.invite(recipient, to: leagueID)
        }
        switch outcome {
        case .succeeded(let result):
            let message = result.confirmation(invitee: invitee)
            sentMessage = message
            sentLink = result.inviteURL
            selectedUser = nil
            query = ""
            email = ""
            Announcer.announce(message)
            return true
        case .uncertain(let error):
            if !error.isCancellation { outcomeUncertain = true }
            return false
        case .failed(let error):
            if error.isCancellation { return false }
            if case .rateLimited = error { sendRateLimited = true }
            sendError = error.userMessage
            return false
        }
    }

    private func clearOutcome() {
        localError = nil
        sendError = nil
        sendRateLimited = false
        outcomeUncertain = false
        sentMessage = nil
        sentLink = nil
    }
}
