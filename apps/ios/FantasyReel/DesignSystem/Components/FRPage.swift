import SwiftUI

/// How much width the current page has to lay out in, derived from the
/// horizontal size class and nothing else (no device names, screen sizes or
/// orientation; Apple's rule for iPhone Duo).
///
/// - `compact`: an ordinary iPhone, the Duo's outer display, or a narrow
///   slice of the inner display in Split View. Today's single-column design.
/// - `regular`: the Duo's inner display (either way up). Content is capped at
///   a reading width, or split into two columns of cards.
///
/// `FRPage` sets it for everything inside the page. Read it from a component
/// that changes shape on a wide page: `@Environment(\.frLayoutWidth)`.
enum FRLayoutWidth: Sendable, Equatable {
    case compact
    case regular

    init(_ sizeClass: UserInterfaceSizeClass?) {
        self = sizeClass == .regular ? .regular : .compact
    }
}

extension EnvironmentValues {
    @Entry var frLayoutWidth: FRLayoutWidth = .compact
}

extension FRMetrics {
    /// Widest a single column of text and cards gets on a regular-width page.
    static let readableWidth: CGFloat = 640
    /// Narrowest a column of a two-column page may get (the narrowest iPhone).
    /// Below `2 × minColumnWidth + columnGap` the columns stack instead.
    static let minColumnWidth: CGFloat = 320
    /// Gap between the two columns of a wide page.
    static let columnGap: CGFloat = 16
    /// Widest the bottom action bar's buttons get together.
    static let actionBarWidth: CGFloat = 560
}

/// The shared scrolling page every screen is built on (iPhone Duo plan, P2).
///
/// It owns what each screen used to build by hand: the `ScrollView`, the 16pt
/// page margin, the section spacing, the bottom padding and the page
/// background. On a compact page it is exactly the old single column.
///
/// Two shapes:
///
/// ```swift
/// // One column. On a wide page it is centered and capped at a reading width.
/// FRPage {
///     ScreenHeader("Account")
///     FRCard { … }
/// }
///
/// // Two columns of independent cards on a wide page; on a compact page the
/// // trailing column follows the leading one, in that order.
/// FRPage {
///     ScreenHeader(…)
///     TeamCard(…)
/// } trailing: {
///     SectionHeader("My movies")
///     FRRowGroup { … }
/// }
/// ```
///
/// Modifiers like `.refreshable`, `.toolbar` and `.bottomActionBar` go on the
/// `FRPage` itself, as they went on the `ScrollView` before.
struct FRPage<Leading: View, Trailing: View>: View {
    private let spacing: CGFloat
    private let leading: Leading
    private let trailing: Trailing?

    @Environment(\.horizontalSizeClass) private var sizeClass

    /// A single-column page.
    init(spacing: CGFloat = FRMetrics.sectionSpacing, @ViewBuilder content: () -> Leading) where Trailing == EmptyView {
        self.spacing = spacing
        self.leading = content()
        self.trailing = nil
    }

    /// A page that splits into two columns when it is wide enough.
    init(
        spacing: CGFloat = FRMetrics.sectionSpacing,
        @ViewBuilder leading: () -> Leading,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.spacing = spacing
        self.leading = leading()
        self.trailing = trailing()
    }

    var body: some View {
        let width = FRLayoutWidth(sizeClass)
        ScrollView {
            // One layout for every width, so opening or closing an iPhone Duo
            // moves the columns without rebuilding them: scroll position and
            // the sections' @State survive the change.
            FRPageLayout(
                spacing: spacing,
                splits: width == .regular,
                maxSingleColumnWidth: width == .regular ? FRMetrics.readableWidth : nil
            ) {
                column { leading }
                if let trailing { column { trailing } }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
            .padding(.bottom, 24)
        }
        .background(Color.frBackground)
        .environment(\.frLayoutWidth, width)
    }

    private func column<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: spacing) {
            content()
        }
    }
}

/// Lays out a page's one or two columns. With `splits` and two columns that
/// can each get `FRMetrics.minColumnWidth`, they sit side by side, equal and
/// top-aligned. Otherwise they stack (the second under the first), centered
/// and no wider than `maxSingleColumnWidth`. Deciding from the width offered,
/// not the screen, keeps it right in Split View and in a sheet.
private struct FRPageLayout: Layout {
    let spacing: CGFloat
    let splits: Bool
    let maxSingleColumnWidth: CGFloat?

    private func columnWidth(_ width: CGFloat, _ count: Int) -> CGFloat? {
        guard splits, count == 2 else { return nil }
        let column = (width - FRMetrics.columnGap) / 2
        return column >= FRMetrics.minColumnWidth ? column : nil
    }

    private func stackWidth(_ width: CGFloat) -> CGFloat {
        min(width, maxSingleColumnWidth ?? width)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? maxSingleColumnWidth ?? FRMetrics.readableWidth
        if let column = columnWidth(width, subviews.count) {
            let heights = subviews.map { $0.sizeThatFits(.init(width: column, height: nil)).height }
            return CGSize(width: width, height: heights.max() ?? 0)
        }
        let inner = ProposedViewSize(width: stackWidth(width), height: nil)
        let heights = subviews.map { $0.sizeThatFits(inner).height }
        return CGSize(width: width, height: heights.reduce(0, +) + spacing * CGFloat(max(subviews.count - 1, 0)))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        if let column = columnWidth(bounds.width, subviews.count) {
            let size = ProposedViewSize(width: column, height: nil)
            for (index, subview) in subviews.enumerated() {
                let x = bounds.minX + CGFloat(index) * (column + FRMetrics.columnGap)
                subview.place(at: CGPoint(x: x, y: bounds.minY), proposal: size)
            }
            return
        }
        let width = stackWidth(bounds.width)
        let size = ProposedViewSize(width: width, height: nil)
        var y = bounds.minY
        for subview in subviews {
            subview.place(at: CGPoint(x: bounds.midX - width / 2, y: y), proposal: size)
            y += subview.sizeThatFits(size).height + spacing
        }
    }
}

#Preview("Single column") {
    FRPage {
        ScreenHeader("Account")
        FRCard { Text("A card").frame(maxWidth: .infinity, alignment: .leading) }
    }
}

#Preview("Two columns") {
    FRPage {
        ScreenHeader("Popcorn Syndicate", subtitle: "2026 Season")
        FRCard { Text("Team").frame(maxWidth: .infinity, alignment: .leading) }
    } trailing: {
        SectionHeader("My movies")
        FRCard { Text("Movies").frame(maxWidth: .infinity, alignment: .leading) }
    }
}
