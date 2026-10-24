import FantasyReelCore
import SwiftUI

// Projected scores (Beta, F-19): the chip every surface shares, its
// counterpick reading, and the breakdown card. Ported from the web's
// `components/projections/`. Every surface carries the Beta badge, and each
// view renders nothing at all when there is no projection to show.

// MARK: - Chip

/// A movie's projected score as one reading in the unit of the real score
/// that replaces it: "Proj. 68–79%", or "Proj. 74%" tagged "Low confidence"
/// when the range is too wide to help. Read-only: the breakdown is in league
/// movie detail, which every row with a chip opens.
///
/// The dashed border is the projection's mark (a score still to be drawn);
/// gold at or above 60%, crimson below, neutral for a loose guess. The words
/// carry the same meaning, so color is never the only signal.
struct ProjectionChip: View {
    enum Size {
        /// `.pchip`, with the dashed tomato (detail and sheets).
        case regular
        /// `.pchip.sm`, inside a row's meta line.
        case small
    }

    let projection: MovieProjection
    var size: Size = .small

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let state = ProjectionText.chipState(projection)
        let small = size == .small
        let tone = Self.color(ProjectionText.tone(projection, state: state))
        // At accessibility sizes the chip is wider than a row's text column:
        // stack its parts and let them wrap rather than run off the edge.
        let stacked = dynamicTypeSize.isAccessibilitySize
        let layout = stacked
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
            : AnyLayout(HStackLayout(spacing: small ? 4 : 5))
        layout {
            if !small {
                ProjectedTomato(early: state.isEarly)
                    .frame(width: 14, height: 14)
            }
            Text(ProjectionText.chipLabel(state))
                .frFont(small ? .chipNumberSmall : .chipNumber)
                .foregroundStyle(tone)
            if state.isLowConfidence {
                Text("Low confidence")
                    .frFont(.captionStrong)
                    .foregroundStyle(Color.frWarning)
            }
            BetaBadge(compact: small)
        }
        .lineLimit(stacked ? nil : 1)
        .padding(.leading, 6)
        .padding(.trailing, small ? 3 : 4)
        .padding(.vertical, stacked ? 4 : 0)
        .frame(minHeight: small ? 20 : 24)
        .overlay {
            RoundedRectangle(cornerRadius: small ? 7 : 8, style: .continuous)
                .strokeBorder(tone.opacity(Self.borderOpacity(state)), style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
        }
        .fixedSize(horizontal: !stacked, vertical: true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Self.spokenLabel(projection))
    }

    /// Everything the chip shows, as VoiceOver says it.
    static func spokenLabel(_ projection: MovieProjection) -> String {
        let state = ProjectionText.chipState(projection)
        var parts = [ProjectionText.chipSpokenLabel(state)]
        if state.isLowConfidence { parts.append("low confidence") }
        parts.append("Beta")
        return parts.joined(separator: ", ")
    }

    static func color(_ tone: ProjectionText.Tone) -> Color {
        switch tone {
        case .fresh: .frGold
        case .rotten: .frCrimsonText
        case .uncertain: .frText
        }
    }

    /// `.pc-unc` borders in the muted gray; the tinted tones at 60%.
    private static func borderOpacity(_ state: ProjectionText.ChipState) -> Double {
        state == .insufficient || state.isLowConfidence ? 0.45 : 0.6
    }
}

private extension ProjectionText.ChipState {
    var isEarly: Bool {
        if case .early = self { return true }
        return false
    }

    var isLowConfidence: Bool {
        if case .point(_, true) = self { return true }
        return false
    }
}

/// A hollow, dashed tomato: the score still to be drawn. Half filled once
/// early reviews are in.
private struct ProjectedTomato: View {
    let early: Bool

