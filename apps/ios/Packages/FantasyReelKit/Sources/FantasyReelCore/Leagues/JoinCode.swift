import Foundation

/// Share codes and pasted join links, as `utils/joinCode.ts` and the web's
/// join page treat them (F-05).
public enum JoinCode {
    /// New codes are 8 characters from this alphabet; older 6-character codes
    /// still work. No I, L, O, 0 or 1.
    public static let alphabet = Set("ABCDEFGHJKMNPQRSTUVWXYZ23456789")
    public static let invalidFormatMessage =
        "Invalid code format. Codes are 6 or 8 characters, letters and numbers, without I, L, O, 0 or 1."

    /// Uppercases and drops the spaces and dashes people add for readability.
    /// Any other character is kept so validation can report it, rather than
    /// silently changing what the person typed.
    public static func normalize(_ value: String) -> String {
        String(value.uppercased().filter { !$0.isWhitespace && $0 != "-" })
    }

    /// True for a normalized 6- or 8-character code from the alphabet.
    public static func isValid(_ code: String) -> Bool {
        (code.count == 6 || code.count == 8) && code.allSatisfy { alphabet.contains($0) }
    }

    /// What someone typed or pasted into the join field.
    public enum Input: Sendable, Hashable {
        case code(String)
        case invitation(token: String)
    }

    /// Reads a bare code, a join link (`…/join?code=`), or an email invitation
    /// link (`…/join?token=`). A link pasted without its scheme parses too.
    public static func parse(_ input: String) -> Input {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let items = queryItems(of: value)
        if let token = items.first(where: { $0.name == "token" })?.value, !token.isEmpty {
            return .invitation(token: token)
        }
        let code = items.first(where: { $0.name == "code" })?.value ?? value
        return .code(normalize(code))
    }

    private static func queryItems(of value: String) -> [URLQueryItem] {
        guard value.contains("?") else { return [] }
        let candidate = value.contains("://") ? value : "https://link.invalid/\(value)"
        return URLComponents(string: candidate)?.queryItems ?? []
    }

    /// The link the owner shares: `https://fantasyreel.com/join?code=K7MPQ2XW`.
    public static func shareURL(code: String, siteURL: URL) -> URL {
        var components = URLComponents(url: siteURL.appending(path: "join"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "code", value: code)]
        return components.url!
    }

    /// An email invitation's link: `https://fantasyreel.com/join?token=…`.
    public static func invitationURL(token: String, siteURL: URL) -> URL {
        var components = URLComponents(url: siteURL.appending(path: "join"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "token", value: token)]
        return components.url!
    }
}
