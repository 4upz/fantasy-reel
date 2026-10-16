import CoreText
import SwiftUI
import UIKit

// Fantasy Reel typography (docs/brand/typography.md, mapped to native roles).
//
// Bricolage Grotesque: headings and numbers. DM Sans: body, controls, row
// titles and metadata. Both bundled files are *variable* fonts whose default
// instances are wrong for us (Bricolage defaults to 96pt optical size at
// ExtraBold, DM Sans to 9pt optical size), so every font sets its weight,
// optical size and (Bricolage) width axes explicitly.
//
// Sizes scale with Dynamic Type through UIFontMetrics against each role's text
// style, and `.frFont(_:)` re-resolves when the environment's dynamic type size
// changes, so text updates live.

/// The two brand families.
nonisolated enum FRFontFamily: String, CaseIterable, Sendable {
    case bricolage
    case dmSans

    /// Resource name of the bundled TTF (Resources/Fonts).
    var fileName: String {
        switch self {
        case .bricolage: "bricolage"
        case .dmSans: "dm-sans"
        }
    }

    /// PostScript name of the default instance, used if the registered
    /// descriptor cannot be read back.
    var defaultPostScriptName: String {
        switch self {
        case .bricolage: "BricolageGrotesque-96ptExtraBold"
        case .dmSans: "DMSans-9ptRegular"
        }
    }

    /// Prefix of `UIFont.familyName` once the font resolved to this family.
    var familyNamePrefix: String {
        switch self {
        case .bricolage: "Bricolage"
        case .dmSans: "DM Sans"
        }
    }

    var opticalSizeRange: ClosedRange<CGFloat> {
        switch self {
        case .bricolage: 12...96
        case .dmSans: 9...40
        }
    }

    var weightRange: ClosedRange<CGFloat> {
        switch self {
        case .bricolage: 200...800
        case .dmSans: 100...1000
        }
    }
}

/// Everything needed to build one role's font.
nonisolated struct FRTextSpec {
    let family: FRFontFamily
    /// Variable `wght` axis value.
    let weight: CGFloat
    /// Size at the default (Large) content size category.
    let size: CGFloat
    /// The Dynamic Type style this role scales with.
    let textStyle: UIFont.TextStyle
    /// Tracking in em (multiplied by the rendered point size).
    let trackingEm: CGFloat
    /// Number roles: optical size 12, width 100, tabular + lining figures.
    let isNumeric: Bool
    /// `.frFont(_:)` uppercases the text (overline).
    let isUppercase: Bool

    init(
        _ family: FRFontFamily, _ weight: CGFloat, _ size: CGFloat, _ textStyle: UIFont.TextStyle,
        tracking: CGFloat = 0, numeric: Bool = false, uppercase: Bool = false
    ) {
        self.family = family
        self.weight = weight
        self.size = size
        self.textStyle = textStyle
        self.trackingEm = tracking
        self.isNumeric = numeric
        self.isUppercase = uppercase
    }
}