    var body: some View {
        Canvas { context, size in
            let scale = min(size.width, size.height) / 20
            context.scaleBy(x: scale, y: scale)
            let body = Path(ellipseIn: CGRect(x: 3.4, y: 6.4, width: 13.2, height: 11.8))
            context.stroke(body, with: .foreground, style: StrokeStyle(lineWidth: 1.3, dash: [2.2, 1.6]))
            if early {
                var lower = Path()
                lower.addArc(center: CGPoint(x: 10, y: 12.3), radius: 6.6, startAngle: .zero, endAngle: .degrees(180), clockwise: false)
                lower.closeSubpath()
                context.fill(lower, with: .foreground)
            }
            var stem = Path(roundedRect: CGRect(x: 9.4, y: 3.4, width: 1.2, height: 2.8), cornerRadius: 0.6)
            stem.addEllipse(in: CGRect(x: 6.2, y: 4.6, width: 3.6, height: 2.2))
            stem.addEllipse(in: CGRect(x: 10.2, y: 4.6, width: 3.6, height: 2.2))
            context.opacity = 0.55
            context.fill(stem, with: .foreground)
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Row readings

/// What a movie is most likely worth to its counterpicker: the chip, plus
/// "≈ +N pts for you" (the negation of the movie's points). Without enough
/// history there is no number to negate, so only the chip shows.
struct CounterpickProjection: View {
    let projection: MovieProjection

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) { content }
            VStack(alignment: .leading, spacing: 4) { content }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Self.spokenLabel(projection))
    }

    @ViewBuilder
    private var content: some View {
        ProjectionChip(projection: projection)
        if let points = Self.points(projection) {
            Text("≈ \(FantasyPoints.signed(points)) pts for you")
                .frFont(.captionStrong)
                .foregroundStyle(points < 0 ? Color.frCrimsonText : Color.frGold)
                .lineLimit(1)
                .fixedSize()
        }
    }

    static func points(_ projection: MovieProjection) -> Double? {
        projection.insufficientHistory ? nil : ProjectionText.projectedPoints(projection, counterpick: true)
    }

    static func spokenLabel(_ projection: MovieProjection) -> String {
        var label = ProjectionChip.spokenLabel(projection)
        if let points = points(projection) {
            label += ", about \(FantasyPoints.spokenLabel(points, preRelease: false)) for you"
        }
        return label
    }
}

/// The projection for a row's accessory slot (`MovieRow(accessory:)`): the
/// chip, or the counterpick reading of it, with what VoiceOver should add to
/// the row. Nil when there is nothing to show, so the row is unchanged.
struct ProjectionAccessory {
    let view: AnyView
    let spokenLabel: String

    init?(_ projection: MovieProjection?, counterpick: Bool = false) {
        guard let projection else { return nil }
        if counterpick {
            view = AnyView(CounterpickProjection(projection: projection))
            spokenLabel = CounterpickProjection.spokenLabel(projection)
        } else {
            view = AnyView(ProjectionChip(projection: projection))
            spokenLabel = ProjectionChip.spokenLabel(projection)
        }
    }
}

// MARK: - Breakdown card

/// The full breakdown (`ProjectionBreakdown.tsx`): headline, the bar from the
/// genre baseline, named factors, the 80% range and chances, expected points
/// (negated "As a counterpick"), and the fixed disclaimer. League movie detail
/// shows it beside franchise history.
struct ProjectionCard: View {
    let projection: MovieProjection
    var counterpick = false

    private var state: ProjectionText.ChipState { ProjectionText.chipState(projection) }

    private var toneColor: Color {
        switch ProjectionText.tone(projection, state: state) {
        case .fresh: .frGold
        case .rotten: .frCrimsonText
        case .uncertain: .frTextSecondary
        }
    }

    var body: some View {
        FRCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 8) {
                    Text("Projected Tomatometer")
                        .frFont(.cardTitle)
                        .foregroundStyle(Color.frText)
                        .accessibilityAddTraits(.isHeader)
                    BetaBadge()
                }
                headline
                if state != .insufficient {
                    ProjectionBar(projection: projection)
                    factors
                    stats
                }
                FRHairline()
                VStack(alignment: .leading, spacing: 6) {
                    if state != .insufficient {
                        Text(ProjectionText.rangeExplainer)
                    }
                    Text(ProjectionText.disclaimer)
                }
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .overlay {
            RoundedRectangle(cornerRadius: FRMetrics.cardRadius, style: .continuous)
                .strokeBorder(Color.frGold.opacity(0.45), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                .accessibilityHidden(true)
        }
    }

