import SwiftUI

/// The generic `.mrow` layout: leading artwork, a one-line title over a one-line
/// meta line, a trailing column and an optional chevron, at least 64pt tall
/// (72 for a hero row). Rows grow with Dynamic Type; at accessibility sizes the
/// title and meta wrap instead of truncating.
///
/// `MovieRow` is this with a poster. Standings rows pass a rank and an `Avatar`
/// as `leading` (and use `FRRowGroup(separatorInset: 108)`).
///
/// VoiceOver reads the row as one element. Pass `accessibilityLabel` to replace
/// the combined reading ("Rank 2, Reel Deal, your team, 113 points").
struct ListRow<Leading: View, Trailing: View>: View {
    private let title: String
    private let meta: String?
    private let showsChevron: Bool
    private let isHero: Bool
    private let metaLineLimit: Int
    private let accessibilityLabelOverride: String?
    private let leading: Leading
    private let trailing: Trailing

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    init(
        title: String,
        meta: String? = nil,
        showsChevron: Bool = false,
        isHero: Bool = false,
        metaLineLimit: Int = 1,
        accessibilityLabel: String? = nil,
        @ViewBuilder leading: () -> Leading,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.title = title
        self.meta = meta
        self.showsChevron = showsChevron
        self.isHero = isHero
        self.metaLineLimit = metaLineLimit
        self.accessibilityLabelOverride = accessibilityLabel
        self.leading = leading()
        self.trailing = trailing()
    }

    var body: some View {
        HStack(spacing: FRMetrics.rowGap) {
            leading
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .frFont(.rowTitle)
                    .foregroundStyle(Color.frText)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
                if let meta, !meta.isEmpty {
                    Text(meta)
                        .frFont(.meta)
                        .foregroundStyle(Color.frTextSecondary)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? max(4, metaLineLimit) : metaLineLimit)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing
            if showsChevron {
                RowChevron()
                    .padding(.leading, -4)
            }
        }
        .padding(.horizontal, FRMetrics.rowPadding)
        .padding(.vertical, 8)
        .frame(minHeight: isHero ? FRMetrics.heroRowHeight : FRMetrics.rowHeight)
        .contentShape(Rectangle())
        .modifier(RowAccessibility(label: accessibilityLabelOverride))
    }
}

extension ListRow where Leading == EmptyView {
    /// A row with no leading artwork.
    init(
        title: String,
        meta: String? = nil,
        showsChevron: Bool = false,
        accessibilityLabel: String? = nil,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.init(
            title: title, meta: meta, showsChevron: showsChevron, accessibilityLabel: accessibilityLabel,
            leading: { EmptyView() }, trailing: trailing
        )
    }
}

/// The trailing disclosure chevron (decorative; the row is the button).
struct RowChevron: View {
    var body: some View {
        Image(systemName: "chevron.right")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Color.frTextMuted)
            .accessibilityHidden(true)
    }
}

private struct RowAccessibility: ViewModifier {
    let label: String?

    @ViewBuilder
    func body(content: Content) -> some View {
        if let label {
            content
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(label)
        } else {
            content.accessibilityElement(children: .combine)
        }
    }
}

#if DEBUG
#Preview("Standings rows") {
    FRPreviewCanvas {
        FRRowGroup(separatorInset: 108) {
            ForEach(FRSampleData.teams) { team in
                ListRow(
                    title: team.name,
                    meta: team.isYou ? "\(team.owner) · You" : team.owner,
                    showsChevron: true,
                    accessibilityLabel: "Rank \(team.rank), \(team.name), \(Int(team.points)) points"
                ) {
                    HStack(spacing: FRMetrics.rowGap) {
                        Text(team.rank)
                            .frFont(.number)
                            .foregroundStyle(team.rank == "1" ? Color.frGold : Color.frTextSecondary)
                            .frame(width: 32, alignment: .leading)
                        Avatar(name: team.name, size: .medium)
                    }
                } trailing: {
                    TrailingValue("\(Int(team.points))")
                }
                .background(team.isYou ? Color.frGoldTint : Color.clear)
            }
        }
    }
}
#endif
