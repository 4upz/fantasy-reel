import SwiftUI

/// A centered empty state (V2NoLeagues): gold icon or brand mark, a panel
/// title (a header for VoiceOver), a short secondary message, and full-width
/// actions stacked 12pt apart. Use one `.frPrimary` action at most.
struct EmptyStateView<Actions: View>: View {
    private enum Icon {
        case symbol(String)
        case image(Image)
    }

    private let title: String
    private let message: String?
    private let icon: Icon?
    private let actions: Actions

    /// - Parameter systemImage: an SF Symbol drawn in gold.
    init(
        title: String,
        message: String? = nil,
        systemImage: String? = nil,
        @ViewBuilder actions: () -> Actions
    ) {
        self.title = title
        self.message = message
        self.icon = systemImage.map { Icon.symbol($0) }
        self.actions = actions()
    }

    /// - Parameter image: a brand illustration (asset catalog image), shown at 55×48.
    init(
        title: String,
        message: String? = nil,
        image: Image,
        @ViewBuilder actions: () -> Actions
    ) {
        self.title = title
        self.message = message
        self.icon = .image(image)
        self.actions = actions()
    }

    var body: some View {
        VStack(spacing: 0) {
            switch icon {
            case .symbol(let name):
                Image(systemName: name)
                    .font(.system(size: 40, weight: .regular))
                    .foregroundStyle(Color.frGold)
                    .accessibilityHidden(true)
            case .image(let image):
                image
                    .resizable()
                    .scaledToFit()
                    .frame(width: 55, height: 48)
                    .accessibilityHidden(true)
            case nil:
                EmptyView()
            }
            Text(title)
                .frFont(.panelTitle)
                .foregroundStyle(Color.frText)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, icon == nil ? 0 : 12)
            if let message {
                Text(message)
                    .frFont(.body)
                    .foregroundStyle(Color.frTextSecondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 300)
                    .padding(.top, 8)
            }
            VStack(spacing: 12) {
                actions
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 20)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 8)
        .padding(.top, 12)
        .frame(maxWidth: .infinity)
    }
}

extension EmptyStateView where Actions == EmptyView {
    /// An empty state without actions.
    init(title: String, message: String? = nil, systemImage: String? = nil) {
        self.init(title: title, message: message, systemImage: systemImage) { EmptyView() }
    }
}

#if DEBUG
#Preview("Empty · dark") {
    FRPreviewCanvas {
        EmptyStateView(
            title: "You're not in a league yet",
            message: "Start one with friends, or join with the code your commissioner shared.",
            systemImage: "film.stack"
        ) {
            Button("Create League") {}.buttonStyle(.frPrimary)
            Button("Join with Code") {}.buttonStyle(.frSecondary)
        }
        EmptyStateView(title: "No bids yet", message: "Bids you place show up here.", systemImage: "dollarsign.circle")
    }
}

#Preview("Empty · light") {
    FRPreviewCanvas {
        EmptyStateView(title: "Your wishlist is empty", message: "Save movies you want to draft.", systemImage: "heart")
    }
    .preferredColorScheme(.light)
}
#endif
