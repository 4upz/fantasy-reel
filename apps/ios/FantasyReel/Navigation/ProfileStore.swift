import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation

/// The signed-in user's profile row (display name, photo), shared by the menu
/// avatar and the Account screen so an edit shows everywhere at once (F-03).
/// Lives as long as one account's signed-in tree.
@Observable
@MainActor
final class ProfileStore {
    private(set) var profile: Profile?
    private(set) var hasLoaded = false

    private let userID: UserID
    private let repository: any ProfileRepository

    init(userID: UserID, repository: any ProfileRepository) {
        self.userID = userID
        self.repository = repository
    }

    /// Re-reads the row. A failure keeps what was already shown.
    func refresh() async {
        if let fresh = try? await repository.fetchProfile(for: userID) {
            profile = fresh
        }
        hasLoaded = true
    }

    /// Applies a change the server has already saved, without a round trip.
    func apply(displayName: String) {
        profile?.displayName = displayName
    }

    func apply(avatarURL: String?) {
        profile?.avatarURL = avatarURL
    }
}
