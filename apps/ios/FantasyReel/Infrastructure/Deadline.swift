import FantasyReelAPI
import Foundation
import os

/// Runs `operation` under a deadline, returning or throwing whichever comes
/// first: its result, `APIError.timedOut` at the deadline, or the caller's
/// cancellation. Unlike a task group, it never waits for a loser that ignores
/// cancellation (the Supabase SDK's token refresh does), so a read can't
/// overrun its deadline. Used for the draft's 15 s refresh deadline.
func withDeadline<T: Sendable>(
    _ deadline: Duration,
    label: String,
    _ operation: @escaping @Sendable () async throws -> T
) async throws -> T {
    let race = DeadlineRace<T>()
    return try await withTaskCancellationHandler {
        try await withCheckedThrowingContinuation { continuation in
            race.install(continuation)
            race.track(Task {
                do {
                    race.finish(.success(try await operation()))
                } catch {
                    race.finish(.failure(error))
                }
            })
            race.track(Task {
                do {
                    try await Task.sleep(for: deadline)
                } catch {
                    return
                }
                race.finish(.failure(APIError.timedOut(requestID: label)))
            })
        }
    } onCancel: {
        race.finish(.failure(CancellationError()))
    }
}

/// Resumes one continuation exactly once with the first result, then cancels
/// the tasks still running.
private final class DeadlineRace<T: Sendable>: Sendable {
    private struct State {
        var continuation: CheckedContinuation<T, any Error>?
        var result: Result<T, any Error>?
        var tasks: [Task<Void, Never>] = []
    }

    private let state = OSAllocatedUnfairLock(initialState: State())

    func install(_ continuation: CheckedContinuation<T, any Error>) {
        let early: Result<T, any Error>? = state.withLock { state in
            if let result = state.result { return result }
            state.continuation = continuation
            return nil
        }
        if let early { continuation.resume(with: early) }
    }

    func track(_ task: Task<Void, Never>) {
        let finished = state.withLock { state in
            if state.result != nil { return true }
            state.tasks.append(task)
            return false
        }
        if finished { task.cancel() }
    }

    func finish(_ result: Result<T, any Error>) {
        let winner: (CheckedContinuation<T, any Error>?, [Task<Void, Never>])? = state.withLock { state in
            guard state.result == nil else { return nil }
            state.result = result
            defer {
                state.continuation = nil
                state.tasks = []
            }
            return (state.continuation, state.tasks)
        }
        guard let winner else { return }
        winner.1.forEach { $0.cancel() }
        winner.0?.resume(with: result)
    }
}
