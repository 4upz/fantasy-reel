import SwiftUI

/// The `.sh` section header above a row group: Bricolage 600 20pt title on the
/// leading edge, an optional gold link button ("See roster") or secondary
/// detail text ("5", "1 of 2") on the trailing edge, baseline-aligned.
///
/// Includes the mockup's spacing (12pt above, 8pt to the group below when
/// placed in a 12pt-spaced stack). The link keeps a 44pt hit area without
/// making the header taller.
struct SectionHeader: View {
    private let title: String
    private let accessory: Accessory?

    private enum Accessory {
        case link(String, () -> Void)
        case detail(String)
    }

    /// A header with an optional trailing gold link.
    init(_ title: String, actionTitle: String? = nil, action: (() -> Void)? = nil) {
        self.title = title
        if let actionTitle, let action {
            accessory = .link(actionTitle, action)
        } else {
            accessory = nil
        }
    }

    /// A header with trailing secondary text (a count, "1 of 2").
    init(_ title: String, detail: String) {
        self.title = title
        self.accessory = .detail(detail)
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(title)
                .frFont(.sectionTitle)
                .foregroundStyle(Color.frText)
                .accessibilityAddTraits(.isHeader)
                .frame(maxWidth: .infinity, alignment: .leading)
            switch accessory {
            case .link(let label, let action):
                Button(action: action) {
                    Text(label)
                        .frFont(.label)
                        .foregroundStyle(Color.frGold)
                        .frame(minWidth: FRMetrics.minTapTarget, minHeight: FRMetrics.minTapTarget, alignment: .trailing)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.vertical, -12)
            case .detail(let text):
                Text(text)
                    .frFont(.label)
                    .foregroundStyle(Color.frTextSecondary)
            case nil:
                EmptyView()
            }
        }
        .padding(.horizontal, 4)
        .padding(.top, 12)
        .padding(.bottom, -4)
    }
}

#if DEBUG
#Preview("Section headers") {
    FRPreviewCanvas {
        SectionHeader("My movies", actionTitle: "See roster") {}
        FRRowGroup {
            MovieRow(title: "The Odyssey", meta: "Released Jul 17 · RT 88%", posterURL: nil, points: 28)
        }
        SectionHeader("Counterpicks", detail: "1 of 2")
        FRRowGroup {
            MovieRow(title: "Michael", meta: "On Kubrick's Cube · RT 38%", posterURL: nil, points: 16)
        }
        SectionHeader("Releasing this week")
    }
}
#endif
