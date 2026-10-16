import SwiftUI

/// A tinted alert card (`.alert-i`, and the "Outbid on …" card on V2Home): tone
/// icon, a semibold title, an optional secondary message, and either a compact
/// action button or, when the whole banner is tappable, a chevron.
///
/// Errors stay inline (never a transient toast). The banner is one VoiceOver
/// element; announce a *new* banner with `Announcer.announce(_:)` so it is
/// heard once rather than on every refresh.
struct InlineBanner: View {
    private let tone: FRTone
    private let title: String
    private let message: String?
    private let systemImage: String
    private let actionTitle: String?
    private let action: (() -> Void)?

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    /// - Parameters:
    ///   - actionTitle: shows a compact button with this title. When nil and
    ///     `action` is set, the whole banner becomes a button with a chevron.
    init(
        tone: FRTone,
        title: String,
        message: String? = nil,
        systemImage: String? = nil,
        actionTitle: String? = nil,
        action: (() -> Void)? = nil
    ) {
        self.tone = tone
        self.title = title
        self.message = message
        self.systemImage = systemImage ?? tone.defaultSymbol
        self.actionTitle = actionTitle
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

    private func content(showsChevron: Bool) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: systemImage)
                .font(.title3)
                .foregroundStyle(tone.foreground)
                .accessibilityHidden(true)
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
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.fr(tone == .error ? .destructive : .secondary, size: .compact))
            } else if showsChevron {
                RowChevron()
            }
        }
        .padding(.vertical, 12)
        .padding(.horizontal, FRMetrics.cardPadding)
        .frame(maxWidth: .infinity, minHeight: FRMetrics.minTapTarget, alignment: .leading)
        .frCardBackground(tone)
        .contentShape(RoundedRectangle(cornerRadius: FRMetrics.cardRadius, style: .continuous))
        .accessibilityElement(children: .contain)
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
