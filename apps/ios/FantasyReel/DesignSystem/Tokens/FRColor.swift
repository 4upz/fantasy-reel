import SwiftUI
import UIKit

// Semantic color tokens for Cinematic Dark, taken verbatim from the v2 mockups'
// `.scr` (dark) and `.scr.light` custom properties. Every token is a dynamic
// UIColor, so it follows the system appearance (and the app's light/dark/system
// override via `.preferredColorScheme`) and, for text and separators, Increase
// Contrast.
//
// To add a token: add a `static let` below with both palettes, mirror the CSS
// name in the comment, and list it in DesignSystem/README.md.

nonisolated extension Color {
    // MARK: Canvas

    /// `--bg` page background.
    static let frBackground = FRPalette.color(dark: 0x0F0F0F, light: 0xF5F5F4)
    /// `--sf` card and row-group background.
    static let frSurface = FRPalette.color(dark: 0x1C1C1C, light: 0xFFFFFF)
    /// `--el` raised controls, inputs, neutral buttons, segmented tracks.
    static let frElevated = FRPalette.color(dark: 0x2A2A2A, light: 0xECECEA)
    /// `--bd` borders around inputs and outlined controls.
    static let frBorder = FRPalette.color(dark: 0x2E2E2E, light: 0xD3D2CE)
    /// `--sep` hairline separators between rows.
    static let frSeparator = FRPalette.color(
        dark: 0xFFFFFF, darkAlpha: 0.08,
        light: 0x000000, lightAlpha: 0.09,
        highContrastDark: (0xFFFFFF, 0.22), highContrastLight: (0x000000, 0.24)
    )
    /// Sheet background in light mode is a touch darker than the page (`.light .sheet`).
    static let frSheetBackground = FRPalette.color(dark: 0x0F0F0F, light: 0xF2F2F0)
    /// Selected segment in `.gseg` (`--el` in dark, white in light).
    static let frSegmentSelected = FRPalette.color(dark: 0x2A2A2A, light: 0xFFFFFF)
    /// `--glass-sel`: neutral fill for icon bubbles (`.ibub`) and quiet selections.
    static let frNeutralFill = FRPalette.color(dark: 0xFFFFFF, darkAlpha: 0.13, light: 0x000000, lightAlpha: 0.07)
    /// Pressed-row highlight (web `surface-hover` expressed as an overlay).
    static let frPressed = FRPalette.color(dark: 0xFFFFFF, darkAlpha: 0.06, light: 0x000000, lightAlpha: 0.05)

    // MARK: Text

    /// `--fg` primary text.
    static let frText = FRPalette.color(dark: 0xE8E8E8, light: 0x242424)
    /// `--fg2` secondary text: meaningful small text, meta lines.
    static let frTextSecondary = FRPalette.color(
        dark: 0xB8B0A4, light: 0x55514B,
        highContrastDark: (0xD8D2C8, 1), highContrastLight: (0x3A3632, 1)
    )
    /// `--fg3` muted text: Pending, "at release", chevrons, placeholders.
    static let frTextMuted = FRPalette.color(
        dark: 0x8A8078, light: 0x68625B,
        highContrastDark: (0xB8B0A4, 1), highContrastLight: (0x4A4540, 1)
    )

    // MARK: Brand

    /// `--gold` primary accent: links, primary fills, selection.
    static let frGold = FRPalette.color(dark: 0xC9A227, light: 0x71570C)
    /// `--goldbg` gold tint behind gold text (secondary buttons, gold badges).
    static let frGoldTint = FRPalette.color(dark: 0xC9A227, darkAlpha: 0.14, light: 0x71570C, lightAlpha: 0.10)
    /// `--on-gold` text on a gold fill.
    static let frOnGold = FRPalette.color(dark: 0x0F0F0F, light: 0xFFFFFF)
    /// `--crim` crimson fill (behind white text only).
    static let frCrimson = FRPalette.color(dark: 0xA8505C, light: 0x9B3948)
    /// `--crt` crimson used as text (rotten projections, negative factors).
    static let frCrimsonText = FRPalette.color(dark: 0xE07A86, light: 0x9B3948)

    // MARK: Feedback

    /// `--err` errors, destructive text, negative points.
    static let frError = FRPalette.color(dark: 0xD65C5C, light: 0xB42F2F)
    /// `--errbg`
    static let frErrorTint = FRPalette.color(dark: 0xD65C5C, darkAlpha: 0.14, light: 0xB42F2F, lightAlpha: 0.08)
    /// `--ok` success, active status, positive points.
    static let frSuccess = FRPalette.color(dark: 0x22C55E, light: 0x176B38)
    /// `--okbg`
    static let frSuccessTint = FRPalette.color(dark: 0x22C55E, darkAlpha: 0.13, light: 0x176B38, lightAlpha: 0.08)
    /// `--warn`
    static let frWarning = FRPalette.color(dark: 0xF59E0B, light: 0x8A4B00)
    /// `--warnbg`
    static let frWarningTint = FRPalette.color(dark: 0xF59E0B, darkAlpha: 0.14, light: 0x8A4B00, lightAlpha: 0.08)
    /// `--info`
    static let frInfo = FRPalette.color(dark: 0x3B82F6, light: 0x1D4ED8)
    /// `--infobg`
    static let frInfoTint = FRPalette.color(dark: 0x3B82F6, darkAlpha: 0.15, light: 0x1D4ED8, lightAlpha: 0.08)
    /// `--beta` text of the Beta pill.
    static let frBeta = FRPalette.color(dark: 0x9CC0FF, light: 0x1D4ED8)

    // MARK: Ranks and badges

    /// `--silver` rank 2.
    static let frSilver = FRPalette.color(dark: 0xA8A8A8, light: 0x626262)
    /// `--bronze` rank 3.
    static let frBronze = FRPalette.color(dark: 0xCD7F32, light: 0x8A511D)
    /// `.b-draft` text (drafting / counterpicking).
    static let frBadgeDraft = FRPalette.color(dark: 0xEAB308, light: 0x805B08)
    /// `.b-draft` background.
    static let frBadgeDraftTint = FRPalette.color(dark: 0xEAB308, darkAlpha: 0.14, light: 0x805B08, lightAlpha: 0.08)
    /// `.b-done` text (completed, pre-release).
    static let frBadgeDone = FRPalette.color(dark: 0x94A3B8, light: 0x4B5563)
    /// `.b-done` background.
    static let frBadgeDoneTint = FRPalette.color(dark: 0x64748B, darkAlpha: 0.18, light: 0x4B5563, lightAlpha: 0.08)

    // MARK: Placeholder tiles (same in both appearances)

    /// `.ac1`–`.ac4` avatar fills; initials on them use `frAvatarInk`.
    static let frAvatarTiles: [Color] = ([0xC9A227, 0x7FA8C9, 0xC98A7F, 0x9CC97F] as [UInt32]).map { FRPalette.fixed($0) }
    /// Ink for initials on an avatar tile (`#0f0f0f` in both appearances).
    static let frAvatarInk = FRPalette.fixed(0x0F0F0F)
    /// `.pc1`–`.pc8` poster placeholder fills.
    static let frPosterTiles: [Color] = ([
        0x3B2A4D, 0x24414A, 0x4A2F22, 0x2A3A28, 0x47243A, 0x253049, 0x4A4123, 0x33302D,
    ] as [UInt32]).map { FRPalette.fixed($0) }
}

