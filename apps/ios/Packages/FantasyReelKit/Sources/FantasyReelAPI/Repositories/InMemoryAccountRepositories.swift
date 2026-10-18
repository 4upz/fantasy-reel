import FantasyReelCore
import Foundation

// Fakes for the Account screen's previews and tests (see InMemoryRepositories.swift).

public actor InMemoryAccountRepository: AccountRepository {
    public var displayNames: [UserID: String] = [:]
    public var avatarURLs: [UserID: String?] = [:]
    public var seasonRecaps: [UserID: Bool] = [:]
    public var deletionOutcome: AccountDeletionOutcome
    public private(set) var deletionRequests: [String?] = []
    public var failure: APIError?

    public init(deletionOutcome: AccountDeletionOutcome = .deleted, failure: APIError? = nil) {
        self.deletionOutcome = deletionOutcome
        self.failure = failure
    }

    public func updateDisplayName(_ name: String, for userID: UserID) async throws(APIError) {
        if let failure { throw failure }
        displayNames[userID] = name
    }

    public func updateAvatarURL(_ url: String?, for userID: UserID) async throws(APIError) {
        if let failure { throw failure }
        avatarURLs[userID] = url
    }

    public func seasonRecapEmails(for userID: UserID) async throws(APIError) -> Bool {
        if let failure { throw failure }
        return seasonRecaps[userID] ?? true
    }

    public func setSeasonRecapEmails(_ enabled: Bool, for userID: UserID) async throws(APIError) {
        if let failure { throw failure }
        seasonRecaps[userID] = enabled
    }

    public func deleteAccount(appleAuthorizationCode: String?) async throws(APIError) -> AccountDeletionOutcome {
        if let failure { throw failure }
        deletionRequests.append(appleAuthorizationCode)
        return deletionOutcome
    }
}

public actor InMemoryAvatarStorage: AvatarStorage {
    public private(set) var objects: [String: Data] = [:]

    public init() {}

    public func upload(_ image: AvatarImage.Prepared, to bucket: AvatarBucket, folder: String) async throws(APIError) -> String {
        let path = "\(bucket.rawValue)/\(folder)/avatar"
        objects[path] = image.data
        return "https://example.invalid/storage/v1/object/public/\(path)?v=1"
    }

    public func removeFiles(in bucket: AvatarBucket, folder: String, keepCurrent: Bool) async {
        guard !keepCurrent else { return }
        objects["\(bucket.rawValue)/\(folder)/avatar"] = nil
    }
}
