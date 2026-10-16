/// The state of an async load, rendered by `LoadStateView`. Every screen has
/// loading, empty and error states (N-07).
///
/// `empty` is a successful load with nothing to show; keep it distinct from a
/// failure so the screen can offer "Create League" rather than "Try Again".
nonisolated enum LoadState<Value> {
    case idle
    case loading
    case loaded(Value)
    case empty
    case failed(message: String)
}

nonisolated extension LoadState: Sendable where Value: Sendable {}
nonisolated extension LoadState: Equatable where Value: Equatable {}

nonisolated extension LoadState {
    /// The loaded value, if any.
    var value: Value? {
        if case .loaded(let value) = self { return value }
        return nil
    }

    /// True while idle or loading (nothing settled yet).
    var isLoading: Bool {
        switch self {
        case .idle, .loading: true
        case .loaded, .empty, .failed: false
        }
    }

    /// The failure message, if the load failed.
    var errorMessage: String? {
        if case .failed(let message) = self { return message }
        return nil
    }

    /// Maps a loaded value, preserving every other state.
    func map<T>(_ transform: (Value) throws -> T) rethrows -> LoadState<T> {
        switch self {
        case .idle: return .idle
        case .loading: return .loading
        case .loaded(let value): return try .loaded(transform(value))
        case .empty: return .empty
        case .failed(let message): return .failed(message: message)
        }
    }
}
