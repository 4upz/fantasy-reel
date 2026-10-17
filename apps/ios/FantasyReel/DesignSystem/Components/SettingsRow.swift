import SwiftUI

/// The `.srow` settings row (V2Account): a label, an optional trailing value,
/// and a chevron for a pushed screen or `arrow.up.right` for a link that
/// leaves the app. Put rows in `FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset)`;
/// wrap them in a `NavigationLink`, `Link` or `Button` with `.buttonStyle(.frRow)`.
///
/// At accessibility text sizes the value moves under the label instead of
/// truncating it.
struct SettingsRow<Trailing: View>: View {
    enum Accessory {
        case none
        /// Pushes a screen.
        case chevron
        /// Leaves the app (mail, Safari).
        case external
    }

    enum Role {
        case standard
        /// Log Out, Delete Account: crimson label.
        case destructive
    }

    private let title: String
    private let value: String?
    private let accessory: Accessory
    private let role: Role
    private let leading: AnyView?
    private let trailing: Trailing

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    init(
        _ title: String,
        value: String? = nil,
        accessory: Accessory = .chevron,
        role: Role = .standard,
        leading: AnyView? = nil,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.title = title
        self.value = value
        self.accessory = accessory
        self.role = role
        self.leading = leading
        self.trailing = trailing()
    }

    var body: some View {
        let stacked = dynamicTypeSize.isAccessibilitySize
        HStack(spacing: 12) {
            leading
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .frFont(role == .destructive ? .rowTitle : .rowLabel)
                    .foregroundStyle(role == .destructive ? Color.frCrimsonText : Color.frText)
                if stacked, let value {
                    Text(value)
                        .frFont(.body)
                        .foregroundStyle(Color.frTextSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if !stacked, let value {
                Text(value)
                    .frFont(.body)
                    .foregroundStyle(Color.frTextSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            trailing
            switch accessory {
            case .none:
                EmptyView()
            case .chevron:
                RowChevron()
            case .external:
                Image(systemName: "arrow.up.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Color.frTextMuted)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, FRMetrics.rowPadding)
        .padding(.vertical, 6)
        .frame(minHeight: 50)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint(accessory == .external ? "Opens outside the app." : "")
    }
}

extension SettingsRow where Trailing == EmptyView {
    init(_ title: String, value: String? = nil, accessory: Accessory = .chevron, role: Role = .standard, leading: AnyView? = nil) {
        self.init(title, value: value, accessory: accessory, role: role, leading: leading) { EmptyView() }
    }
}

/// The `.foot` text under a row group: secondary, 13pt, inset to line up with
/// the rows' text.
struct GroupFootnote: View {
    private let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .frFont(.meta)
            .foregroundStyle(Color.frTextSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, FRMetrics.rowPadding)
            .padding(.top, -4)
    }
}

#if DEBUG
#Preview("Settings rows") {
    FRPreviewCanvas {
        FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
            SettingsRow("Display name", value: "Alice Spielberg")
            SettingsRow("Support", accessory: .external)
            SettingsRow("Log Out", accessory: .none, role: .destructive)
        }
        GroupFootnote("Leagues you run pass to another member. This can't be undone.")
    }
}
#endif
