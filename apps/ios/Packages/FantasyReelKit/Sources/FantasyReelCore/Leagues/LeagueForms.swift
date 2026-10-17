import Foundation

/// Text limits counted the way the web and the Edge Functions count them:
/// JavaScript string length, which is UTF-16 code units.
public enum TextLimit {
    /// `text` cut to at most `limit` UTF-16 units, never splitting a character
    /// (an emoji over the limit is dropped whole rather than left half-encoded).
    public static func clamp(_ text: String, utf16 limit: Int) -> String {
        guard text.utf16.count > limit else { return text }
        var result = ""
        var used = 0
        for character in text {
            let width = character.utf16.count
            if used + width > limit { break }
            result.append(character)
            used += width
        }
        return result
    }
}

// MARK: - Create league

/// The create-league form's values. Defaults and limits are `create-league`'s
/// (and the web's `CreateLeagueModal`); the server stays authoritative.
public struct CreateLeagueForm: Sendable, Hashable {
    public static let participantRange = 2...20
    public static let totalSlotRange = 1...20
    public static let minDraftSlots = 1
    public static let dropLimitRange = 0...10
    public static let counterbidHourRange = 1...72
    /// 0 turns the cutoff off (new bids stay open all week).
    public static let newBidCutoffRange = 0...144
    public static let draftCounterpickRange = 0...5
    public static let biddingCounterpickRange = 0...3

    public var name = ""
    public var teamName = ""
    public var maxParticipants = 8
    public var inviteOnly = false
    public var totalSlots = 8
    public var draftSlots = 5
    public var dropLimit = 2
    public var counterbidHours = 24
    public var newBidCutoffHours = 48
    public var draftCounterpickSlots = 1
    public var biddingCounterpickSlots = 0
    public var counterpicksBlockDrops = true

    public init() {}

    public var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    public var trimmedTeamName: String { teamName.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// The draft slots range for the current roster size.
    public var draftSlotRange: ClosedRange<Int> { Self.minDraftSlots...max(Self.minDraftSlots, totalSlots) }

    /// Slots left for pickups after the draft.
    public var openSlotsAfterDraft: Int { max(0, totalSlots - draftSlots) }

    /// True once anything differs from a fresh form.
    public var isDirty: Bool { self != CreateLeagueForm() }

    /// The first problem that would make `create-league` refuse the form.
    /// Lengths are UTF-16 units, as the server counts them.
    public var validationMessage: String? {
        if trimmedName.isEmpty { return "Please enter a league name" }
        if trimmedName.utf16.count > CreateLeagueRequest.maxNameLength {
            return "League name can be at most \(CreateLeagueRequest.maxNameLength) characters"
        }
        if trimmedTeamName.utf16.count > CreateLeagueRequest.maxTeamNameLength {
            return "Team name can be at most \(CreateLeagueRequest.maxTeamNameLength) characters"
        }
        if draftSlots > totalSlots { return "Draft slots cannot exceed total slots" }
        return nil
    }

    /// Keeps typed names within the server's limits (call after each edit).
    public mutating func clampNames() {
        let clampedName = TextLimit.clamp(name, utf16: CreateLeagueRequest.maxNameLength)
        if clampedName != name { name = clampedName }
        let clampedTeam = TextLimit.clamp(teamName, utf16: CreateLeagueRequest.maxTeamNameLength)
        if clampedTeam != teamName { teamName = clampedTeam }
    }

    public var request: CreateLeagueRequest {
        CreateLeagueRequest(
            name: trimmedName,
            teamName: trimmedTeamName.isEmpty ? nil : trimmedTeamName,
            inviteOnly: inviteOnly,
            maxParticipants: maxParticipants,
            totalSlots: totalSlots,
            draftSlots: min(draftSlots, totalSlots),
            dropLimit: dropLimit,
            counterbidHours: counterbidHours,
            newBidCutoffHours: newBidCutoffHours,
            draftCounterpickSlots: draftCounterpickSlots,
            biddingCounterpickSlots: biddingCounterpickSlots,
            counterpicksBlockDrops: counterpicksBlockDrops
        )
    }
}

// MARK: - Join league

/// The join form: a share code, or an email invitation's token, plus an
/// optional team name (web `JoinLeagueClient`).
public struct JoinLeagueForm: Sendable, Hashable {
    public enum Mode: Sendable, Hashable {
        case code
        case invitation(token: String)
    }

    /// Why the form can't be sent yet, in the web's words.
    public enum Problem: Error, Sendable, Hashable {
        case missingCode
        case invalidCode

        public var message: String {
            switch self {
            case .missingCode: "Please enter a join code"
            case .invalidCode: JoinCode.invalidFormatMessage
            }
        }
    }

    public var mode: Mode
    public var code: String
    public var teamName: String
    /// The code the form opened with (from a link), so it doesn't count as an edit.
    public let initialCode: String

    /// A form for typing a code (pre-filled from a link when `code` is given).
    public init(code: String = "") {
        let normalized = JoinCode.normalize(code)
        self.mode = .code
        self.code = normalized
        self.teamName = ""
        self.initialCode = normalized
    }

    /// A form for an email invitation link.
    public init(invitationToken: String) {
        self.mode = .invitation(token: invitationToken)
        self.code = ""
        self.teamName = ""
        self.initialCode = ""
    }

    public var trimmedTeamName: String { teamName.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Input the person typed that would be lost by closing the sheet.
    public var hasUnsavedInput: Bool {
        !teamName.isEmpty || (mode == .code && code != initialCode)
    }

    public var canSubmit: Bool {
        switch mode {
        case .code: !code.isEmpty
        case .invitation: true
        }
    }

    /// True when typed text is a link rather than a code.
    public static func looksLikeLink(_ text: String) -> Bool {
        text.contains("?") || text.contains("://")
    }

    /// Applies a pasted code or link: an invitation link switches to
    /// invitation mode; a code (or join link) fills the code.
    public mutating func apply(_ input: JoinCode.Input) {
        switch input {
        case .invitation(let token):
            code = ""
            mode = .invitation(token: token)
        case .code(let parsed):
            mode = .code
            code = parsed
        }
    }

    /// Keeps the team name within the server's limit (call after each edit).
    public mutating func clampTeamName() {
        let clamped = TextLimit.clamp(teamName, utf16: CreateLeagueRequest.maxTeamNameLength)
        if clamped != teamName { teamName = clamped }
    }

    /// The request to send, or why it can't be sent.
    public func request() -> Result<JoinLeagueRequest, Problem> {
        let route: JoinLeagueRequest.Route
        switch mode {
        case .code:
            let normalized = JoinCode.normalize(code)
            guard !normalized.isEmpty else { return .failure(.missingCode) }
            guard JoinCode.isValid(normalized) else { return .failure(.invalidCode) }
            route = .code(normalized)
        case .invitation(let token):
            route = .invitation(token: token)
        }
        let team = trimmedTeamName
        return .success(JoinLeagueRequest(route: route, teamName: team.isEmpty ? nil : team))
    }
}

// MARK: - Invite

extension InviteResult {
    /// The owner's confirmation. Username invitations name the person rather
    /// than the address the server used (web `InviteModal.inviteMessage`);
    /// email invitations use the server's sentence.
    public func confirmation(invitee: String?) -> String {
        guard let invitee else { return message }
        return emailSent
            ? "Invitation sent to \(invitee)"
            : "Invitation created for \(invitee) (email delivery pending)"
    }
}
