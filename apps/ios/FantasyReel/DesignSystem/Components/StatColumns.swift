import SwiftUI

/// One cell of `StatColumns`: a small label over a large numeric value with an
/// optional suffix ("2" + " of 8") and an optional caption on its own line
/// ("1 open"), for detail too long to sit beside the value. Give it an
/// `action` to make the cell a button (Rank opens Standings on V2Home).
struct StatItem: Identifiable {
    let id: String
    let label: String
    let value: String
    let suffix: String?
    let caption: String?
    let accessibilityLabel: String?
    let action: (() -> Void)?

    init(
        _ label: String,
        value: String,
        suffix: String? = nil,
        caption: String? = nil,
        accessibilityLabel: String? = nil,
        action: (() -> Void)? = nil
    ) {
        self.id = label
        self.label = label
        self.value = value
        self.suffix = suffix
        self.caption = caption
        self.accessibilityLabel = accessibilityLabel
        self.action = action
    }
}

/// The `.cols` stat strip: equal-width cells separated by hairlines, the first
/// flush with the leading edge. Lives inside a card, under an `FRHairline`.
struct StatColumns: View {
    private let items: [StatItem]
    private let valueRole: FRTextRole

    @Environment(\.displayScale) private var displayScale

    init(_ items: [StatItem], valueRole: FRTextRole = .numberLarge) {
        self.items = items
        self.valueRole = valueRole
    }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                cell(item)
                    .padding(.leading, index == 0 ? 0 : 12)
                    .padding(.trailing, 12)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .overlay(alignment: .leading) {
                        if index > 0 {
                            Rectangle()
                                .fill(Color.frSeparator)
                                .frame(width: 1 / displayScale)
                                .accessibilityHidden(true)
                        }
                    }
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private func cell(_ item: StatItem) -> some View {
        if let action = item.action {
            Button(action: action) {
                cellContent(item)
                    .frame(maxWidth: .infinity, minHeight: FRMetrics.minTapTarget, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .modifier(StatAccessibility(label: item.accessibilityLabel))
        } else {
            cellContent(item)
                .modifier(StatAccessibility(label: item.accessibilityLabel))
        }
    }

    private func cellContent(_ item: StatItem) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(item.label)
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text(item.value)
                    .frFont(valueRole)
                    .foregroundStyle(Color.frText)
                if let suffix = item.suffix {
                    Text(verbatim: " \(suffix)")
                        .frFont(.numberSmall)
                        .foregroundStyle(Color.frTextSecondary)
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            if let caption = item.caption {
                Text(caption)
                    .frFont(.caption)
                    .foregroundStyle(Color.frTextSecondary)
            }
        }
    }
}

private struct StatAccessibility: ViewModifier {
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
#Preview("Stat columns") {
    FRPreviewCanvas {
        FRCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    Avatar(name: "Reel Deal", size: .large, corners: .rounded)
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Reel Deal").frFont(.cardTitle).foregroundStyle(Color.frText)
                        Text("Alice Spielberg · Your team").frFont(.meta).foregroundStyle(Color.frTextSecondary)
                    }
                }
                FRHairline()
                StatColumns([
                    StatItem("Rank", value: "2", suffix: "of 8", accessibilityLabel: "Rank 2 of 8, open standings") {},
                    StatItem("Points", value: "113"),
                    StatItem("Budget", value: "$64"),
                ])
            }
        }
    }
}
#endif