/// Text roles from the mockups and the typography guide. Apply with `.frFont(_:)`.
nonisolated enum FRTextRole: Hashable, Sendable, CaseIterable {
    /// `.lt` screen title: Bricolage 700, 34.
    case largeTitle
    /// Movie detail title / Welcome headline: Bricolage 700, 28.
    case pageTitle
    /// `.h2` empty states and dialog titles: Bricolage 700, 22.
    case panelTitle
    /// `.sh h2` section header: Bricolage 600, 20.
    case sectionTitle
    /// `.h3` card title (team name in a card): Bricolage 700, 17.
    case cardTitle
    /// Reading text: DM Sans 400, 16.
    case body
    /// Dense supporting copy, alerts: DM Sans 400, 14.
    case bodySmall
    /// Text field input (`.field input`): DM Sans 400, 17.
    case input
    /// `.rt` movie/team title in a row: DM Sans 600, 16.
    case rowTitle
    /// A plain row's label (menu and settings rows): DM Sans 500, 16.
    case rowLabel
    /// Large button label (`.btn`): DM Sans 600, 17.
    case control
    /// Compact button and selected segment: DM Sans 600, 15.
    case controlSmall
    /// Labels, segment titles, section accessory: DM Sans 500, 15.
    case label
    /// `.meta` dates, compact status: DM Sans 500, 13.
    case meta
    /// "at release", small captions: DM Sans 500, 12.
    case caption
    /// `.badge` text: DM Sans 600, 12.
    case captionStrong
    /// Small group label above a list ("YOUR LEAGUES"): DM Sans 600, 13,
    /// tracking 0.05em. `.frFont(.overline)` uppercases the text itself
    /// (`.textCase(.uppercase)`), so pass sentence-case strings; VoiceOver still
    /// reads the original string.
    case overline
    /// `.trail .v` / `.rank` points and ranks: Bricolage 700, 17, numeric.
    case number
    /// `.statv small` suffixes and small amounts: Bricolage 600, 15, numeric.
    case numberSmall
    /// `.statv` stat values: Bricolage 700, 24, numeric.
    case numberLarge
    /// Big Rotten Tomatoes score: Bricolage 700, 44, numeric.
    case numberHero

    var spec: FRTextSpec {
        switch self {
        case .largeTitle: FRTextSpec(.bricolage, 700, 34, .largeTitle, tracking: -0.02)
        case .pageTitle: FRTextSpec(.bricolage, 700, 28, .title1, tracking: -0.02)
        case .panelTitle: FRTextSpec(.bricolage, 700, 22, .title2, tracking: -0.015)
        case .sectionTitle: FRTextSpec(.bricolage, 600, 20, .title3, tracking: -0.01)
        case .cardTitle: FRTextSpec(.bricolage, 700, 17, .headline, tracking: -0.01)
        case .body: FRTextSpec(.dmSans, 400, 16, .body)
        case .bodySmall: FRTextSpec(.dmSans, 400, 14, .subheadline)
        case .input: FRTextSpec(.dmSans, 400, 17, .body)
        case .rowTitle: FRTextSpec(.dmSans, 600, 16, .body)
        case .rowLabel: FRTextSpec(.dmSans, 500, 16, .body)
        case .control: FRTextSpec(.dmSans, 600, 17, .body)
        case .controlSmall: FRTextSpec(.dmSans, 600, 15, .subheadline)
        case .label: FRTextSpec(.dmSans, 500, 15, .subheadline)
        case .meta: FRTextSpec(.dmSans, 500, 13, .footnote)
        case .caption: FRTextSpec(.dmSans, 500, 12, .caption1)
        case .captionStrong: FRTextSpec(.dmSans, 600, 12, .caption1)
        case .overline: FRTextSpec(.dmSans, 600, 13, .footnote, tracking: 0.05, uppercase: true)
        case .number: FRTextSpec(.bricolage, 700, 17, .body, numeric: true)
        case .numberSmall: FRTextSpec(.bricolage, 600, 15, .subheadline, numeric: true)
        case .numberLarge: FRTextSpec(.bricolage, 700, 24, .title2, numeric: true)
        case .numberHero: FRTextSpec(.bricolage, 700, 44, .largeTitle, numeric: true)
        }
    }
}

/// Font registration and construction. Main-actor isolated: the caches are only
/// touched from view bodies and app launch.
@MainActor
enum FRFonts {
    /// Variation axis tags as 4-character codes.
    private enum Axis {
        static let weight = 0x7767_6874 // 'wght'
        static let opticalSize = 0x6F70_737A // 'opsz'
        static let width = 0x7764_7468 // 'wdth'
    }

    private struct RoleKey: Hashable {
        let role: FRTextRole
        let dynamicTypeSize: DynamicTypeSize
        let boldText: Bool
    }

    private struct FixedKey: Hashable {
        let family: FRFontFamily
        let weight: CGFloat
        let size: CGFloat
        let numeric: Bool
    }

    private static var didAttemptRegistration = false
    private static var postScriptNames: [FRFontFamily: String] = [:]
    private static var roleCache: [RoleKey: UIFont] = [:]
    private static var fixedCache: [FixedKey: UIFont] = [:]

