import FantasyReelCore
import Foundation
import Supabase

/// The restricted growth dashboard (F-18).
public protocol AdminRepository: Sendable {
    /// The stats, or nil when this account isn't an app administrator (the
    /// RPC refuses with 42501). Other failures throw.
    func fetchGrowthStats() async throws(APIError) -> GrowthStats?
}

public struct SupabaseAdminRepository: AdminRepository {
    private let client: SupabaseClient

    public init(provider: SupabaseProvider) {
        self.client = provider.client
    }

    public func fetchGrowthStats() async throws(APIError) -> GrowthStats? {
        do {
            return try await client.rpc("admin_growth_stats").execute().value
        } catch {
            let wrapped = APIError.wrap(error)
            if wrapped.serverCode == "42501" { return nil }
            throw wrapped
        }
    }
}
