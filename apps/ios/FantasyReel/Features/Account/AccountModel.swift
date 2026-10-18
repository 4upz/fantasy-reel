import FantasyReelAPI
import FantasyReelCore
import Foundation
import Observation

/// State and actions behind the Account screen (F-03, F-02, L-01): the
/// sign-in methods, the Season recaps switch, the profile photo, and
/// connecting or disconnecting providers. Each action keeps its own error
/// inline, so a failed photo upload doesn't hide a failed toggle.
@Observable
@MainActor
final class AccountModel {
    private(set) var methods: LoadState<SignInMethods> = .idle
    /// Nil until read; a read failure leaves it nil and shows `recapsError`.
    private(set) var seasonRecaps: Bool?
    private(set) var recapsError: String?

    let photo = AsyncAction()
    let connection = AsyncAction()
    let recaps = AsyncAction()

    private let userID: UserID
    private let session: SessionStore
    private let account: any AccountRepository
    private let storage: any AvatarStorage
    private let profiles: ProfileStore

    init(userID: UserID, session: SessionStore, account: any AccountRepository, storage: any AvatarStorage, profiles: ProfileStore) {
        self.userID = userID
        self.session = session
        self.account = account
        self.storage = storage
        self.profiles = profiles
    }

    /// Reads the sign-in methods and the email preference together. Coming
    /// back to Account doesn't re-read what is already shown; pull to refresh
    /// passes `force`.
    func load(force: Bool = false) async {
        if !force, methods.value != nil, seasonRecaps != nil { return }
        if methods.value == nil { methods = .loading }
        async let methodsResult: Void = loadMethods()
        async let recapsResult: Void = loadRecaps()
        _ = await (methodsResult, recapsResult)
    }

    private func loadMethods() async {
        do {
            methods = .loaded(try await session.signInMethods())
        } catch {
            // Keep what is already shown; only a first load turns into an error.
            if methods.value == nil { methods = .failed(message: error.userMessage) }
        }
    }

    private func loadRecaps() async {
        do {
            seasonRecaps = try await account.seasonRecapEmails(for: userID)
            recapsError = nil
        } catch {
            if seasonRecaps == nil { recapsError = error.userMessage }
        }
    }

    // MARK: Email

    /// Flips the switch at once and puts it back if the save fails.
    func setSeasonRecaps(_ enabled: Bool) {
        guard !recaps.isRunning else { return }
        let previous = seasonRecaps
        seasonRecaps = enabled
        recaps.run { [self] in
            do {
                try await account.setSeasonRecapEmails(enabled, for: userID)
            } catch {
                seasonRecaps = previous
                throw error
            }
        }
    }

    // MARK: Photo

    /// Uploads over the one stored photo, saves its URL, then clears any older
    /// files. The file is replaced before the URL is saved (as on the web), so
    /// a save lost to the network is retried once before it's reported.
    func upload(_ image: AvatarImage.Prepared) {
        photo.run { [self] in
            let url = try await storage.upload(image, to: .profiles, folder: userID.rawValue)
            do throws(APIError) {
                try await account.updateAvatarURL(url, for: userID)
            } catch {
                guard error.isUncertainOutcome else { throw error }
                try await account.updateAvatarURL(url, for: userID)
            }
            profiles.apply(avatarURL: url)
            Announcer.announce("Profile photo updated.")
            cleanUpPhotos(keepCurrent: true)
        }
    }

    func removePhoto() {
        photo.run { [self] in
            try await account.updateAvatarURL(nil, for: userID)
            profiles.apply(avatarURL: nil)
            Announcer.announce("Profile photo removed.")
            cleanUpPhotos(keepCurrent: false)
        }
    }

    /// Clears files older uploads left behind, without holding the spinner.
    private func cleanUpPhotos(keepCurrent: Bool) {
        let (storage, folder) = (storage, userID.rawValue)
        Task { await storage.removeFiles(in: .profiles, folder: folder, keepCurrent: keepCurrent) }
    }

    /// A pick that never reached the server (unreadable, too large).
    func reportPhotoProblem(_ message: String) {
        photo.run { throw APIError.server(APIError.ServerError(status: nil, message: message, code: nil)) }
    }

    // MARK: Connected accounts

    /// Connects Google or Discord. `authenticate` runs the provider's page in a
    /// web authentication session and returns its callback, or nil when the
    /// person closed it.
    func connect(_ provider: AuthService.OAuthProvider, authenticate: @escaping @MainActor (URL) async throws -> URL?) {
        connection.run { [self] in
            let url = try await session.identityLinkURL(for: provider)
            guard let callback = try await authenticate(url) else { return }
            try await session.completeIdentityLink(from: callback)
            await loadMethods()
            Announcer.announce("\(provider.displayName) connected.")
        }
    }

    /// Connects Apple from a native Apple authorization (L-01).
    func connectApple(idToken: String, nonce: String) {
        connection.run { [self] in
            try await session.linkApple(idToken: idToken, nonce: nonce)
            await loadMethods()
            Announcer.announce("Apple connected.")
        }
    }

    func disconnect(_ identity: LinkedIdentity, name: String) {
        connection.run { [self] in
            try await session.unlink(identity)
            await loadMethods()
            Announcer.announce("\(name) disconnected.")
        }
    }

    /// Shows a failure from outside the model (Apple's sheet, say) in the
    /// connected-accounts error slot.
    func reportConnectionProblem(_ error: any Error) {
        connection.run { throw error }
    }
}

extension AuthService.OAuthProvider {
    var displayName: String {
        switch self {
        case .apple: "Apple"
        case .google: "Google"
        case .discord: "Discord"
        }
    }
}
