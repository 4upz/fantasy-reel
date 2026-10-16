import FantasyReelAPI
import Foundation
import Observation

/// The native `useAsyncAction`: protects a server call from double taps and
/// keeps its error visible inline (N-04, CLAUDE.md "Double-Click Protection").
///
/// Because this is `@MainActor`, the "already running?" check and the flag
/// write happen with no suspension in between, so a second tap that lands
/// before SwiftUI re-renders the disabled button is still ignored.
///
/// ```swift
/// @State private var save = AsyncAction()
///
/// Button("Save") {
///     save.run { try await model.save() }
/// }
/// .disabled(save.isRunning)
/// if let message = save.errorMessage { InlineError(message) }
/// ```
@Observable
@MainActor
final class AsyncAction {
    private(set) var isRunning = false
    private(set) var errorMessage: String?
    /// The last failure, for callers that branch on it (rate limits, uncertain results).
    private(set) var lastError: APIError?

    /// Starts `operation` unless one is already running. Returns immediately.
    func run(_ operation: @escaping @MainActor () async throws -> Void) {
        guard !isRunning else { return }
        isRunning = true
        errorMessage = nil
        lastError = nil
        Task { @MainActor in
            await self.perform(operation)
        }
    }

    /// Awaitable form, for callers that need to continue after the operation.
    /// Returns false when it was skipped (already running) or failed.
    @discardableResult
    func runAndWait(_ operation: @MainActor () async throws -> Void) async -> Bool {
        guard !isRunning else { return false }
        isRunning = true
        errorMessage = nil
        lastError = nil
        return await perform(operation)
    }

    func clearError() {
        errorMessage = nil
        lastError = nil
    }

    @discardableResult
    private func perform(_ operation: @MainActor () async throws -> Void) async -> Bool {
        defer { isRunning = false }
        do {
            try await operation()
            return true
        } catch is CancellationError {
            return false
        } catch {
            let apiError = APIError.wrap(error)
            // The screen went away mid-call; nobody is left to show an error to.
            if apiError.isCancellation { return false }
            lastError = apiError
            // For an uncertain result (timeout, dropped connection) the message
            // already says to check the latest state; the screen should refresh
            // before re-enabling the action (`lastError?.isUncertainOutcome`).
            errorMessage = apiError.userMessage
            return false
        }
    }
}
