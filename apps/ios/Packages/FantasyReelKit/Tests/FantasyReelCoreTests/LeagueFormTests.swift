import Foundation
import Testing
@testable import FantasyReelCore

struct TextLimitTests {
    @Test func countsUTF16LikeTheServer() {
        #expect(TextLimit.clamp("abc", utf16: 5) == "abc")
        #expect(TextLimit.clamp("abcdef", utf16: 4) == "abcd")
        // "🎬" is two UTF-16 units: three of them need 6.
        #expect(TextLimit.clamp("🎬🎬🎬", utf16: 5) == "🎬🎬")
    }

    @Test func neverSplitsACharacter() {
        let clamped = TextLimit.clamp("ab🎬", utf16: 3)
        #expect(clamped == "ab")
        #expect(clamped.utf16.count <= 3)
    }
}

struct CreateLeagueFormTests {
    @Test func freshFormIsCleanAndNeedsAName() {
        let form = CreateLeagueForm()
        #expect(!form.isDirty)
        #expect(form.validationMessage == "Please enter a league name")
    }

    @Test func nameLengthCountsUTF16() {
        var form = CreateLeagueForm()
        form.name = String(repeating: "🎬", count: 128) // 256 UTF-16 units, 128 characters
        #expect(form.validationMessage == "League name can be at most 255 characters")
        form.clampNames()
        #expect(form.name.utf16.count <= CreateLeagueRequest.maxNameLength)
        #expect(form.validationMessage == nil)
    }

    @Test func requestTrimsAndOmitsBlankTeamName() {
        var form = CreateLeagueForm()
        form.name = "  Popcorn Syndicate "
        form.teamName = "   "
        #expect(form.isDirty)
        let request = form.request
        #expect(request.name == "Popcorn Syndicate")
        #expect(request.teamName == nil)
    }

    @Test func draftSlotsCannotExceedRoster() {
        var form = CreateLeagueForm()
        form.name = "League"
        form.totalSlots = 3
        form.draftSlots = 5
        #expect(form.validationMessage == "Draft slots cannot exceed total slots")
        #expect(form.request.draftSlots == 3)
        #expect(form.openSlotsAfterDraft == 0)
    }
}

struct JoinLeagueFormTests {
    @Test func linkCodeIsNotUnsavedInput() {
        var form = JoinLeagueForm(code: "k7mp-q2xw")
        #expect(form.code == "K7MPQ2XW")
        #expect(!form.hasUnsavedInput)
        form.code = "K7MPQ2"
        #expect(form.hasUnsavedInput)
    }

    @Test func validatesTheCode() {
        #expect(JoinLeagueForm().request() == .failure(.missingCode))
        #expect(JoinLeagueForm(code: "K7MPQ2X0").request() == .failure(.invalidCode))
        var form = JoinLeagueForm(code: "K7MPQ2XW")
        form.teamName = " Reel Deal "
        #expect(form.request() == .success(JoinLeagueRequest(route: .code("K7MPQ2XW"), teamName: "Reel Deal")))
    }

    @Test func pastedInvitationSwitchesMode() {
        var form = JoinLeagueForm()
        form.apply(JoinCode.parse("https://fantasyreel.com/join?token=abc"))
        #expect(form.mode == .invitation(token: "abc"))
        #expect(form.canSubmit)
        #expect(form.request() == .success(JoinLeagueRequest(route: .invitation(token: "abc"))))
    }

    @Test func clampsTeamNameByUTF16() {
        var form = JoinLeagueForm()
        form.teamName = String(repeating: "🎬", count: 60) // 120 units
        form.clampTeamName()
        #expect(form.teamName.utf16.count == CreateLeagueRequest.maxTeamNameLength)
    }
}

struct InviteConfirmationTests {
    @Test func namesTheInviteeForUsernameInvitations() {
        let sent = InviteResult(message: "Invitation sent to e***@example.com")
        #expect(sent.confirmation(invitee: "Eve Lumet") == "Invitation sent to Eve Lumet")
        #expect(sent.confirmation(invitee: nil) == "Invitation sent to e***@example.com")
        let pending = InviteResult(emailSent: false, message: "Invitation created")
        #expect(pending.confirmation(invitee: "Eve Lumet") == "Invitation created for Eve Lumet (email delivery pending)")
    }
}
