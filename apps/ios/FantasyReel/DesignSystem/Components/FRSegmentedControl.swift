import SwiftUI

/// The `.gseg` pill segmented control (Standings Current/Projected, Bids
/// Active/History, Appearance System/Light/Dark).
///
/// Custom rather than `Picker(.segmented)` because the mockup's capsule track,
/// 36pt height, raised capsule selection and inline badges ("Projected BETA",
/// counts) aren't achievable by styling the native control. It keeps native
/// semantics: VoiceOver hears each segment as a button with the Selected
/// trait inside a labelled group, and every segment has a 44pt hit area even
/// though the track is 36pt.
struct FRSegmentedControl<Option: Hashable, SegmentLabel: View>: View {
    enum Track: Sendable {
        /// Surface track, elevated selection (`.gseg` default; on the page background).
        case surface
        /// Elevated track, surface selection (Bids/Menu variant, or inside a card).
        case elevated
    }

    @Binding private var selection: Option
    private let options: [Option]
    private let groupLabel: String
    private let track: Track
    private let label: (Option) -> SegmentLabel

    @Namespace private var namespace
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(
        _ accessibilityLabel: String,
        selection: Binding<Option>,
        options: [Option],
        track: Track = .surface,
        @ViewBuilder label: @escaping (Option) -> SegmentLabel
    ) {
        self.groupLabel = accessibilityLabel
        self._selection = selection
        self.options = options
        self.track = track
        self.label = label
    }

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.self) { option in
                segment(option)
            }
        }
        .padding(.horizontal, 3)
        .background {
            Capsule()
                .fill(track == .surface ? Color.frSurface : Color.frElevated)
                .padding(.vertical, 4)
        }
        .frame(minHeight: FRMetrics.minTapTarget)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(groupLabel)
    }

    private func segment(_ option: Option) -> some View {
        let isSelected = option == selection
        return Button {
            guard !isSelected else { return }
            withAnimation(reduceMotion ? nil : .snappy(duration: 0.25)) {
                selection = option
            }
        } label: {
            HStack(spacing: 6) {
                label(option)
            }
            .frFont(isSelected ? .controlSmall : .label)
            .foregroundStyle(Color.frText)
            .lineLimit(1)
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, minHeight: FRMetrics.minTapTarget)
            .background {
                if isSelected {
                    Capsule()
                        .fill(selectedFill)
                        .shadow(color: .black.opacity(0.25), radius: 1.5, y: 1)
                        .padding(.vertical, 7)
                        .matchedGeometryEffect(id: "selection", in: namespace)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var selectedFill: Color {
        track == .surface ? Color.frSegmentSelected : Color.frSurface
    }
}

extension FRSegmentedControl where SegmentLabel == Text {
    /// Segments with plain titles.
    init(
        _ accessibilityLabel: String,
        selection: Binding<Option>,
        options: [Option],
        track: Track = .surface,
        title: @escaping (Option) -> String
    ) {
        self.init(accessibilityLabel, selection: selection, options: options, track: track) { option in
            Text(title(option))
        }
    }
}

#if DEBUG
private enum PreviewStandingsMode: String, CaseIterable, Hashable {
    case current = "Current"
    case projected = "Projected"
}

#Preview("Segmented · dark") {
    @Previewable @State var view = PreviewStandingsMode.current
    @Previewable @State var appearance = "System"
    FRPreviewCanvas {
        FRSegmentedControl("Standings view", selection: $view, options: PreviewStandingsMode.allCases) { option in
            Text(option.rawValue)
            if option == .projected { BetaBadge() }
        }
        FRSegmentedControl(
            "Appearance", selection: $appearance, options: ["System", "Light", "Dark"], track: .elevated,
            title: { $0 }
        )
    }
}

#Preview("Segmented · light") {
    @Previewable @State var view = PreviewStandingsMode.current
    FRPreviewCanvas {
        FRSegmentedControl("Standings view", selection: $view, options: PreviewStandingsMode.allCases, title: \.rawValue)
    }
    .preferredColorScheme(.light)
}
#endif