    /// Registers both bundled fonts for this process. Idempotent and cheap after
    /// the first call; call it at launch. Font lookups also call it lazily, so
    /// previews work without it.
    static func registerIfNeeded() {
        guard !didAttemptRegistration else { return }
        didAttemptRegistration = true
        for family in FRFontFamily.allCases {
            guard let url = Bundle.main.url(forResource: family.fileName, withExtension: "ttf")
                ?? Bundle.main.url(forResource: family.fileName, withExtension: "ttf", subdirectory: "Fonts")
            else { continue }

            var error: Unmanaged<CFError>?
            var available = CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error)
            if !available, let cfError = error?.takeRetainedValue(),
               CFErrorGetCode(cfError) == CTFontManagerError.alreadyRegistered.rawValue {
                available = true
            }
            if available {
                postScriptNames[family] = postScriptName(at: url) ?? family.defaultPostScriptName
            }
        }
        roleCache.removeAll()
        fixedCache.removeAll()
    }

    /// Whether a brand family is available; when not, roles fall back to the system font.
    static func isAvailable(_ family: FRFontFamily) -> Bool {
        registerIfNeeded()
        return postScriptNames[family] != nil
    }

    /// The UIFont for a role at a Dynamic Type size, cached per (role, size, bold text).
    static func uiFont(
        for role: FRTextRole,
        dynamicTypeSize: DynamicTypeSize = .large,
        boldText: Bool = false
    ) -> UIFont {
        registerIfNeeded()
        let key = RoleKey(role: role, dynamicTypeSize: dynamicTypeSize, boldText: boldText)
        if let cached = roleCache[key] { return cached }

        let spec = role.spec
        let traits = UITraitCollection(preferredContentSizeCategory: contentSizeCategory(for: dynamicTypeSize))
        let size = UIFontMetrics(forTextStyle: spec.textStyle).scaledValue(for: spec.size, compatibleWith: traits)
        let weight = boldText ? min(spec.weight + 100, spec.family.weightRange.upperBound) : spec.weight
        let font = makeFont(family: spec.family, weight: weight, size: size, numeric: spec.isNumeric)
        roleCache[key] = font
        return font
    }

    /// A SwiftUI font for a role (prefer `.frFont(_:)`, which also applies tracking
    /// and follows the environment's Dynamic Type size).
    static func font(
        for role: FRTextRole,
        dynamicTypeSize: DynamicTypeSize = .large,
        boldText: Bool = false
    ) -> Font {
        Font(uiFont(for: role, dynamicTypeSize: dynamicTypeSize, boldText: boldText) as CTFont)
    }

    /// A brand font at a fixed size that does not scale with Dynamic Type. Only for
    /// text inside fixed-size artwork (avatar initials, poster placeholders).
    static func fixedFont(_ family: FRFontFamily, weight: CGFloat, size: CGFloat, numeric: Bool = false) -> Font {
        registerIfNeeded()
        let key = FixedKey(family: family, weight: weight, size: size, numeric: numeric)
        if let cached = fixedCache[key] { return Font(cached as CTFont) }
        let font = makeFont(family: family, weight: weight, size: size, numeric: numeric)
        fixedCache[key] = font
        return Font(font as CTFont)
    }

    // MARK: - Construction

    private static func makeFont(family: FRFontFamily, weight: CGFloat, size: CGFloat, numeric: Bool) -> UIFont {
        guard let name = postScriptNames[family] else {
            return systemFallback(weight: weight, size: size, numeric: numeric)
        }

        // Numbers keep optical size 12; everything else follows the rendered size
        // like CSS `font-optical-sizing: auto`.
        let range = family.opticalSizeRange
        let opticalSize = numeric ? 12 : min(max(size, range.lowerBound), range.upperBound)

        var axes: [NSNumber: NSNumber] = [
            NSNumber(value: Axis.weight): NSNumber(value: Double(weight)),
            NSNumber(value: Axis.opticalSize): NSNumber(value: Double(opticalSize)),
        ]
        if family == .bricolage {
            axes[NSNumber(value: Axis.width)] = NSNumber(value: 100.0)
        }

        var attributes: [UIFontDescriptor.AttributeName: Any] = [
            .name: name,
            UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): axes,
        ]
        if numeric {
            attributes[.featureSettings] = [
                [
                    UIFontDescriptor.FeatureKey.type: kNumberSpacingType,
                    UIFontDescriptor.FeatureKey.selector: kMonospacedNumbersSelector,
                ],
                [
                    UIFontDescriptor.FeatureKey.type: kNumberCaseType,
                    UIFontDescriptor.FeatureKey.selector: kUpperCaseNumbersSelector,
                ],
            ]
        }

        let font = UIFont(descriptor: UIFontDescriptor(fontAttributes: attributes), size: size)
        guard font.familyName.hasPrefix(family.familyNamePrefix) else {
            return systemFallback(weight: weight, size: size, numeric: numeric)
        }
        return font
    }

    private static func systemFallback(weight: CGFloat, size: CGFloat, numeric: Bool) -> UIFont {
        let systemWeight: UIFont.Weight
        switch weight {
        case ..<250: systemWeight = .thin
        case ..<350: systemWeight = .light
        case ..<450: systemWeight = .regular
        case ..<550: systemWeight = .medium
        case ..<650: systemWeight = .semibold
        case ..<750: systemWeight = .bold
        default: systemWeight = .heavy
        }
        return numeric
            ? UIFont.monospacedDigitSystemFont(ofSize: size, weight: systemWeight)
            : UIFont.systemFont(ofSize: size, weight: systemWeight)
    }

    private static func postScriptName(at url: URL) -> String? {
        guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor],
              let first = descriptors.first
        else { return nil }
        return CTFontDescriptorCopyAttribute(first, kCTFontNameAttribute) as? String
    }

    private static func contentSizeCategory(for size: DynamicTypeSize) -> UIContentSizeCategory {
        switch size {
        case .xSmall: return .extraSmall
        case .small: return .small
        case .medium: return .medium
        case .large: return .large
        case .xLarge: return .extraLarge
        case .xxLarge: return .extraExtraLarge
        case .xxxLarge: return .extraExtraExtraLarge
        case .accessibility1: return .accessibilityMedium
        case .accessibility2: return .accessibilityLarge
        case .accessibility3: return .accessibilityExtraLarge
        case .accessibility4: return .accessibilityExtraExtraLarge
        case .accessibility5: return .accessibilityExtraExtraExtraLarge
        @unknown default: return .large
        }
    }
}

