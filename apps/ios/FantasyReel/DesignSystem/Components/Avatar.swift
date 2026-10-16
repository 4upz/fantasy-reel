import SwiftUI

/// A user, team or league avatar: the remote image when there is one, otherwise
/// initials on one of the four `.ac*` brand fills (picked deterministically from
/// the name), or on the neutral elevated fill.
///
/// Circles for people and league pills; `.rounded` (12pt radius at 44) for team
/// avatars in cards, as on V2Home. Decorative unless given an accessibility label.
struct Avatar: View {
    enum Size: Hashable, Sendable {
        /// 28pt
        case small
        /// 36pt (standings rows)
        case medium
        /// 44pt (team card)
        case large
        /// 56pt (account profile)
        case profile
        /// 64pt
        case extraLarge
        case custom(CGFloat)

        var points: CGFloat {
            switch self {
            case .small: 28
            case .medium: 36
            case .large: 44
            case .profile: 56
            case .extraLarge: 64
            case .custom(let value): value
            }
        }
    }

    enum Corners: Hashable, Sendable {
        case circle
        /// Continuous rounded square, radius ≈ 27% of the side.
        case rounded
    }

    enum Fill: Hashable, Sendable {
        /// One of the four brand fills, chosen from the name.
        case brand
        /// The elevated surface with primary text (other members in standings).
        case neutral
    }

    private let name: String
    private let imageURL: URL?
    private let size: Size
    private let corners: Corners
    private let fill: Fill
    private let accessibilityLabelText: String?

    init(
        name: String,
        imageURL: String? = nil,
        size: Size = .medium,
        corners: Corners = .circle,
        fill: Fill = .brand,
        accessibilityLabel: String? = nil
    ) {
        self.name = name
        self.imageURL = imageURL.flatMap { URL(string: $0) }
        self.size = size
        self.corners = corners
        self.fill = fill
        self.accessibilityLabelText = accessibilityLabel
    }

    var body: some View {
        let side = size.points
        let dimension = CGSize(width: side, height: side)
        RemoteImage(url: imageURL, pointSize: dimension) {
            initialsTile(side: side)
        }
        .clipShape(avatarShape(side: side))
        .modifier(AvatarAccessibility(label: accessibilityLabelText))
    }

    private func initialsTile(side: CGFloat) -> some View {
        let tiles = Color.frAvatarTiles
        let background = fill == .brand ? tiles[FRInitials.stableIndex(for: name, count: tiles.count)] : Color.frElevated
        let ink = fill == .brand ? Color.frAvatarInk : Color.frText
        return ZStack {
            background
            Text(FRInitials.make(from: name))
                .font(FRFonts.fixedFont(.dmSans, weight: 700, size: max(11, (side * 0.37).rounded())))
                .foregroundStyle(ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(width: side, height: side)
    }

    private func avatarShape(side: CGFloat) -> AnyShape {
        switch corners {
        case .circle: AnyShape(Circle())
        case .rounded: AnyShape(RoundedRectangle(cornerRadius: (side * 0.27).rounded(), style: .continuous))
        }
    }
}

private struct AvatarAccessibility: ViewModifier {
    let label: String?

    @ViewBuilder
    func body(content: Content) -> some View {
        if let label {
            content
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(label)
                .accessibilityAddTraits(.isImage)
        } else {
            content.accessibilityHidden(true)
        }
    }
}

#if DEBUG
#Preview("Avatars") {
    FRPreviewCanvas {
        HStack(spacing: 12) {
            Avatar(name: "Alice Spielberg", size: .small)
            Avatar(name: "Bob Nolan", size: .medium)
            Avatar(name: "Reel Deal", size: .large, corners: .rounded)
            Avatar(name: "Carol Coppola", size: .profile)
            Avatar(name: "Dave Kubrick", size: .extraLarge, corners: .rounded)
        }
        HStack(spacing: 12) {
            Avatar(name: "Eve Lumet", size: .medium, fill: .neutral)
            Avatar(name: "Popcorn Syndicate", size: .custom(32))
        }
    }
}
#endif
