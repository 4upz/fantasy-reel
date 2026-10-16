import SwiftUI

/// The `.grp`: rows stacked on one 22pt rounded surface, separated by hairlines
/// inset from the leading edge (64pt by default, past a 36pt poster; use 108 for
/// standings rows with rank + avatar, `FRMetrics.plainSeparatorInset` for plain
/// settings or form rows).
///
/// Pass rows directly; each top-level view (including each element of a
/// `ForEach`) is one row. Rows can be plain views, `Button`s or `NavigationLink`s;
/// give those `.buttonStyle(.frRow)` for the pressed highlight.
///
/// For swipe actions (drop a movie, cancel a bid) use a `List` instead: swipe
/// actions only exist on List rows.
struct FRRowGroup<Content: View>: View {
    private let separatorInset: CGFloat
    private let content: Content

    init(separatorInset: CGFloat = FRMetrics.separatorInset, @ViewBuilder content: () -> Content) {
        self.separatorInset = separatorInset
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            Group(subviews: content) { rows in
                ForEach(rows) { row in
                    row.overlay(alignment: .top) {
                        if row.id != rows.first?.id {
                            RowSeparator()
                                .padding(.leading, separatorInset)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
        .background(Color.frSurface)
        .clipShape(RoundedRectangle(cornerRadius: FRMetrics.cardRadius, style: .continuous))
    }
}

private struct RowSeparator: View {
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        Rectangle()
            .fill(Color.frSeparator)
            .frame(height: 1 / displayScale)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// Pressed highlight for a full-width row that is a Button or NavigationLink.
struct FRRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .background(configuration.isPressed ? Color.frPressed : Color.clear)
    }
}

extension ButtonStyle where Self == FRRowButtonStyle {
    /// Row highlight style for buttons and navigation links inside `FRRowGroup`.
    static var frRow: FRRowButtonStyle { FRRowButtonStyle() }
}

#if DEBUG
#Preview("Row group") {
    FRPreviewCanvas {
        FRRowGroup {
            ForEach(FRSampleData.movies) { movie in
                Button {} label: {
                    MovieRow(
                        title: movie.title, meta: movie.meta, posterURL: movie.posterURL,
                        points: movie.points, preRelease: movie.preRelease, showsChevron: true
                    )
                }
                .buttonStyle(.frRow)
            }
        }
        FRRowGroup(separatorInset: FRMetrics.plainSeparatorInset) {
            FormFieldRow(label: "Display name") { Text("Alice Spielberg").foregroundStyle(Color.frTextSecondary) }
            FormFieldRow(label: "Email") { Text("alice@fantasyreel.test").foregroundStyle(Color.frTextSecondary) }
        }
    }
}
#endif
