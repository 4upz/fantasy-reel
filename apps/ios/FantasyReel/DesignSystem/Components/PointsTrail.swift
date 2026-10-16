import FantasyReelCore
import SwiftUI

/// Color treatment for a trailing value. Every tone that carries meaning is
/// paired with a sign or a word, so color is never the only signal.
enum FRValueTone: Hashable, Sendable {
    /// Counted positive points (`.pos`, `--ok`), always shown with "+".
    case positive
    /// Counted negative points (`.negv`, `--err`), always shown with "−".
    case negative
    /// Plain values: totals, zero, prices.
    case neutral
    /// Not counted yet: pre-release points, Pending (`--fg3`), always with a word.
    case muted
    /// Featured value (projected finish).
    case gold

    var color: Color {
        switch self {
        case .positive: .frSuccess
        case .negative: .frError
        case .neutral: .frText
        case .muted: .frTextMuted
        case .gold: .frGold
        }
    }
}

/// The `.trail` column: a right-aligned value with an optional small caption,
/// in a fixed 64pt column so values line up down a row group. At accessibility
/// sizes the column grows instead of clipping.
///
/// Use for totals ("131"), prices ("$9" / "your bid"), RT scores. For fantasy
/// points use `PointsTrail`, which picks the tone and spoken label.
struct TrailingValue: View {
    private let text: String
    private let caption: String?
    private let tone: FRValueTone
    private let role: FRTextRole
    private let columnWidth: CGFloat?

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    init(
        _ text: String,
        caption: String? = nil,
        tone: FRValueTone = .neutral,
        role: FRTextRole = .number,
        columnWidth: CGFloat? = FRMetrics.trailingColumn
    ) {
        self.text = text
        self.caption = caption
        self.tone = tone
        self.role = role
        self.columnWidth = columnWidth
    }

    var body: some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(text)
                .frFont(role)
                .foregroundStyle(tone.color)
            if let caption {
                Text(caption)
                    .frFont(.caption)
                    .foregroundStyle(Color.frTextMuted)
            }
        }
        .lineLimit(1)
        .multilineTextAlignment(.trailing)
        .fixedSize(horizontal: dynamicTypeSize.isAccessibilitySize, vertical: false)
        .frame(width: dynamicTypeSize.isAccessibilitySize ? nil : columnWidth, alignment: .trailing)
        .frame(minWidth: dynamicTypeSize.isAccessibilitySize ? columnWidth : nil, alignment: .trailing)
    }
}

/// Fantasy points in the trailing column.
///
/// - counted: "+28" green, "−4" red, "0" plain (whole numbers via `FantasyPoints.signed`)
/// - pre-release: muted value with "at release" under it
/// - no score (`nil`): the word "Pending" in muted meta
///
/// VoiceOver hears `FantasyPoints.spokenLabel` ("plus 28 points", "pending").
struct PointsTrail: View {
    private let points: Double?
    private let preRelease: Bool
    private let caption: String?
    private let valueRole: FRTextRole
    private let columnWidth: CGFloat?

    init(
        points: Double?,
        preRelease: Bool = false,
        caption: String? = nil,
        valueRole: FRTextRole = .number,
        columnWidth: CGFloat? = FRMetrics.trailingColumn
    ) {
        self.points = points
        self.preRelease = preRelease
        self.caption = caption
        self.valueRole = valueRole
        self.columnWidth = columnWidth
    }

    var body: some View {
        Group {
            if let points {
                TrailingValue(
                    FantasyPoints.signed(points),
                    caption: preRelease ? (caption ?? "at release") : caption,
                    tone: preRelease ? .muted : PointsText.tone(for: points),
                    role: valueRole,
                    columnWidth: columnWidth
                )
            } else {
                TrailingValue("Pending", caption: caption, tone: .muted, role: .meta, columnWidth: columnWidth)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spokenLabel)
    }

    private var spokenLabel: String {
        let base = FantasyPoints.spokenLabel(points, preRelease: preRelease)
        guard let caption, !(preRelease && caption == "at release") else { return base }
        return "\(base), \(caption)"
    }
}

/// Signed whole-number points as inline text with the points tone, for use
/// outside the trailing column (the movie detail score card, a team total).
struct PointsText: View {
    private let points: Double
    private let preRelease: Bool
    private let role: FRTextRole

    init(_ points: Double, preRelease: Bool = false, role: FRTextRole = .number) {
        self.points = points
        self.preRelease = preRelease
        self.role = role
    }

    var body: some View {
        Text(FantasyPoints.signed(points))
            .frFont(role)
            .foregroundStyle(preRelease ? Color.frTextMuted : Self.tone(for: points).color)
            .accessibilityLabel(FantasyPoints.spokenLabel(points, preRelease: preRelease))
    }

    /// Tone from the *displayed* (rounded) value, so "−0.4" shown as "0" is plain.
    static func tone(for points: Double) -> FRValueTone {
        let shown = FantasyPoints.signed(points)
        if shown.hasPrefix("+") { return .positive }
        if shown.hasPrefix("\u{2212}") || shown.hasPrefix("-") { return .negative }
        return .neutral
    }
}

#if DEBUG
#Preview("Points") {
    FRPreviewCanvas {
        FRCard {
            HStack {
                PointsTrail(points: 28)
                PointsTrail(points: -4)
                PointsTrail(points: 0)
                PointsTrail(points: 14, preRelease: true)
                PointsTrail(points: nil)
            }
        }
        FRCard {
            HStack(alignment: .lastTextBaseline) {
                Text("74%").frFont(.numberHero).foregroundStyle(Color.frTextMuted)
                Spacer()
                PointsTrail(points: 14, preRelease: true, valueRole: .numberLarge, columnWidth: nil)
            }
        }
    }
}

#Preview("Points · light") {
    FRPreviewCanvas {
        HStack {
            PointsTrail(points: 28)
            PointsTrail(points: -4)
            PointsTrail(points: 14, preRelease: true)
            PointsTrail(points: nil)
            TrailingValue("$9", caption: "your bid")
        }
    }
    .preferredColorScheme(.light)
}
#endif
