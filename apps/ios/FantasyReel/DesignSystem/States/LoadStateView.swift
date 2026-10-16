import SwiftUI

/// Renders a `LoadState`: `LoadingView` while idle/loading, `content` when
/// loaded, `empty` when the load succeeded with nothing to show, and
/// `ErrorStateView` (with Try Again when `retry` is given) on failure.
///
/// ```swift
/// LoadStateView(model.roster, loadingLabel: "Loading roster…",
///               emptyTitle: "No movies yet", emptySystemImage: "film",
///               retry: { Task { await model.load() } }) { roster in
///     RosterList(roster)
/// }
/// ```
struct LoadStateView<Value, Content: View, Empty: View>: View {
    private let state: LoadState<Value>
    private let loadingLabel: String
    private let retry: (() -> Void)?
    private let content: (Value) -> Content
    private let empty: () -> Empty

    init(
        _ state: LoadState<Value>,
        loadingLabel: String = "Loading…",
        retry: (() -> Void)? = nil,
        @ViewBuilder content: @escaping (Value) -> Content,
        @ViewBuilder empty: @escaping () -> Empty
    ) {
        self.state = state
        self.loadingLabel = loadingLabel
        self.retry = retry
        self.content = content
        self.empty = empty
    }

    var body: some View {
        switch state {
        case .idle, .loading:
            LoadingView(label: loadingLabel)
        case .loaded(let value):
            content(value)
        case .empty:
            empty()
        case .failed(let message):
            ErrorStateView(message: message, retry: retry)
        }
    }
}

extension LoadStateView where Empty == EmptyStateView<EmptyView> {
    /// Uses a standard `EmptyStateView` for the empty state.
    init(
        _ state: LoadState<Value>,
        loadingLabel: String = "Loading…",
        emptyTitle: String,
        emptyMessage: String? = nil,
        emptySystemImage: String? = nil,
        retry: (() -> Void)? = nil,
        @ViewBuilder content: @escaping (Value) -> Content
    ) {
        self.init(state, loadingLabel: loadingLabel, retry: retry, content: content) {
            EmptyStateView(title: emptyTitle, message: emptyMessage, systemImage: emptySystemImage)
        }
    }
}

#if DEBUG
#Preview("Load states") {
    @Previewable @State var state: LoadState<[FRSampleData.Movie]> = .loaded(FRSampleData.movies)
    VStack(spacing: 0) {
        FRSegmentedControl(
            "State",
            selection: Binding(
                get: { stateName(state) },
                set: { name in
                    switch name {
                    case "Loading": state = .loading
                    case "Empty": state = .empty
                    case "Failed": state = .failed(message: "The server didn't respond.")
                    default: state = .loaded(FRSampleData.movies)
                    }
                }
            ),
            options: ["Loaded", "Loading", "Empty", "Failed"],
            title: { $0 }
        )
        .padding(FRMetrics.pageMargin)
        LoadStateView(
            state,
            emptyTitle: "No movies yet",
            emptyMessage: "Movies you draft or win show up here.",
            emptySystemImage: "film",
            retry: { state = .loading }
        ) { movies in
            ScrollView {
                FRRowGroup {
                    ForEach(movies) { movie in
                        MovieRow(title: movie.title, meta: movie.meta, posterURL: nil, points: movie.points)
                    }
                }
                .padding(FRMetrics.pageMargin)
            }
        }
    }
    .frame(maxHeight: .infinity, alignment: .top)
    .background(Color.frBackground)
}

private func stateName(_ state: LoadState<[FRSampleData.Movie]>) -> String {
    switch state {
    case .idle, .loading: "Loading"
    case .loaded: "Loaded"
    case .empty: "Empty"
    case .failed: "Failed"
    }
}
#endif
