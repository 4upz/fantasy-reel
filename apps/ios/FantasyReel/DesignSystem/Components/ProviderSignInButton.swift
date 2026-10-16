import SwiftUI

/// A "Continue with …" sign-in button (`.pbtn`, V2LogIn / V2SignUp): a 50pt
/// white capsule with #1f1f1f DM Sans 600 17 text and the provider's 24pt logo
/// 18pt from the leading edge. It looks the same in both appearances, as the
/// providers' brand rules ask.
///
/// ```swift
/// ProviderSignInButton(provider: .google) { … }
///     .disabled(action.isRunning)
/// ```
///
/// TODO: official logo assets are required for brand compliance (Sign in with
/// Apple, Google and Discord guidelines). The glyphs below are placeholders
/// until the vendor marks are added to the asset catalog.
struct ProviderSignInButton: View {
    enum Provider: Hashable, Sendable, CaseIterable {
        case apple, google, discord

        /// Mockup copy: "Continue with Apple" etc.
        var title: String {
            switch self {
            case .apple: "Continue with Apple"
            case .google: "Continue with Google"
            case .discord: "Continue with Discord"
            }
        }

        /// Placeholder glyph; see the TODO on `ProviderSignInButton`.
        var placeholderSymbol: String {
            switch self {
            case .apple: "apple.logo"
            case .google: "g.circle.fill"
            case .discord: "bubble.left.fill"
            }
        }
    }

    private let provider: Provider
    private let action: () -> Void

    init(provider: Provider, action: @escaping () -> Void) {
        self.provider = provider
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(provider.title)
        }
        .buttonStyle(ProviderSignInButtonStyle(symbol: provider.placeholderSymbol))
    }
}

private struct ProviderSignInButtonStyle: ButtonStyle {
    let symbol: String

    func makeBody(configuration: Configuration) -> some View {
        ProviderSignInButtonBody(label: configuration.label, isPressed: configuration.isPressed, symbol: symbol)
    }
}

private struct ProviderSignInButtonBody: View {
    let label: ButtonStyleConfiguration.Label
    let isPressed: Bool
    let symbol: String

    @Environment(\.isEnabled) private var isEnabled

    /// Fixed, not themed: the same white button in dark and light.
    private static let fill = FRPalette.fixed(0xFFFFFF)
    private static let ink = FRPalette.fixed(0x1F1F1F)
    private static let logoInk = FRPalette.fixed(0x000000)

    var body: some View {
        label
            .frFont(.control)
            .tracking(-0.17)
            .lineLimit(2)
            .multilineTextAlignment(.center)
            .foregroundStyle(Self.ink)
            // Clear the logo on both sides so the title stays centered.
            .padding(.horizontal, 56)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, minHeight: 50)
            .overlay(alignment: .leading) {
                Image(systemName: symbol)
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(Self.logoInk)
                    .frame(width: 24, height: 24)
                    .padding(.leading, 18)
                    .accessibilityHidden(true)
            }
            .background(Self.fill, in: Capsule())
            .shadow(color: .black.opacity(0.35), radius: 1, x: 0, y: 1)
            .opacity(isEnabled ? (isPressed ? 0.8 : 1) : 0.5)
            .contentShape(Capsule())
            .animation(.easeOut(duration: 0.12), value: isPressed)
    }
}

/// The "or" divider between provider buttons and the email fields (`.ordiv`):
/// 13pt DM Sans 500 in secondary text with a hairline on each side.
struct FROrDivider: View {
    private let title: String

    @Environment(\.displayScale) private var displayScale

    init(_ title: String = "or") {
        self.title = title
    }

    var body: some View {
        HStack(spacing: 12) {
            hairline
            Text(title)
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
            hairline
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
    }

    private var hairline: some View {
        Rectangle()
            .fill(Color.frSeparator)
            .frame(maxWidth: .infinity)
            .frame(height: 1 / max(displayScale, 1))
            .accessibilityHidden(true)
    }
}

#if DEBUG
private struct ProviderButtonsPreview: View {
    var body: some View {
        FRPreviewCanvas {
            VStack(spacing: 12) {
                ForEach(ProviderSignInButton.Provider.allCases, id: \.self) { provider in
                    ProviderSignInButton(provider: provider) {}
                }
                ProviderSignInButton(provider: .google) {}.disabled(true)
            }
            FROrDivider()
        }
    }
}

#Preview("Provider buttons · dark") { ProviderButtonsPreview().preferredColorScheme(.dark) }
#Preview("Provider buttons · light") { ProviderButtonsPreview().preferredColorScheme(.light) }
#endif
