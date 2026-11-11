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
            Group {
                if let trailing, width == .regular {
                    FRColumnsLayout(spacing: spacing) {
                        column { leading }
                        column { trailing }
                    }
                } else {
                    column {
                        leading
                        trailing
                    }
                    .frame(maxWidth: width == .regular ? FRMetrics.readableWidth : nil)
                }
            }
            .frame(maxWidth: .infinity)
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

/// Two equal, top-aligned columns, or one column (the second under the
/// first) when the offered width can't give each at least
/// `FRMetrics.minColumnWidth`. Deciding from the width offered, not the
/// screen, keeps it right in Split View and in a sheet.
private struct FRColumnsLayout: Layout {
    let spacing: CGFloat

    private func columnWidth(_ width: CGFloat) -> CGFloat? {
        let column = (width - FRMetrics.columnGap) / 2
        return column >= FRMetrics.minColumnWidth ? column : nil
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard subviews.count == 2 else { return .zero }
        let width = proposal.width ?? FRMetrics.readableWidth
        if let column = columnWidth(width) {
            let heights = subviews.map { $0.sizeThatFits(.init(width: column, height: nil)).height }
            return CGSize(width: width, height: heights.max() ?? 0)
        }
        let heights = subviews.map { $0.sizeThatFits(.init(width: width, height: nil)).height }
        return CGSize(width: width, height: heights.reduce(0, +) + spacing)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard subviews.count == 2 else { return }
        if let column = columnWidth(bounds.width) {
            let size = ProposedViewSize(width: column, height: nil)
            subviews[0].place(at: bounds.origin, proposal: size)
            subviews[1].place(at: CGPoint(x: bounds.minX + column + FRMetrics.columnGap, y: bounds.minY), proposal: size)
        } else {
            let size = ProposedViewSize(width: bounds.width, height: nil)
            let first = subviews[0].sizeThatFits(size).height
            subviews[0].place(at: bounds.origin, proposal: size)
            subviews[1].place(at: CGPoint(x: bounds.minX, y: bounds.minY + first + spacing), proposal: size)
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
