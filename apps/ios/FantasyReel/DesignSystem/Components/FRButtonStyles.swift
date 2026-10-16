import SwiftUI

/// Fantasy Reel capsule buttons (`.btn` + `.cap44` / `.pill44` / `.btn-sm`).
///
/// | Kind          | Mockup          | Fill / text                 |
/// |---------------|-----------------|-----------------------------|
/// | `.primary`    | `.btn-p`        | gold / on-gold              |
/// | `.secondary`  | `.btn-s`        | gold tint / gold            |
/// | `.destructive`| `.btn-d`        | error tint / error          |
/// | `.neutral`    | Decline button  | elevated / primary text     |
///
/// Sizes: `.large` 50pt (full width by default), `.medium` 44pt, `.compact`
/// 34pt visual inside a 44pt hit area. All grow with Dynamic Type. Disabled
/// buttons use the elevated fill with muted text rather than an opacity fade,
/// so they stay legible. `isLoading` swaps the label for a spinner while
/// keeping the button's size; pair it with `AsyncAction`, which ignores taps
/// while running.
///
/// One filled primary action per card.
///
/// ```swift
/// Button("Create League") { … }.buttonStyle(.frPrimary)
/// Button("Bid") { … }.buttonStyle(.fr(.secondary, size: .compact))
/// Button("Place Bid") { … }.buttonStyle(.fr(.primary, isLoading: action.isRunning))
/// ```
struct FRButtonStyle: ButtonStyle {
    enum Kind: Hashable, Sendable {
        case primary, secondary, destructive, neutral
    }

    enum Size: Hashable, Sendable {
        /// 50pt capsule, 17pt label (`.cap44`).
        case large
        /// 44pt capsule, 16pt label (`.pill44`).
        case medium
        /// 34pt capsule, 15pt label, 44pt hit area (`.btn-sm`).
        case compact

        var visualHeight: CGFloat {
            switch self {
            case .large: 50
            case .medium: 44
            case .compact: 34
            }
        }

        var horizontalPadding: CGFloat {
            switch self {
            case .large: 20
            case .medium: 16
            case .compact: 14
            }
        }

        var role: FRTextRole {
            switch self {
            case .large: .control
            case .medium: .rowTitle
            case .compact: .controlSmall
            }
        }
    }

    var kind: Kind
    var size: Size = .large
    var isLoading: Bool = false
    /// Defaults to full width for `.large`, intrinsic width otherwise.
    var fullWidth: Bool?

    func makeBody(configuration: Configuration) -> some View {
        FRButtonBody(
            label: configuration.label,
            isPressed: configuration.isPressed,
            kind: kind,
            size: size,
            isLoading: isLoading,
            fullWidth: fullWidth ?? (size == .large)
        )
    }
}

private struct FRButtonBody: View {
    let label: ButtonStyleConfiguration.Label
    let isPressed: Bool
    let kind: FRButtonStyle.Kind
    let size: FRButtonStyle.Size
    let isLoading: Bool
    let fullWidth: Bool

    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        label
            .frFont(size.role)
            .lineLimit(2)
            .multilineTextAlignment(.center)
            .opacity(isLoading ? 0 : 1)
            .overlay {
                if isLoading {
                    ProgressView()
                        .tint(foreground)
                }
            }
            .padding(.horizontal, size.horizontalPadding)
            .padding(.vertical, 6)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: size.visualHeight)
            .foregroundStyle(foreground)
            .background(background, in: Capsule())
            .opacity(isPressed && isEnabled ? 0.72 : 1)
            .frame(minHeight: FRMetrics.minTapTarget)
            .contentShape(Rectangle())
            .animation(.easeOut(duration: 0.12), value: isPressed)
            .accessibilityValue(isLoading ? Text("In progress") : Text(""))
    }

    private var foreground: Color {
        guard isEnabled else { return .frTextMuted }
        switch kind {
        case .primary: return .frOnGold
        case .secondary: return .frGold
        case .destructive: return .frError
        case .neutral: return .frText
        }
    }

    private var background: Color {
        guard isEnabled else { return .frElevated }
        switch kind {
        case .primary: return .frGold
        case .secondary: return .frGoldTint
        case .destructive: return .frErrorTint
        case .neutral: return .frElevated
        }
    }
}

extension ButtonStyle where Self == FRButtonStyle {
    /// Gold filled capsule, 50pt, full width.
    static var frPrimary: FRButtonStyle { FRButtonStyle(kind: .primary) }
    /// Gold tinted capsule, 50pt, full width.
    static var frSecondary: FRButtonStyle { FRButtonStyle(kind: .secondary) }
    /// Error tinted capsule, 50pt, full width.
    static var frDestructive: FRButtonStyle { FRButtonStyle(kind: .destructive) }
    /// Elevated neutral capsule, 50pt, full width.
    static var frNeutral: FRButtonStyle { FRButtonStyle(kind: .neutral) }

    /// Any kind at any size, with a loading state.
    static func fr(
        _ kind: FRButtonStyle.Kind,
        size: FRButtonStyle.Size = .large,
        isLoading: Bool = false,
        fullWidth: Bool? = nil
    ) -> FRButtonStyle {
        FRButtonStyle(kind: kind, size: size, isLoading: isLoading, fullWidth: fullWidth)
    }
}

#if DEBUG
private struct FRButtonGallery: View {
    var body: some View {
        FRPreviewCanvas {
            Button("Create League") {}.buttonStyle(.frPrimary)
            Button("Join with Code") {}.buttonStyle(.frSecondary)
            Button("Delete Account") {}.buttonStyle(.frDestructive)
            Button("Place Bid") {}.buttonStyle(.fr(.primary, isLoading: true))
            Button("Disabled") {}.buttonStyle(.frPrimary).disabled(true)
            HStack(spacing: 12) {
                Button("Decline") {}.buttonStyle(.fr(.neutral, size: .medium, fullWidth: true))
                Button("Accept") {}.buttonStyle(.fr(.secondary, size: .medium, fullWidth: true))
            }
            HStack(spacing: 12) {
                Button("Bid") {}.buttonStyle(.fr(.secondary, size: .compact))
                Button("Raise") {}.buttonStyle(.fr(.destructive, size: .compact))
                Button("Try Again") {}.buttonStyle(.fr(.secondary, size: .medium))
            }
        }
    }
}

#Preview("Buttons · dark") { FRButtonGallery().preferredColorScheme(.dark) }
#Preview("Buttons · light") { FRButtonGallery().preferredColorScheme(.light) }
#endif