    private var headline: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(state == .insufficient ? ProjectionText.chipLabel(state) : ProjectionText.headline(state, projection: projection))
                    .frFont(state == .insufficient ? .sectionTitle : .numberHero)
                    .foregroundStyle(toneColor)
                Text(subhead)
                    .frFont(.label)
                    .foregroundStyle(Color.frTextSecondary)
            }
            if let updated = projection.computedAt {
                Text("Updated \(updated.formatted(.dateTime.month(.abbreviated).day()))")
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel([
            ProjectionText.chipSpokenLabel(state),
            subhead,
            projection.computedAt.map { "Updated \($0.formatted(.dateTime.month(.wide).day()))" },
        ].compactMap { $0 }.joined(separator: ". "))
    }

    private var subhead: String {
        switch state {
        case .early(_, let reviews): "Early reviews · \(reviews) so far"
        case .insufficient: "Too few related films to project"
        case .point(_, true): "Loose estimate"
        default: "Middle half of outcomes"
        }
    }

    private var factors: some View {
        VStack(spacing: 8) {
            FactorRow(label: "Genre baseline", value: "\(Int(JSMath.round(projection.baselineRT)))", color: .frTextSecondary, tint: .frTextMuted)
            ForEach(ProjectionText.factors(projection)) { factor in
                let positive = factor.delta >= 0
                FactorRow(
                    label: factor.label,
                    value: FantasyPoints.signed(factor.delta),
                    color: positive ? .frGold : .frCrimsonText,
                    tint: positive ? .frGold : .frCrimson
                )
            }
        }
    }

    private var stats: some View {
        let range = projection.range80Bounds
        let expected = ProjectionText.projectedPoints(projection, counterpick: counterpick)
        return VStack(alignment: .leading, spacing: 8) {
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 12) {
                GridRow {
                    Stat(label: "80% range", value: "\(Int(JSMath.round(range.low)))–\(Int(JSMath.round(range.high)))%")
                    Stat(label: "Chance rotten", value: ProjectionText.chance(projection.pRotten))
                }
                GridRow {
                    Stat(label: "Chance of 90%+", value: ProjectionText.chance(projection.p90))
                    Stat(
                        label: counterpick ? "As a counterpick" : "Expected points",
                        value: "\(FantasyPoints.signed(expected)) pts",
                        color: expected >= 0 ? .frGold : .frCrimsonText
                    )
                }
            }
            if let note = ProjectionCard.note(projection) {
                Text(note)
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

extension ProjectionCard {
    /// "Includes early reviews." and "Still collecting earlier films, so this may move."
    static func note(_ projection: MovieProjection) -> String? {
        let parts = [
            projection.includesEarlyReviews ? "Includes early reviews." : nil,
            projection.partial ? "Still collecting earlier films, so this may move." : nil,
        ].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }
}

private struct FactorRow: View {
    let label: String
    let value: String
    let color: Color
    let tint: Color

    var body: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 2)
                .fill(tint)
                .frame(width: 10, height: 10)
                .accessibilityHidden(true)
            Text(label)
                .frFont(.bodySmall)
                .foregroundStyle(Color.frText)
            Spacer()
            Text(value)
                .frFont(.numberSmall)
                .foregroundStyle(color)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct Stat: View {
    let label: String
    let value: String
    var color: Color = .frText

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .frFont(.meta)
                .foregroundStyle(Color.frTextSecondary)
            Text(value)
                .frFont(.number)
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// The stacked 0–100 bar: the genre baseline, then each factor stepping the
/// total up (gold) or down (crimson), with the 60% break-even marked.
private struct ProjectionBar: View {
    let projection: MovieProjection

    var body: some View {
        let segments = ProjectionText.barSegments(baseline: projection.baselineRT, factors: ProjectionText.factors(projection))
        VStack(spacing: 4) {
            GeometryReader { proxy in
                let width = proxy.size.width
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.frElevated)
                    ForEach(segments) { segment in
                        Rectangle()
                            .fill(segment.key == "baseline" ? Color.frTextMuted : (segment.positive ? Color.frGold : Color.frCrimson))
                            .frame(width: width * segment.width / 100)
                            .offset(x: width * segment.start / 100)
                    }
                    Rectangle()
                        .fill(Color.frText.opacity(0.8))
                        .frame(width: 1.5)
                        .offset(x: width * ProjectionText.breakEven / 100)
                }
                .clipShape(Capsule())
            }
            .frame(height: 12)
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Text(verbatim: "0")
                    Text(verbatim: "60")
                        .offset(x: proxy.size.width * 0.6 - 8)
                    Text(verbatim: "100")
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
            .frame(height: 16)
            .frFont(.caption)
            .dynamicTypeSize(...DynamicTypeSize.large)
            .foregroundStyle(Color.frTextSecondary)
        }
        .accessibilityHidden(true)
    }
}