/// Applies a text role: brand font scaled for the current Dynamic Type size
/// (and Bold Text), plus the role's tracking and, for `.overline`, uppercase.
struct FRFontModifier: ViewModifier {
    let role: FRTextRole
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.legibilityWeight) private var legibilityWeight

    @ViewBuilder
    func body(content: Content) -> some View {
        let styled = content
            .font(Font(uiFont as CTFont))
            .tracking(role.spec.trackingEm * uiFont.pointSize)
        // Only set textCase for uppercase roles; `.textCase(nil)` on every role
        // would cancel a container's own text case.
        if role.spec.isUppercase {
            styled.textCase(.uppercase)
        } else {
            styled
        }
    }

    private var uiFont: UIFont {
        FRFonts.uiFont(for: role, dynamicTypeSize: dynamicTypeSize, boldText: legibilityWeight == .bold)
    }
}

extension View {
    /// Sets the Fantasy Reel text role for this view and its children.
    func frFont(_ role: FRTextRole) -> some View {
        modifier(FRFontModifier(role: role))
    }
}

#if DEBUG
private struct FRTypeSpecimen: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(FRTextRole.allCases, id: \.self) { role in
                    HStack(alignment: .firstTextBaseline) {
                        Text(String(describing: role))
                            .frFont(role)
                            .foregroundStyle(Color.frText)
                        Spacer()
                        Text("+28 −4 $64")
                            .frFont(role)
                            .foregroundStyle(Color.frTextSecondary)
                    }
                }
            }
            .padding(16)
        }
        .background(Color.frBackground)
    }
}

#Preview("Type · dark") { FRTypeSpecimen().preferredColorScheme(.dark) }
#Preview("Type · AX3") { FRTypeSpecimen().environment(\.dynamicTypeSize, .accessibility3) }
#endif