/// The tone vocabulary shared by badges, banners and tinted cards.
nonisolated enum FRTone: Hashable, Sendable, CaseIterable {
    case info, warning, error, success, gold, draft, done, neutral

    /// Text and icon color for this tone.
    var foreground: Color {
        switch self {
        case .info: .frInfo
        case .warning: .frWarning
        case .error: .frError
        case .success: .frSuccess
        case .gold: .frGold
        case .draft: .frBadgeDraft
        case .done: .frBadgeDone
        case .neutral: .frTextSecondary
        }
    }

    /// Tinted background for this tone.
    var background: Color {
        switch self {
        case .info: .frInfoTint
        case .warning: .frWarningTint
        case .error: .frErrorTint
        case .success: .frSuccessTint
        case .gold: .frGoldTint
        case .draft: .frBadgeDraftTint
        case .done: .frBadgeDoneTint
        case .neutral: .frElevated
        }
    }

    /// Default SF Symbol for banners in this tone. Icons always sit beside words,
    /// so the tone is never the only signal.
    var defaultSymbol: String {
        switch self {
        case .info: "info.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .error: "exclamationmark.octagon.fill"
        case .success: "checkmark.circle.fill"
        case .gold: "star.circle.fill"
        case .draft: "list.number"
        case .done: "checkmark.seal"
        case .neutral: "info.circle"
        }
    }
}

