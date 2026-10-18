import Foundation

/// Display name rules, as the web's settings action checks them (F-03):
/// trimmed, 1–100 characters. The same limit applies to team names (F-10).
public enum DisplayName {
    public static let maxLength = 100

    public static let required = "Display name is required"
    public static let tooLong = "Display name must be \(maxLength) characters or less"

    public static func trimmed(_ name: String) -> String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Nil when `name` can be saved; otherwise the reason it can't.
    public static func problem(_ name: String) -> String? {
        let value = trimmed(name)
        if value.isEmpty { return required }
        // UTF-16 units, as the web counts, so a name saved here also saves there.
        if value.utf16.count > maxLength { return tooLong }
        return nil
    }
}
