import SwiftUI

/// The `.badge` pill: 22pt tall capsule, tinted background, 12pt semibold text.
/// The badge always carries words, so its tone is never the only signal.
struct FRBadge: View {
    private let text: String
    private let tone: FRTone
    private let systemImage: String?

    init(_ text: String, tone: FRTone, systemImage: String? = nil) {
        self.text = text
        self.tone = tone
        self.systemImage = systemImage
    }

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage {
                Image(systemName: systemImage)
                    .imageScale(.small)
                    .accessibilityHidden(true)
            }
            Text(text)
                .lineLimit(1)
        }
        .frFont(.captionStrong)
        .foregroundStyle(tone.foreground)
        .padding(.horizontal, 8)
        .frame(minHeight: 22)
        .background(tone.background, in: Capsule())
        .fixedSize()
    }
}

/// The small uppercase "BETA" pill (`.beta`) beside projected values.
/// `compact` is the `.pchip.sm` size that rides inside a small projection chip.
struct BetaBadge: View {
    var compact = false

    var body: some View {
        Text("Beta")
            .textCase(.uppercase)
            .font(FRFonts.fixedFont(.dmSans, weight: 700, size: compact ? 10 : 11))
            .tracking(compact ? 0.4 : 0.66)
            .foregroundStyle(Color.frBeta)
            .padding(.horizontal, compact ? 3 : 5)
            .frame(minHeight: compact ? 14 : 16)
            .background(Color.frInfoTint, in: RoundedRectangle(cornerRadius: compact ? 5 : 8, style: .continuous))
            .fixedSize()
    }
}

#if DEBUG
#Preview("Badges") {
    FRPreviewCanvas {
        HStack {
            ForEach(FRTone.allCases, id: \.self) { tone in
                if tone != .neutral { FRBadge(String(describing: tone).capitalized, tone: tone) }
            }
        }
        HStack {
            FRBadge("Paused", tone: .warning, systemImage: "pause.fill")
            FRBadge("Admins only", tone: .gold)
            BetaBadge()
        }
    }
}

#Preview("Badges · light") {
    FRPreviewCanvas {
        HStack {
            FRBadge("Setup", tone: .info)
            FRBadge("Drafting", tone: .draft)
            FRBadge("Active", tone: .success)
            FRBadge("Completed", tone: .done)
            BetaBadge()
        }
    }
    .preferredColorScheme(.light)
}
#endif
