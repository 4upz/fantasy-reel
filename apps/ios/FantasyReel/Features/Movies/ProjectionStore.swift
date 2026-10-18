import FantasyReelAPI
import FantasyReelCore
import Observation
import SwiftUI

extension EnvironmentValues {
    /// The open season's projected scores (Beta, F-19). Nil outside a league
    /// (the global Movies tab, the menu sheet), where nothing is projected.
    @Entry var projectionStore: ProjectionStore? = nil
}

/// Projected scores (Beta, F-19) for one season, shared by every surface,
/// ported from the web's `utils/projectionStore.ts`.
///
/// It says nothing until `get-movie-projections` answers `enabled: true`. A
/// league the server keeps off, an error, or a request still in flight all
/// read as "no projections", so with the feature off every screen renders
/// exactly what it did before projections existed. A season that answers off
/// (or fails its first request) is never asked again; `LeagueSeasonStore`
/// owns this store and is rebuilt per season.
@Observable
@MainActor
final class ProjectionStore {
    enum Status: Equatable {
        case unknown, enabled, disabled
    }

    /// `get-movie-projections` takes 1–100 ids per call.
    static let batchSize = 100

    private(set) var status: Status
    /// Projections the server has. Movies it answered null for are in
    /// `answered` but not here.
    private(set) var projections: [TMDbID: MovieProjection] = [:]
    /// Every id the server has answered for, null or not.
    private(set) var answered: Set<TMDbID> = []
    /// Bumps on every change, for callers that cache derived tables.
    private(set) var version = 0
    /// Our `movies.id` → TMDb id for the season's held movies, so rows that
    /// carry only ours (counterpick choices, trade items) can look theirs up.
    private(set) var tmdbIDsByMovie: [MovieID: TMDbID] = [:]

    @ObservationIgnored private var pending: Set<TMDbID> = []
    @ObservationIgnored private var inFlight: Set<TMDbID> = []
    /// The first request decides whether the league has projections at all.
    @ObservationIgnored private var probing = false
    @ObservationIgnored private var flushScheduled = false

    private let leagueID: LeagueID
    private let repository: any MovieRepository

    /// Projections are for movies still to be decided: a completed season
    /// shows none and asks for none.
    init(leagueID: LeagueID, seasonIsLive: Bool, repository: any MovieRepository) {
        self.leagueID = leagueID
        self.repository = repository
        self.status = seasonIsLive ? .unknown : .disabled
    }

    var isEnabled: Bool { status == .enabled }

    /// The movie's projection, or nil when there is none to show.
    func projection(for tmdbID: TMDbID?) -> MovieProjection? {
        guard status == .enabled, let tmdbID else { return nil }
        return projections[tmdbID]
    }

    /// The projection for a movie by our id, once the season has said which
    /// TMDb movie it is.
    func projection(forMovie movieID: MovieID) -> MovieProjection? {
        projection(for: tmdbIDsByMovie[movieID])
    }

    /// Records which TMDb movie each held movie is (a movie's TMDb id never
    /// changes) and asks for their projections.
    func learn(_ pairs: [(MovieID, TMDbID)]) {
        var known = tmdbIDsByMovie
        for (movieID, tmdbID) in pairs { known[movieID] = tmdbID }
        if known != tmdbIDsByMovie { tmdbIDsByMovie = known }
        request(pairs.map(\.1))
    }

    /// Whether every one of these movies has an answer, so a total built from
    /// them won't move part-way.
    func hasAnswers(for tmdbIDs: some Sequence<TMDbID>) -> Bool {
        status == .enabled && tmdbIDs.allSatisfy(answered.contains)
    }

    /// The season finished: hide everything for the rest of its life.
    func seasonEnded() {
        guard status != .disabled else { return }
        disable()
        version += 1
    }

    /// Asks for any of these movies not already answered or on the way. Ids
    /// asked for in the same main-actor turn go out as one request.
    func request(_ tmdbIDs: some Sequence<TMDbID>) {
        guard status != .disabled else { return }
        for id in tmdbIDs where id.rawValue > 0 && !answered.contains(id) {
            pending.insert(id)
        }
        scheduleFlush()
    }

    private func scheduleFlush() {
        guard !flushScheduled, !pending.isEmpty else { return }
        flushScheduled = true
        Task { [weak self] in
            await Task.yield()
            self?.flush()
        }
    }

    private func flush() {
        flushScheduled = false
        guard status != .disabled else {
            pending.removeAll()
            return
        }
        guard !probing else { return }
        let missing = pending.filter { !answered.contains($0) && !inFlight.contains($0) }.sorted { $0.rawValue < $1.rawValue }
        pending.removeAll()
        guard !missing.isEmpty else { return }
        if status == .unknown {
            // A league that answers off never sees a second request.
            probing = true
            pending.formUnion(missing.dropFirst(Self.batchSize))
            load(Array(missing.prefix(Self.batchSize)))
            return
        }
        for start in stride(from: 0, to: missing.count, by: Self.batchSize) {
            load(Array(missing[start..<min(start + Self.batchSize, missing.count)]))
        }
    }

    private func load(_ ids: [TMDbID]) {
        inFlight.formUnion(ids)
        let repository = repository
        let leagueID = leagueID
        Task { [weak self] in
            let result: Result<MovieProjectionsResponse, APIError>
            do throws(APIError) {
                result = .success(try await repository.projections(league: leagueID, tmdbIDs: ids))
            } catch {
                result = .failure(error)
            }
            self?.settle(ids, result)
        }
    }

    private func settle(_ ids: [TMDbID], _ result: Result<MovieProjectionsResponse, APIError>) {
        inFlight.subtract(ids)
        probing = false
        defer {
            version += 1
            scheduleFlush()
        }
        guard status != .disabled else { return }
        switch result {
        case .success(.enabled(_, let loaded)):
            status = .enabled
            answered.formUnion(ids)
            for id in ids { projections[id] = loaded[id] }
        case .success(.disabled):
            disable()
        case .failure:
            if status == .unknown {
                // The first request failed: stay dark for this season.
                disable()
            } else {
                // A later batch failing settles its ids as "no projection"
                // rather than retrying on every render.
                answered.formUnion(ids)
            }
        }
    }

    private func disable() {
        status = .disabled
        projections.removeAll()
        answered.removeAll()
        pending.removeAll()
    }
}
