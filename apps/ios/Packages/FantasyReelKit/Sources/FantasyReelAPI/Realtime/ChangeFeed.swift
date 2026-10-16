import Foundation
import Supabase

/// Realtime as an invalidation signal (requirements N-05).
///
/// Postgres change messages are not a replayable history: a socket can drop,
/// iOS can suspend the app, and messages can arrive out of order. So this never
/// hands out row payloads. It yields a bare signal, once right after the
/// subscription is established and again whenever a watched table changes, and
/// the caller re-reads a coherent state each time. Pair it with
/// `.refreshOnForeground` in the app, because no events arrive while suspended.
///
/// ```swift
/// for await _ in env.changeFeed.signals(
///     topic: "draft",
///     watching: [.init(table: "draft_picks", filter: .equals("league_id", leagueID.rawValue))]
/// ) {
///     await model.reload()
/// }
/// ```
public struct ChangeFeed: Sendable {
    public struct Watch: Sendable, Hashable {
        public enum Filter: Sendable, Hashable {
            case equals(_ column: String, _ value: String)

            var postgrestFilter: String {
                switch self {
                case .equals(let column, let value): return "\(column)=eq.\(value)"
                }
            }
        }

        public let table: String
        public let filter: Filter?

        public init(table: String, filter: Filter? = nil) {
            self.table = table
            self.filter = filter
        }
    }

    private let client: SupabaseClient

    public init(provider: SupabaseProvider) {
        self.client = provider.client
    }

    /// Signals until the consuming task is cancelled (e.g. the view disappears).
    ///
    /// Each call opens its own channel with a unique topic: the web found that
    /// reusing a topic across remounts races the SDK's asynchronous cleanup.
    public func signals(topic: String, watching watches: [Watch]) -> AsyncStream<Void> {
        let client = self.client
        return AsyncStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
            let channel = client.channel("\(topic):\(UUID().uuidString.lowercased())")
            let streams = watches.map { watch in
                channel.postgresChange(
                    AnyAction.self,
                    schema: "public",
                    table: watch.table,
                    filter: watch.filter?.postgrestFilter
                )
            }

            let task = Task {
                await channel.subscribe()
                // Subscribe first, then read: anything that changed while the
                // channel was joining is covered by this initial refresh.
                continuation.yield()
                await withTaskGroup(of: Void.self) { group in
                    for stream in streams {
                        group.addTask {
                            for await _ in stream { continuation.yield() }
                        }
                    }
                }
                continuation.finish()
            }

            continuation.onTermination = { _ in
                task.cancel()
                Task { await client.removeChannel(channel) }
            }
        }
    }
}
