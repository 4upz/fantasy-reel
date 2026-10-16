import SwiftUI

/// The `.cnt` count pill: red (or gold) capsule with a white count, capped at
/// "9+". Hidden from VoiceOver: the control it decorates states the count in
/// its own label or value ("Notifications, 3 unread").
struct CountBadge: View {
    enum Style: Sendable {
        /// Needs attention (`--err` fill, white text).
        case alert
        /// Informational, e.g. a trade waiting on you (`--gold` fill, on-gold text).
        case gold
    }

    enum Size: Sendable {
        /// 20pt, 12pt text: inline beside a label.
        case regular
        /// 18pt, 11pt text: overlaid on a 44pt icon button.
        case small
    }

    private let count: Int
    private let style: Style
    private let size: Size

    init(count: Int, style: Style = .alert, size: Size = .regular) {
        self.count = count
        self.style = style
        self.size = size
    }

    var body: some View {
        let height: CGFloat = size == .regular ? 20 : 18
        Text(verbatim: count > 9 ? "9+" : String(max(count, 0)))
            .font(FRFonts.fixedFont(.dmSans, weight: 700, size: size == .regular ? 12 : 11))
            .monospacedDigit()
            .foregroundStyle(style == .alert ? Color.white : Color.frOnGold)
            .padding(.horizontal, size == .regular ? 6 : 5)
            .frame(minWidth: height, minHeight: height)
            .background(style == .alert ? Color.frError : Color.frGold, in: Capsule())
            .fixedSize()
            .accessibilityHidden(true)
    }
}

#if DEBUG
#Preview("Count badges") {
    FRPreviewCanvas {
        HStack(spacing: 12) {
            CountBadge(count: 1)
            CountBadge(count: 3, size: .small)
            CountBadge(count: 12)
            CountBadge(count: 1, style: .gold)
        }
    }
}
#endif
