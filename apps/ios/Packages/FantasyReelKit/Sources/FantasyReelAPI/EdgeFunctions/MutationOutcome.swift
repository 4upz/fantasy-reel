import Foundation

/// The three ways a mutation can end, as a screen must treat them (N-04).
///
/// `uncertain` is the one that matters: the request timed out or the
/// connection dropped after it may have reached the server, so the screen
/// re-reads state before offering a retry and never resubmits on its own.
public enum MutationOutcome<Value: Sendable>: Sendable {
    case succeeded(Value)
    /// The server may have acted. Reconcile before letting the person retry.
    case uncertain(APIError)
    /// The server refused, or the request never left the device.
    case failed(APIError)

    /// Runs `operation` once (never retried) and classifies how it ended.
    /// Runs on the caller's actor, so a view model can pass a closure that
    /// touches its own state.
    public static func of(
        isolation: isolated (any Actor)? = #isolation,
        _ operation: () async throws(APIError) -> Value
    ) async -> MutationOutcome<Value> {
        do {
            return .succeeded(try await operation())
        } catch {
            return error.isUncertainOutcome ? .uncertain(error) : .failed(error)
        }
    }

    public var value: Value? {
        if case .succeeded(let value) = self { return value }
        return nil
    }

    public var error: APIError? {
        switch self {
        case .succeeded: nil
        case .uncertain(let error), .failed(let error): error
        }
    }

    public var isUncertain: Bool {
        if case .uncertain = self { return true }
        return false
    }
}
