import SwiftUI

/// The `.card` container: surface (or tinted) background, 22pt continuous
/// corners, 16pt padding, full width. Cards are never nested; put rows in an
/// `FRRowGroup`, not in a card inside a card.
///
/// A tinted card (`tone:`) is the alert card on V2Home ("Outbid on …"); for a
/// standard icon + title + message alert prefer `InlineBanner`.
struct FRCard<Content: View>: View {
    private let tone: FRTone?
    private let padding: EdgeInsets
    private let content: Content

    init(tone: FRTone? = nil, padding: CGFloat = FRMetrics.cardPadding, @ViewBuilder content: () -> Content) {
        self.tone = tone
        self.padding = EdgeInsets(top: padding, leading: padding, bottom: padding, trailing: padding)
        self.content = content()
    }

    init(tone: FRTone? = nil, padding: EdgeInsets, @ViewBuilder content: () -> Content) {
        self.tone = tone
        self.padding = padding
        self.content = content()
    }

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frCardBackground(tone)
    }
}

extension View {
    /// Gives any view (a Button or NavigationLink label, say) the card background:
    /// surface, or the tone's tint, in a 22pt continuous rounded rectangle.
    func frCardBackground(_ tone: FRTone? = nil) -> some View {
        background(
            tone?.background ?? Color.frSurface,
            in: RoundedRectangle(cornerRadius: FRMetrics.cardRadius, style: .continuous)
        )
    }
}

/// The `.hr` hairline used inside cards (between a header and `StatColumns`, say).
struct FRHairline: View {
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        Rectangle()
            .fill(Color.frSeparator)
            .frame(height: 1 / displayScale)
            .accessibilityHidden(true)
    }
}

#if DEBUG
#Preview("Cards") {
    FRPreviewCanvas {
        FRCard {
            VStack(alignment: .leading, spacing: 12) {
                Text("Reel Deal").frFont(.cardTitle).foregroundStyle(Color.frText)
                FRHairline()
                Text("Alice Spielberg · Your team").frFont(.meta).foregroundStyle(Color.frTextSecondary)
            }
        }
        ForEach([FRTone.warning, .gold, .success, .error], id: \.self) { tone in
            FRCard(tone: tone, padding: EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16)) {
                Text(String(describing: tone).capitalized).frFont(.rowTitle).foregroundStyle(Color.frText)
            }
        }
    }
}
#endif
