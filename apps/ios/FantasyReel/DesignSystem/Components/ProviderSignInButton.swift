import SwiftUI

/// A "Continue with …" sign-in button (`.pbtn`, V2LogIn / V2SignUp): a 50pt
/// white capsule with #1f1f1f DM Sans 600 17 text and the provider's logo
/// 18pt from the leading edge. It looks the same in both appearances, as the
/// providers' brand rules ask: the black Apple logo, Google's four-color "G"
/// and Discord's blurple mark on white.
///
/// ```swift
/// ProviderSignInButton(provider: .google) { … }
///     .disabled(action.isRunning)
/// ```
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

        /// The provider's mark. Google's and Discord's are the web's
        /// (`GoogleIcon`, `DiscordIcon`) in their brand colors; Apple's is the
        /// system Apple logo in black, as a custom Sign in with Apple button uses.
        @MainActor @ViewBuilder
        var logo: some View {
            switch self {
            case .apple:
                Image(systemName: "apple.logo")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(FRPalette.fixed(0x000000))
                    // The glyph sits a little low in its box; center it optically.
                    .offset(y: -1)
            case .google:
                Image("GoogleLogo").resizable().scaledToFit().frame(width: 20, height: 20)
            case .discord:
                Image("DiscordLogo").resizable().scaledToFit().frame(width: 22, height: 22)
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
        .buttonStyle(ProviderSignInButtonStyle(provider: provider))
    }
}

private struct ProviderSignInButtonStyle: ButtonStyle {
    let provider: ProviderSignInButton.Provider

    func makeBody(configuration: Configuration) -> some View {
        ProviderSignInButtonBody(label: configuration.label, isPressed: configuration.isPressed, provider: provider)
    }
}

private struct ProviderSignInButtonBody: View {
    let label: ButtonStyleConfiguration.Label
    let isPressed: Bool
    let provider: ProviderSignInButton.Provider

    @Environment(\.isEnabled) private var isEnabled

    /// Fixed, not themed: the same white button in dark and light.
    private static let fill = FRPalette.fixed(0xFFFFFF)
    private static let ink = FRPalette.fixed(0x1F1F1F)

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
                provider.logo
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