/// Builds dynamic colors. The UIColor provider closure is created in a
/// nonisolated function so it never inherits main-actor isolation; UIKit may
/// resolve colors off the main thread.
nonisolated enum FRPalette {
    static func color(
        dark: UInt32, darkAlpha: CGFloat = 1,
        light: UInt32, lightAlpha: CGFloat = 1,
        highContrastDark: (UInt32, CGFloat)? = nil,
        highContrastLight: (UInt32, CGFloat)? = nil
    ) -> Color {
        // Capture only plain values: the provider may be @Sendable and called off-main.
        let darkHC = highContrastDark ?? (dark, darkAlpha)
        let lightHC = highContrastLight ?? (light, lightAlpha)
        let dynamic = UIColor { traits in
            let highContrast = traits.accessibilityContrast == .high
            // Cinematic Dark is the brand default, so an unspecified style resolves dark.
            if traits.userInterfaceStyle == .light {
                return highContrast ? FRPalette.uiColor(lightHC.0, alpha: lightHC.1) : FRPalette.uiColor(light, alpha: lightAlpha)
            }
            return highContrast ? FRPalette.uiColor(darkHC.0, alpha: darkHC.1) : FRPalette.uiColor(dark, alpha: darkAlpha)
        }
        return Color(uiColor: dynamic)
    }

    static func fixed(_ hex: UInt32, alpha: CGFloat = 1) -> Color {
        Color(uiColor: uiColor(hex, alpha: alpha))
    }

    static func uiColor(_ hex: UInt32, alpha: CGFloat) -> UIColor {
        UIColor(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}

#if DEBUG
private struct FRColorSwatches: View {
    private let swatches: [(String, Color)] = [
        ("background", .frBackground), ("surface", .frSurface), ("elevated", .frElevated),
        ("border", .frBorder), ("gold", .frGold), ("goldTint", .frGoldTint),
        ("text", .frText), ("textSecondary", .frTextSecondary), ("textMuted", .frTextMuted),
        ("error", .frError), ("success", .frSuccess), ("warning", .frWarning), ("info", .frInfo),
        ("silver", .frSilver), ("bronze", .frBronze), ("badgeDraft", .frBadgeDraft), ("badgeDone", .frBadgeDone),
    ]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 12)], spacing: 12) {
                ForEach(swatches, id: \.0) { swatch in
                    VStack(alignment: .leading, spacing: 4) {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(swatch.1)
                            .frame(height: 56)
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.frSeparator))
                        Text(swatch.0).frFont(.caption).foregroundStyle(Color.frTextSecondary)
                    }
                }
            }
            .padding(16)
        }
        .background(Color.frBackground)
    }
}

#Preview("Colors · dark") { FRColorSwatches().preferredColorScheme(.dark) }
#Preview("Colors · light") { FRColorSwatches().preferredColorScheme(.light) }
#endif
