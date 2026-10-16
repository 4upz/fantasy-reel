import FantasyReelCore
import SwiftUI

/// The `.hd` block at the top of a tab or screen: an optional small meta line
/// ("Office Movie Club · 2027 Season"), the large Bricolage title (a header for
/// VoiceOver), then an optional row of meta text, a `StatusBadge` and any extra
/// accessory (a connection indicator, say). The row wraps to a column when it
/// doesn't fit at large text sizes.
struct ScreenHeader<Accessory: View>: View {
    private let title: String
    private let eyebrow: String?
    private let subtitle: String?
    private let status: LeagueStatus?
    private let accessory: Accessory

    init(
        _ title: String,
        eyebrow: String? = nil,
        subtitle: String? = nil,
        status: LeagueStatus? = nil,
        @ViewBuilder accessory: () -> Accessory
    ) {
        self.title = title
        self.eyebrow = eyebrow
        self.subtitle = subtitle
        self.status = status
        self.accessory = accessory()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let eyebrow {
                Text(eyebrow)
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
            }
            Text(title)
                .frFont(.largeTitle)
                .foregroundStyle(Color.frText)
                .accessibilityAddTraits(.isHeader)
                .fixedSize(horizontal: false, vertical: true)
            if hasMetaRow {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { metaRowContent }
                    VStack(alignment: .leading, spacing: 6) { metaRowContent }
                }
                .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var hasMetaRow: Bool {
        subtitle != nil || status != nil || Accessory.self != EmptyView.self
    }

    @ViewBuilder
    private var metaRowContent: some View {
        if let subtitle {
            Text(subtitle)
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
        }
        if let status {
            StatusBadge(status: status)
        }
        accessory
    }
}

extension ScreenHeader where Accessory == EmptyView {
    init(_ title: String, eyebrow: String? = nil, subtitle: String? = nil, status: LeagueStatus? = nil) {
        self.init(title, eyebrow: eyebrow, subtitle: subtitle, status: status) { EmptyView() }
    }
}

#if DEBUG
#Preview("Screen headers") {
    FRPreviewCanvas {
        ScreenHeader("Popcorn Syndicate", subtitle: "2026 Season", status: .active)
        ScreenHeader("Roster", eyebrow: "Popcorn Syndicate · 2026 Season")
        ScreenHeader("Draft", eyebrow: "Office Movie Club · 2027 Season", status: .drafting) {
            ConnectionStatusIndicator(status: .offline)
        }
    }
}

#Preview("Screen headers · light AX") {
    FRPreviewCanvas {
        ScreenHeader("Popcorn Syndicate", subtitle: "2026 Season", status: .active)
    }
    .preferredColorScheme(.light)
    .environment(\.dynamicTypeSize, .accessibility3)
}
#endif
