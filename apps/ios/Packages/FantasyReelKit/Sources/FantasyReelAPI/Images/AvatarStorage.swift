import FantasyReelCore
import Foundation
import Supabase

/// The two public photo buckets. Each owner (a user, or a team) has exactly
/// one object, `<ownerID>/avatar`; the storage policies reject any other name,
/// so an upload replaces the previous photo instead of adding a file.
public enum AvatarBucket: String, Sendable {
    /// Profile photos; the folder is the user ID.
    case profiles = "avatars"
    /// Team photos; the folder is the team ID.
    case teams = "team-avatars"
}

/// Uploads and removes profile and team photos (F-03, F-10, N-09). Shared by
/// the Account screen and team editing so both store photos the same way.
///
/// The URLs are public, so never describe them as private uploads.
public protocol AvatarStorage: Sendable {
    /// Uploads a prepared photo over `<folder>/avatar` and returns its public
    /// URL with a `v` query parameter, so caches don't keep the photo it replaced.
    func upload(_ image: AvatarImage.Prepared, to bucket: AvatarBucket, folder: String) async throws(APIError) -> String

    /// Deletes the owner's stored files, optionally keeping the current
    /// `avatar` object (which also clears files older uploads left behind).
    /// Best effort: a failure leaves files behind but never fails the caller.
    func removeFiles(in bucket: AvatarBucket, folder: String, keepCurrent: Bool) async
}

public struct SupabaseAvatarStorage: AvatarStorage {
    static let objectName = "avatar"
    private let client: SupabaseClient

    public init(provider: SupabaseProvider) {
        self.client = provider.client
    }

    public func upload(_ image: AvatarImage.Prepared, to bucket: AvatarBucket, folder: String) async throws(APIError) -> String {
        let path = "\(folder)/\(Self.objectName)"
        let files = client.storage.from(bucket.rawValue)
        do {
            _ = try await files.upload(path, data: image.data, options: FileOptions(contentType: image.contentType, upsert: true))
            let publicURL = try files.getPublicURL(path: path)
            return Self.versioned(publicURL, at: Date())
        } catch {
            throw APIError.wrap(error)
        }
    }

    public func removeFiles(in bucket: AvatarBucket, folder: String, keepCurrent: Bool) async {
        let files = client.storage.from(bucket.rawValue)
        guard let stored = try? await files.list(path: folder) else { return }
        let stale = stored
            .filter { !(keepCurrent && $0.name == Self.objectName) }
            .map { "\(folder)/\($0.name)" }
        guard !stale.isEmpty else { return }
        _ = try? await files.remove(paths: stale)
    }

    /// The public URL plus `?v=<milliseconds>`, matching the web's cache buster.
    static func versioned(_ url: URL, at date: Date) -> String {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let stamp = String(Int64((date.timeIntervalSince1970 * 1000).rounded()))
        components?.queryItems = (components?.queryItems ?? []).filter { $0.name != "v" } + [URLQueryItem(name: "v", value: stamp)]
        return components?.url?.absoluteString ?? url.absoluteString
    }
}
