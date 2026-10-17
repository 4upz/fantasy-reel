import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation

/// State and submission for Create League (F-05).
///
/// `create-league` is never retried: a success with a `warning` still opens
/// the new league, and an uncertain failure re-reads the directory and asks
/// the person to check their leagues before trying again.
@Observable
@MainActor
final class CreateLeagueModel {
    /// Bound to the form's fields. Call `formDidChange(from:)` after each edit.
    var form = CreateLeagueForm()
    private(set) var isRunning = false
    /// Set once the server said yes. When it carries a `warning` (the league
    /// exists but a later step failed), the sheet stays open to show it.
    private(set) var completed: LeagueMembershipResult?
    /// A validation problem found on submit.
    private(set) var localError: String?
    /// The server's refusal or a transport failure.
    private(set) var serverError: String?
    /// The league may exist even though we saw an error.
    private(set) var outcomeUncertain = false

    private let lifecycle: any LeagueLifecycleRepository
    private let directory: LeagueDirectoryStore

    init(lifecycle: any LeagueLifecycleRepository, directory: LeagueDirectoryStore) {
        self.lifecycle = lifecycle
        self.directory = directory
    }

    /// Input that closing the sheet would lose (none once created).
    var isDirty: Bool { completed == nil && form.isDirty }

    var errorMessage: String? {
        if let localError { return localError }
        if outcomeUncertain {
            return "We couldn't confirm the league was created. Check your league list before trying again."
        }
        return serverError
    }

    /// Checks the form, showing the first problem. False when it can't be sent.
    @discardableResult
    func validate() -> Bool {
        localError = form.validationMessage
        return localError == nil
    }

    /// Creates the league, then refreshes the directory and selects it.
    /// Returns the result on success; nil when invalid, refused or uncertain.
    func submit() async -> LeagueMembershipResult? {
        guard !isRunning, completed == nil else { return nil }
        outcomeUncertain = false
        serverError = nil
        guard validate() else { return nil }
        isRunning = true
        defer { isRunning = false }

        let request = form.request
        let lifecycle = lifecycle
        let outcome = await MutationOutcome.of { () async throws(APIError) -> LeagueMembershipResult in
            try await lifecycle.createLeague(request)
        }
        switch outcome {
        case .succeeded(let result):
            completed = result
            // A `warning` means the league exists but the team step failed;
            // open it anyway (the sheet shows the warning) and never
            // create a second one.
            await directory.refresh()
            directory.select(result.leagueID)
            let created = "\(result.leagueName) created"
            Announcer.announce(result.warning.map { "\(created). \($0)" } ?? created)
            return result
        case .uncertain(let error):
            if error.isCancellation { return nil }
            // The league may exist: show it in the menu before anyone retries.
            await directory.refresh()
            outcomeUncertain = true
            return nil
        case .failed(let error):
            if error.isCancellation { return nil }
            serverError = error.userMessage
            return nil
        }
    }

    /// Keeps the form consistent after an edit (`.onChange(of: model.form)`).
    func formDidChange(from old: CreateLeagueForm) {
        // Lowering the roster lowers the draft to match, as on the web.
        if form.draftSlots > form.totalSlots { form.draftSlots = form.totalSlots }
        form.clampNames()
        if form.name != old.name { localError = nil }
    }
}
