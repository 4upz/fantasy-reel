import CoreGraphics

/// Layout constants from the v2 design review ("v3 layout rules" in the mockups).
///
/// 16pt page margin · 22pt card radius, never a card inside a card · 64pt movie
/// rows with 36×54 posters and a fixed 64pt trailing points column · 44pt
/// minimum tap targets. Heights here are *minimums*: rows and buttons grow with
/// Dynamic Type instead of clipping.
nonisolated enum FRMetrics {
    /// Horizontal page margin (`.gscroll` padding).
    static let pageMargin: CGFloat = 16
    /// Corner radius of cards and row groups (`.card`, `.grp`). Always `.continuous`.
    static let cardRadius: CGFloat = 22
    /// Inner padding of a card.
    static let cardPadding: CGFloat = 16
    /// Minimum height of a movie/team row (`.mrow`).
    static let rowHeight: CGFloat = 64
    /// Minimum height of a hero row (`.mrow.hero`).
    static let heroRowHeight: CGFloat = 72
    /// Poster thumbnail in a row (`.p36`).
    static let posterThumb = CGSize(width: 36, height: 54)
    /// Corner radius of the row poster thumbnail.
    static let posterThumbRadius: CGFloat = 5
    /// Fixed trailing points column (`.trail`).
    static let trailingColumn: CGFloat = 64
    /// Leading inset of row separators (`--sepl`): 16 padding + 36 poster + 12 gap.
    static let separatorInset: CGFloat = 64
    /// Separator inset for settings/form rows with no leading artwork (`.srow`).
    static let plainSeparatorInset: CGFloat = 16
    /// Minimum interactive target (Apple HIG, N-08).
    static let minTapTarget: CGFloat = 44
    /// Vertical gap between stacked page sections (`.gscroll` gap).
    static let sectionSpacing: CGFloat = 12
    /// Horizontal padding inside a row.
    static let rowPadding: CGFloat = 16
    /// Gap between a row's poster, text and trailing column.
    static let rowGap: CGFloat = 12
}
