/// A centered empty state (V2NoLeagues): a gold icon or an illustration, a
/// panel title (a header for VoiceOver), a short secondary message, and
/// full-width actions stacked 12pt apart. Use one `.frPrimary` action at most.
///
/// Illustrations (docs/IOS-DELIGHT-PLAN.md, 5.2) go only on the empty screens
/// the plan lists; errors and dead ends ("no results", "team not found") keep
/// an icon. The art is `FRMetrics.illustrationWidth` wide on every iPhone,
/// hidden from VoiceOver (the title and message say it all), and settles in
/// once per visit (`FRArrival`, keyed by the title).
struct EmptyStateView<Actions: View>: View {
    private enum Icon {
        case symbol(String)
        case illustration((_ settled: Bool) -> AnyView)
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

    /// - Parameter illustration: a flat illustration (one asset catalog
    ///   image). It rises into place once per visit.
    init(
        title: String,
        message: String? = nil,
        illustration: Image,
        @ViewBuilder actions: () -> Actions
    ) {
        self.init(title: title, message: message, illustration: { settled in
            illustration
                .resizable()
                .scaledToFit()
                .offset(y: settled ? 0 : 12)
                .opacity(settled ? 1 : 0)
        }, actions: actions)
    }

    /// - Parameter illustration: an illustration built from parts, drawn
    ///   settled when `settled` is true and in its arriving state when false
    ///   (parts offset, faded). The change is animated once per visit with
    ///   the `.moment` tier; with Reduce Motion on it is always settled.
    init<Art: View>(
        title: String,
        message: String? = nil,
        @ViewBuilder illustration: @escaping (_ settled: Bool) -> Art,
        @ViewBuilder actions: () -> Actions
    ) {
        self.title = title
        self.message = message
        self.icon = .illustration { AnyView(illustration($0)) }
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
            case .illustration(let art):
                FRArrival("empty-state:\(title)") { settled in art(settled) }
                    .frame(width: FRMetrics.illustrationWidth)
                    .accessibilityHidden(true)
            case nil:
                EmptyView()
            }
            Text(title)
                .frFont(.panelTitle)
                .foregroundStyle(Color.frText)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, titleSpacing)
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

    private var titleSpacing: CGFloat {
        switch icon {
        case .symbol: 12
        case .illustration: 16
        case nil: 0
        }
    }
}

extension EmptyStateView where Actions == EmptyView {
    /// An empty state without actions.
    init(title: String, message: String? = nil, systemImage: String? = nil) {
        self.init(title: title, message: message, systemImage: systemImage) { EmptyView() }
    }

    /// An empty state with a flat illustration and no actions.
    init(title: String, message: String? = nil, illustration: Image) {
        self.init(title: title, message: message, illustration: illustration) { EmptyView() }
    }

    /// An empty state with an illustration built from parts and no actions.
    init<Art: View>(
        title: String,
        message: String? = nil,
        @ViewBuilder illustration: @escaping (_ settled: Bool) -> Art
    ) {
        self.init(title: title, message: message, illustration: illustration) { EmptyView() }
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
