import Foundation

/// The public, per-build settings the app needs to reach the shared backend.
///
/// Values come from `Config/*.xcconfig` through Info.plist keys, so a build for
/// local Supabase and a build for production differ only in configuration, never
/// in code (requirements N-01). Only public values belong here: the anon key is
/// the same one the web app ships to every browser.
public struct AppConfiguration: Sendable, Equatable {
    public let supabaseURL: URL
    public let supabaseAnonKey: String
    /// The public website (`https://fantasyreel.com`). Shared links on this host
    /// and its `www.` twin open the matching screen in the app.
    public let siteURL: URL
    /// The custom URL scheme registered in Info.plist (`fantasyreel`).
    public let urlScheme: String
    /// The public Cloudflare Turnstile site key, the web's
    /// `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Nil turns the security check off, which
    /// is right for local Supabase (CAPTCHA off there) and wrong for production
    /// (N-03), so Release refuses to launch with the placeholder.
    public let turnstileSiteKey: String?
    /// The Fantasy Reel bot's public Discord application ID, the web's
    /// `NEXT_PUBLIC_DISCORD_CLIENT_ID` (Info.plist `FRDiscordClientID`). Nil
    /// hides the "Add to Discord" install button; the bot guide still shows.
    public let discordClientID: String?

    public init(
        supabaseURL: URL,
        supabaseAnonKey: String,
        siteURL: URL,
        urlScheme: String,
        turnstileSiteKey: String? = nil,
        discordClientID: String? = nil
    ) {
        self.supabaseURL = supabaseURL
        self.supabaseAnonKey = supabaseAnonKey
        self.siteURL = siteURL
        self.urlScheme = urlScheme
        self.turnstileSiteKey = turnstileSiteKey
        self.discordClientID = discordClientID
    }

    /// Where Supabase sends OAuth and email-link results: `fantasyreel://auth/callback`.
    /// It must be in the Supabase project's redirect allowlist.
    public var authCallbackURL: URL {
        // Built from components so a scheme typo can't produce a malformed URL.
        var components = URLComponents()
        components.scheme = urlScheme
        components.host = "auth"
        components.path = "/callback"
        return components.url ?? URL(string: "fantasyreel://auth/callback")!
    }

    /// The callback for password-reset emails. PKCE sign-ins report only
    /// `signedIn`, so the query marks the session as a recovery.
    public var recoveryCallbackURL: URL {
        var components = URLComponents(url: authCallbackURL, resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: Self.flowQueryName, value: Self.recoveryFlow)]
        return components?.url ?? authCallbackURL
    }

    public static let flowQueryName = "flow"
    public static let recoveryFlow = "recovery"

    /// Whether an auth callback came from a password-reset email.
    public static func isRecoveryCallback(_ url: URL) -> Bool {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .contains { $0.name == flowQueryName && $0.value == recoveryFlow } ?? false
    }

    /// Hosts whose links the app treats as its own.
    public var siteHosts: Set<String> {
        guard let host = siteURL.host()?.lowercased() else { return [] }
        let bare = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
        return [bare, "www.\(bare)"]
    }

    public enum LoadError: Error, Equatable, Sendable, CustomStringConvertible {
        case missing(key: String)
        case placeholder(key: String)
        case invalidURL(key: String, value: String)

        public var description: String {
            switch self {
            case .missing(let key):
                return "\(key) is missing from Info.plist. Check Config/*.xcconfig."
            case .placeholder(let key):
                return "\(key) still has its placeholder value. Set it in Config/Local.xcconfig."
            case .invalidURL(let key, let value):
                return "\(key) is not a valid URL: \(value)"
            }
        }
    }

    /// Reads the configuration from an Info.plist dictionary.
    public static func load(from info: [String: Any]) throws(LoadError) -> AppConfiguration {
        func string(_ key: String) throws(LoadError) -> String {
            guard let value = (info[key] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !value.isEmpty,
                  !value.hasPrefix("$(") // build setting was never substituted
            else { throw .missing(key: key) }
            if value.contains("YOUR-PROJECT") || value.hasPrefix("REPLACE_WITH") {
                throw .placeholder(key: key)
            }
            return value
        }
        /// An optional setting: empty (or never defined) means off.
        func optionalString(_ key: String) throws(LoadError) -> String? {
            guard let value = (info[key] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !value.isEmpty,
                  !value.hasPrefix("$(")
            else { return nil }
            if value.hasPrefix("REPLACE_WITH") { throw .placeholder(key: key) }
            return value
        }
        func url(_ key: String) throws(LoadError) -> URL {
            let value = try string(key)
            guard let url = URL(string: value), let scheme = url.scheme, scheme.hasPrefix("http"), url.host() != nil else {
                throw .invalidURL(key: key, value: value)
            }
            return url
        }

        return AppConfiguration(
            supabaseURL: try url("FRSupabaseURL"),
            supabaseAnonKey: try string("FRSupabaseAnonKey"),
            siteURL: try url("FRSiteURL"),
            urlScheme: try string("FRURLScheme"),
            turnstileSiteKey: try optionalString("FRTurnstileSiteKey"),
            discordClientID: try optionalString("FRDiscordClientID")
        )
    }

    /// Reads the configuration from the main bundle's Info.plist.
    public static func fromMainBundle() throws(LoadError) -> AppConfiguration {
        try load(from: Bundle.main.infoDictionary ?? [:])
    }
}
