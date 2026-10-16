import FantasyReelCore
import Foundation
import Supabase

/// Owns the one `SupabaseClient` the app uses.
///
/// Sessions are stored in the Keychain by the SDK's default storage, refreshed
/// automatically, and use PKCE so email links and OAuth results only complete
/// in the app that asked for them (F-02, N-02). PostgREST reads decode with
/// `FRJSON`, the same decoder the Edge Function client uses, so a model decodes
/// identically whichever path fetched it.
public final class SupabaseProvider: Sendable {
    public let client: SupabaseClient
    public let configuration: AppConfiguration

    public init(configuration: AppConfiguration) {
        self.configuration = configuration
        self.client = SupabaseClient(
            supabaseURL: configuration.supabaseURL,
            supabaseKey: configuration.supabaseAnonKey,
            options: SupabaseClientOptions(
                db: .init(encoder: FRJSON.makeEncoder(), decoder: FRJSON.makeDecoder()),
                auth: .init(
                    redirectToURL: configuration.authCallbackURL,
                    flowType: .pkce
                )
            )
        )
    }

    /// The signed-in user's ID in the lowercase form Postgres returns, or nil.
    ///
    /// `UUID.uuidString` is uppercase; comparing it with IDs read from the
    /// database would never match, so always go through this.
    public var currentUserID: UserID? {
        client.auth.currentUser.map { UserID(rawValue: $0.id.uuidString.lowercased()) }
    }

    /// A valid access token, refreshing the session first if it has expired.
    /// Nil when nobody is signed in.
    public func accessToken() async -> String? {
        try? await client.auth.session.accessToken
    }
}
