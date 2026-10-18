import FantasyReelCore
import Foundation
import Testing
@testable import FantasyReelAPI

/// The create, join and invite screens submit through `MutationOutcome` and
/// branch on it: success opens the league (or confirms the invite), an
/// uncertain result re-reads before anyone may retry, and a refusal shows the
/// server's sentence.
struct MutationOutcomeTests {
    private static let created = LeagueMembershipResult(leagueID: "l-new", leagueName: "Popcorn Syndicate")

    @Test func createSucceedsOnce() async throws {
        let repository = InMemoryLeagueLifecycleRepository(membershipResult: Self.created)
        var form = CreateLeagueForm()
        form.name = "Popcorn Syndicate"
        let request = form.request

        let outcome = await MutationOutcome.of { () async throws(APIError) -> LeagueMembershipResult in
            try await repository.createLeague(request)
        }

        #expect(outcome.value == Self.created)
        #expect(await repository.calls == [.create(request)])
    }

    @Test func timedOutCreateIsUncertainAndNotRetried() async {
        let repository = InMemoryLeagueLifecycleRepository(failure: .timedOut(requestID: "r1"))
        var form = CreateLeagueForm()
        form.name = "Popcorn Syndicate"
        let request = form.request

        let outcome = await MutationOutcome.of { () async throws(APIError) -> LeagueMembershipResult in
            try await repository.createLeague(request)
        }

        #expect(outcome.isUncertain)
        #expect(outcome.error == .timedOut(requestID: "r1"))
        #expect(await repository.calls.count == 1)
    }

    @Test func droppedJoinIsUncertain() async throws {
        let repository = InMemoryLeagueLifecycleRepository(
            failure: .network(code: .networkConnectionLost, requestID: "r2")
        )
        let request = try JoinLeagueForm(code: "K7MPQ2XW").request().get()

        let outcome = await MutationOutcome.of { () async throws(APIError) -> LeagueMembershipResult in
            try await repository.joinLeague(request)
        }

        #expect(outcome.isUncertain)
        #expect(await repository.calls == [.join(request)])
    }

    @Test func refusedJoinIsAPlainFailure() async throws {
        let refusal = APIError.server(.init(status: 404, message: "Invalid join code"))
        let repository = InMemoryLeagueLifecycleRepository(failure: refusal)
        let request = try JoinLeagueForm(code: "K7MPQ2XW").request().get()

        let outcome = await MutationOutcome.of { () async throws(APIError) -> LeagueMembershipResult in
            try await repository.joinLeague(request)
        }

        #expect(!outcome.isUncertain)
        #expect(outcome.error?.userMessage == "Invalid join code")
    }

    @Test func offlineInviteNeverLeftTheDevice() async {
        let repository = InMemoryInvitationRepository(failure: .network(code: .notConnectedToInternet, requestID: "r3"))

        let outcome = await MutationOutcome.of { () async throws(APIError) -> InviteResult in
            try await repository.invite(.email("eve@example.com"), to: "l1")
        }

        guard case .failed(let error) = outcome else {
            Issue.record("Expected a plain failure, got \(outcome)")
            return
        }
        #expect(error.userMessage == "You're offline. Connect to the internet and try again.")
    }

    @Test func inviteSucceeds() async {
        let repository = InMemoryInvitationRepository()

        let outcome = await MutationOutcome.of { () async throws(APIError) -> InviteResult in
            try await repository.invite(.email("eve@example.com"), to: "l1")
        }

        #expect(outcome.value?.confirmation(invitee: nil) == "Invitation sent to eve@example.com")
    }
}
