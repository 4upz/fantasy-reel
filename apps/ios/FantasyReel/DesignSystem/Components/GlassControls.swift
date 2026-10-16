import SwiftUI

/// A 44pt circular Liquid Glass button for the top bar (`.gbtn.glass`):
/// notifications bell, league `⋯` menu, search, back. Uses the real iOS 26
/// glass (`.glassEffect(.regular.interactive(), in: .circle)`).
///
/// The optional `badge` shows a `CountBadge` at the top-trailing corner and is
/// spoken as the button's value ("3 unread" by default).
///
/// Group several glass controls in `GlassCluster` so their glass blends.
struct GlassIconButton: View {
    private let systemImage: String
    private let label: String
    private let badge: Int?
    private let badgeAccessibilityValue: String?
    private let action: () -> Void

    init(
        systemImage: String,
        accessibilityLabel: String,
        badge: Int? = nil,
        badgeAccessibilityValue: String? = nil,
        action: @escaping () -> Void
    ) {
        self.systemImage = systemImage
        self.label = accessibilityLabel
        self.badge = badge
        self.badgeAccessibilityValue = badgeAccessibilityValue
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 19, weight: .medium))
                .foregroundStyle(Color.frText)
                .frame(width: FRMetrics.minTapTarget, height: FRMetrics.minTapTarget)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
        .overlay(alignment: .topTrailing) {
            if let badge, badge > 0 {
                CountBadge(count: badge, size: .small)
                    .offset(x: 2, y: -2)
                    .allowsHitTesting(false)
            }
        }
        .accessibilityLabel(label)
        .accessibilityValue(spokenBadge)
    }

    private var spokenBadge: String {
        guard let badge, badge > 0 else { return "" }
        return badgeAccessibilityValue ?? "\(badge) unread"
    }
}

/// The league pill at the top leading edge (`.gpill.glass`): the league's
/// avatar or initials at 32pt and an up/down chevron in a 44pt glass capsule.
/// Opens the menu sheet; give it a label such as "Open menu: leagues, wishlist,
/// account".
struct GlassPill: View {
    private let title: String
    private let imageURL: String?
    private let showsTitle: Bool
    private let label: String
    private let action: () -> Void

    /// - Parameters:
    ///   - title: the league name (initials and, if `showsTitle`, the visible label).
    ///   - showsTitle: show the name beside the avatar. The mockups show the avatar only.
    init(
        title: String,
        imageURL: String? = nil,
        showsTitle: Bool = false,
        accessibilityLabel: String,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.imageURL = imageURL
        self.showsTitle = showsTitle
        self.label = accessibilityLabel
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Avatar(name: title, imageURL: imageURL, size: .custom(32))
                if showsTitle {
                    Text(title)
                        .frFont(.controlSmall)
                        .lineLimit(1)
                }
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 13, weight: .semibold))
                    .accessibilityHidden(true)
            }
            .foregroundStyle(Color.frText)
            .padding(.leading, 6)
            .padding(.trailing, 14)
            .frame(minHeight: FRMetrics.minTapTarget)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .capsule)
        .accessibilityLabel(label)
    }
}

/// Wraps neighbouring glass controls in a `GlassEffectContainer` so they render
/// and morph as one glass layer, spaced 12pt apart as in the mockups.
struct GlassCluster<Content: View>: View {
    private let spacing: CGFloat
    private let content: Content

    init(spacing: CGFloat = 12, @ViewBuilder content: () -> Content) {
        self.spacing = spacing
        self.content = content()
    }

    var body: some View {
        GlassEffectContainer(spacing: spacing) {
            HStack(spacing: spacing) {
                content
            }
        }
    }
}

#if DEBUG
private struct GlassBarPreview: View {
    var body: some View {
        ZStack(alignment: .top) {
            FRPreviewCanvas {
                ScreenHeader("Popcorn Syndicate", subtitle: "2026 Season", status: .active)
                    .padding(.top, 56)
                FRRowGroup {
                    ForEach(FRSampleData.movies) { movie in
                        MovieRow(title: movie.title, meta: movie.meta, posterURL: nil, points: movie.points)
                    }
                }
            }
            HStack {
                GlassPill(title: "Popcorn Syndicate", accessibilityLabel: "Open menu: leagues, wishlist, account") {}
                Spacer()
                GlassCluster {
                    GlassIconButton(systemImage: "bell", accessibilityLabel: "Notifications", badge: 3) {}
                    GlassIconButton(systemImage: "ellipsis", accessibilityLabel: "League menu") {}
                }
            }
            .padding(.horizontal, FRMetrics.pageMargin)
        }
    }
}

#Preview("Glass bar · dark") { GlassBarPreview().preferredColorScheme(.dark) }
#Preview("Glass bar · light") { GlassBarPreview().preferredColorScheme(.light) }
#endif
