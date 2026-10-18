import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation

/// State and submission for Join League (F-05): a code, a pasted link, or an
/// email invitation token.
///
/// `join-league` is never retried. A success with a `warning` still means the
/// person is in; an uncertain failure re-reads the directory and asks them to
/// check their leagues before trying again.
@Observable
@MainActor
final class JoinLeagueModel {
    /// Bound to the fields. Call `codeDidChange(_:)` and `teamNameDidChange()` after edits.
    var form: JoinLeagueForm
    private(set) var isRunning = false
    /// Set once the server said yes. When it carries a `warning` (the league
    /// exists but a later step failed), the sheet stays open to show it.
    private(set) var completed: LeagueMembershipResult?
    /// A validation problem found on submit (also outlines the code field).
    private(set) var localError: String?
    /// The server's refusal (including the code-attempt rate limit) or a transport failure.
    private(set) var serverError: String?
    /// The person may have joined even though we saw an error.
    private(set) var outcomeUncertain = false
    /// The server said yes but the league isn't in the directory yet (its
    /// re-read failed), so it couldn't be opened. The sheet stays open with
    /// Retry; the mutation is never sent again.
    private(set) var needsOpening = false
    private(set) var isOpening = false

    private let lifecycle: any LeagueLifecycleRepository
    private let directory: LeagueDirectoryStore

    init(input: JoinInput, lifecycle: any LeagueLifecycleRepository, directory: LeagueDirectoryStore) {
        switch input {
        case .manual: form = JoinLeagueForm()
        case .code(let value): form = JoinLeagueForm(code: value)
        case .invitation(let token): form = JoinLeagueForm(invitationToken: token)
        }
        self.lifecycle = lifecycle
        self.directory = directory
    }

    var errorMessage: String? {
        if let localError { return localError }
        if outcomeUncertain {
            return "We couldn't confirm whether you joined. Check your league list before trying again."
        }
        return serverError
    }

    var isCodeMode: Bool { form.mode == .code }

    /// Input that closing the sheet would lose (none once joined).
    var hasUnsavedInput: Bool { completed == nil && form.hasUnsavedInput }

    /// A typed or pasted link reads its code or invitation token; a typed
    /// code is normalized in place.
    func codeDidChange(_ newValue: String) {
        clearErrors()
        if JoinLeagueForm.looksLikeLink(newValue) {
            applyPasted(newValue)
            return
        }
        let normalized = JoinCode.normalize(newValue)
        if normalized != form.code { form.code = normalized }
    }

    func teamNameDidChange() {
        form.clampTeamName()
    }

    /// A code, join link or invitation link from the paste button or the field.
    func applyPasted(_ text: String) {
        clearErrors()
        let input = JoinCode.parse(text)
        form.apply(input)
        switch input {
        case .invitation:
            Announcer.announce("Invitation link pasted")
        case .code(let parsed):
            if !parsed.isEmpty {
                let spelled = parsed.map { String($0) }.joined(separator: " ")
                Announcer.announce("Code \(spelled) pasted")
            }
        }
    }

    /// Leaves invitation mode for typing a code.
    func useCodeInstead() {
        form.mode = .code
        clearErrors()
    }

    /// Checks the form, showing the first problem. False when it can't be sent.
    @discardableResult
    func validate() -> Bool {
        if case .failure(let problem) = form.request() {
            localError = problem.message
            return false
        }
        localError = nil
        return true
    }

    /// Joins, then refreshes the directory and selects the league. Returns
    /// the result on success; nil when invalid, refused or uncertain.
    func submit() async -> LeagueMembershipResult? {
        guard !isRunning, completed == nil else { return nil }
        clearErrors()
        guard case .success(let request) = form.request() else {
            validate()
            return nil
        }
        isRunning = true
        defer { isRunning = false }

        let lifecycle = lifecycle
        let outcome = await MutationOutcome.of { () async throws(APIError) -> LeagueMembershipResult in
            try await lifecycle.joinLeague(request)
        }
        switch outcome {
        case .succeeded(let result):
            completed = result
            // A `warning` still means the person is in: open the league and
            // show the warning in the sheet. Never join again.
            await openCompleted()
            let joined = "Joined \(result.leagueName)"
            Announcer.announce(result.warning.map { "\(joined). \($0)" } ?? joined)
            return result
        case .uncertain(let error):
            if error.isCancellation { return nil }
            await directory.refresh()
            outcomeUncertain = true
            return nil
        case .failed(let error):
            if error.isCancellation { return nil }
            serverError = error.userMessage
            return nil
        }
    }

    /// Re-reads the directory and selects the league the server confirmed.
    /// Tries a second refresh before giving up, then shows Retry.
    func openCompleted() async {
        guard let result = completed, !isOpening else { return }
        isOpening = true
        defer { isOpening = false }
        let wasWaiting = needsOpening
        await directory.refresh()
        var opened = directory.select(result.leagueID)
        if !opened {
            await directory.refresh()
            opened = directory.select(result.leagueID)
        }
        needsOpening = !opened
        if opened, wasWaiting {
            Announcer.announce("\(result.leagueName) opened")
        }
    }

    private func clearErrors() {
        localError = nil
        serverError = nil
        outcomeUncertain = false
    }
}
