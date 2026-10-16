import SwiftUI

/// A tinted alert card (`.alert-i`, and the "Outbid on …" card on V2Home): tone
/// icon (bare, or in a 32pt tinted circle), a semibold title, an optional
/// secondary message, and either an action button (compact at the trailing
/// edge, or 44pt in the banner's tone below the message) or, when the whole
/// banner is tappable, a chevron.
///
/// Errors stay inline (never a transient toast). The banner is one VoiceOver
/// element; announce a *new* banner with `Announcer.announce(_:)` so it is
/// heard once rather than on every refresh.
struct InlineBanner: View {
    /// How the tone icon is drawn.
    enum IconStyle: Hashable, Sendable {
        /// The bare symbol in the tone's color (`.alert-i`).
        case plain
        /// The symbol in a 32pt tone-tinted circle (`.ibadge`, V2LogIn alert card).
        case badge
    }

    /// Where the `actionTitle` button goes.
    enum ActionPlacement: Hashable, Sendable {
        /// A compact button at the trailing edge.
        case trailing
        /// A 44pt (`.medium`) button in the banner's tone under the message
        /// (V2LogIn "Resend Email").
        case below
    }

    private let tone: FRTone
    private let title: String
    private let message: String?
    private let systemImage: String
    private let actionTitle: String?
    private let iconStyle: IconStyle
    private let actionPlacement: ActionPlacement
    private let action: (() -> Void)?

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    /// - Parameters:
    ///   - actionTitle: shows a button with this title, placed by
    ///     `actionPlacement`. When nil and `action` is set, the whole banner
    ///     becomes a button with a chevron.
    ///   - iconStyle: `.plain` symbol (default) or `.badge`, a 32pt tinted circle.
    ///   - actionPlacement: `.trailing` compact button (default) or `.below` the
    ///     message as a 44pt button in the banner's tone.
    init(
        tone: FRTone,
        title: String,
        message: String? = nil,
        systemImage: String? = nil,
        actionTitle: String? = nil,
        iconStyle: IconStyle = .plain,
        actionPlacement: ActionPlacement = .trailing,
        action: (() -> Void)? = nil
    ) {
        self.tone = tone
        self.title = title
        self.message = message
        self.systemImage = systemImage ?? tone.defaultSymbol
        self.actionTitle = actionTitle
        self.iconStyle = iconStyle
        self.actionPlacement = actionPlacement
        self.action = action
    }

    var body: some View {
        if let action, actionTitle == nil {
            Button(action: action) {
                content(showsChevron: true)
            }
            .buttonStyle(.plain)
        } else {
            content(showsChevron: false)
        }
    }

    private var actionBelow: Bool {
        actionPlacement == .below && actionTitle != nil && action != nil
    }

    private func content(showsChevron: Bool) -> some View {
        HStack(alignment: actionBelow ? .top : .center, spacing: 12) {
            icon
            VStack(alignment: .leading, spacing: 2) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .frFont(.rowTitle)
                        .foregroundStyle(Color.frText)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                    if let message {
                        Text(message)
                            .frFont(.meta)
                            .foregroundStyle(Color.frTextSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .accessibilityElement(children: .combine)
                if actionBelow, let actionTitle, let action {
                    Button(actionTitle, action: action)
                        .buttonStyle(BannerToneButtonStyle(tone: tone))
                        .padding(.top, 10)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if !actionBelow, let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.fr(tone == .error ? .destructive : .secondary, size: .compact))
            } else if showsChevron {
                RowChevron()
            }
        }
        .padding(.vertical, actionBelow ? FRMetrics.cardPadding : 12)
        .padding(.horizontal, FRMetrics.cardPadding)
        .frame(maxWidth: .infinity, minHeight: FRMetrics.minTapTarget, alignment: .leading)
        .frCardBackground(tone)
        .contentShape(RoundedRectangle(cornerRadius: FRMetrics.cardRadius, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var icon: some View {
        switch iconStyle {
        case .plain:
            Image(systemName: systemImage)
                .font(.title3)
                .foregroundStyle(tone.foreground)
                .accessibilityHidden(true)
        case .badge:
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(tone.foreground)
                .frame(width: 32, height: 32)
                .background(tone.background, in: Circle())
                .accessibilityHidden(true)
        }
    }
}

/// The `.below` action: a 44pt capsule in the banner's tone (tint fill, tone
/// text, a hairline of the tone), 16pt DM Sans 600.
private struct BannerToneButtonStyle: ButtonStyle {
    let tone: FRTone

    func makeBody(configuration: Configuration) -> some View {
        BannerToneButtonBody(label: configuration.label, isPressed: configuration.isPressed, tone: tone)
    }
}

private struct BannerToneButtonBody: View {
    let label: ButtonStyleConfiguration.Label
    let isPressed: Bool
    let tone: FRTone

    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        label
            .frFont(.rowTitle)
            .lineLimit(2)
            .multilineTextAlignment(.center)
            .foregroundStyle(isEnabled ? tone.foreground : Color.frTextMuted)
            .padding(.horizontal, 18)
            .padding(.vertical, 6)
            .frame(minHeight: FRMetrics.minTapTarget)
            .background(isEnabled ? tone.background : Color.frElevated, in: Capsule())
            .overlay {
                Capsule().strokeBorder(isEnabled ? tone.foreground : Color.clear, lineWidth: 0.5)
            }
            .opacity(isPressed && isEnabled ? 0.72 : 1)
            .contentShape(Capsule())
            .animation(.easeOut(duration: 0.12), value: isPressed)
    }
}

#if DEBUG
#Preview("Banners · dark") {
    FRPreviewCanvas {
        InlineBanner(tone: .warning, title: "Outbid on Mortal Kombat II", message: "New bids close Thu 1:00 PM") {}
        InlineBanner(tone: .info, title: "Draft starts Saturday", message: "Set your wishlist before it begins.")
        InlineBanner(tone: .error, title: "Couldn't place bid", message: "Your budget changed.", actionTitle: "Retry") {}
        InlineBanner(tone: .success, title: "Trade completed")
        InlineBanner(tone: .gold, title: "You won the 2025 season", systemImage: "crown.fill")
        InlineBanner(
            tone: .info,
            title: "Confirm your email first",
            message: "We sent a link to alice@fantasyreel.test",
            systemImage: "envelope.fill",
            actionTitle: "Resend Email",
            iconStyle: .badge,
            actionPlacement: .below
        ) {}
    }
}

#Preview("Banners · light") {
    FRPreviewCanvas {
        InlineBanner(tone: .warning, title: "Outbid on Mortal Kombat II", message: "New bids close Thu 1:00 PM") {}
        InlineBanner(tone: .error, title: "Couldn't place bid", message: "Your budget changed.", actionTitle: "Retry") {}
    }
    .preferredColorScheme(.light)
}
#endif
