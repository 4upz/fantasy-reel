import FantasyReelCore
import Foundation
import os

/// The Swift counterpart of the web's `callEdgeFunction` (requirements N-04).
///
/// Every call:
/// - attaches the current session token and the public anon key;
/// - sends a fresh `x-request-id` so client logs line up with Edge Function logs,
///   and keeps the server's echoed `X-Request-Id` for support references;
/// - runs under one deadline covering token lookup, transport and decoding;
/// - turns any failure into an `APIError`, keeping the server's message, code
///   and full body (`warning`, `invalid_source_ids`, conflict metadata).
///
/// It never retries. Reads that are safe to retry are retried by their callers;
/// mutations are reconciled, not replayed.
public struct EdgeFunctionClient: Sendable {
    public typealias TokenProvider = @Sendable () async -> String?

    /// The web's draft deadline; most interactive calls use it.
    public static let defaultTimeout: Duration = .seconds(30)

    private let functionsURL: URL
    private let anonKey: String
    private let tokenProvider: TokenProvider
    private let session: URLSession
    private static let log = Logger(subsystem: "com.fantasyreel.ios", category: "edge-functions")

    public init(baseURL: URL, anonKey: String, session: URLSession = .shared, tokenProvider: @escaping TokenProvider) {
        self.functionsURL = baseURL.appending(path: "functions/v1")
        self.anonKey = anonKey
        self.session = session
        self.tokenProvider = tokenProvider
    }

    public init(provider: SupabaseProvider, session: URLSession = .shared) {
        self.init(
            baseURL: provider.configuration.supabaseURL,
            anonKey: provider.configuration.supabaseAnonKey,
            session: session,
            tokenProvider: { await provider.accessToken() }
        )
    }

    /// POSTs `body` as JSON to the named function and decodes the response.
    public func invoke<Body: Encodable & Sendable, Response: Decodable & Sendable>(
        _ function: String,
        body: Body,
        as responseType: Response.Type = Response.self,
        timeout: Duration = EdgeFunctionClient.defaultTimeout
    ) async throws(APIError) -> Response {
        let encoded: Data
        do {
            encoded = try FRJSON.makeEncoder().encode(body)
        } catch {
            // Programmer error (a non-encodable value); surface it rather than send garbage.
            throw .unexpectedResponse(message: "Could not encode the request: \(error)", requestID: nil)
        }
        return try await send(function, method: "POST", body: encoded, timeout: timeout)
    }

    /// Calls a function that takes no body (a GET, or a POST with nothing to send).
    public func invoke<Response: Decodable & Sendable>(
        _ function: String,
        method: String = "POST",
        as responseType: Response.Type = Response.self,
        timeout: Duration = EdgeFunctionClient.defaultTimeout
    ) async throws(APIError) -> Response {
        try await send(function, method: method, body: nil, timeout: timeout)
    }

    // MARK: - Transport

    private func send<Response: Decodable & Sendable>(
        _ function: String,
        method: String,
        body: Data?,
        timeout: Duration
    ) async throws(APIError) -> Response {
        let requestID = UUID().uuidString.lowercased()
        do {
            return try await withThrowingTaskGroup(of: Response.self) { group in
                group.addTask {
                    try await perform(function, method: method, body: body, requestID: requestID)
                }
                group.addTask {
                    try await Task.sleep(for: timeout)
                    throw APIError.timedOut(requestID: requestID)
                }
                defer { group.cancelAll() }
                guard let first = try await group.next() else {
                    throw APIError.timedOut(requestID: requestID)
                }
                return first
            }
        } catch let error as APIError {
            Self.log.error("\(function, privacy: .public) failed [request_id=\(requestID, privacy: .public)]: \(error.userMessage, privacy: .public)")
            throw error
        } catch is CancellationError {
            // The caller went away (view dismissed). Report it as a timeout-free
            // uncertain result rather than inventing a server answer.
            throw .network(code: .cancelled, requestID: requestID)
        } catch {
            throw .unexpectedResponse(message: String(describing: error), requestID: requestID)
        }
    }

    private func perform<Response: Decodable & Sendable>(
        _ function: String,
        method: String,
        body: Data?,
        requestID: String
    ) async throws -> Response {
        guard let token = await tokenProvider() else { throw APIError.notSignedIn }
        try Task.checkCancellation()

        var request = URLRequest(url: functionsURL.appending(path: function))
        request.httpMethod = method
        request.httpBody = body
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue(requestID, forHTTPHeaderField: "x-request-id")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let urlError as URLError {
            if urlError.code == .cancelled { throw CancellationError() }
            throw APIError.network(code: urlError.code, requestID: requestID)
        }

        let http = response as? HTTPURLResponse
        let status = http?.statusCode ?? 0
        let echoedID = http?.value(forHTTPHeaderField: "X-Request-Id") ?? requestID

        guard (200..<300).contains(status) else {
            throw Self.error(status: status, data: data, headers: http, requestID: echoedID)
        }

        do {
            if Response.self == EmptyResponse.self, data.isEmpty {
                // Force-cast is safe: the type check above proves the identity.
                return EmptyResponse() as! Response
            }
            return try FRJSON.makeDecoder().decode(Response.self, from: data)
        } catch {
            throw APIError.unexpectedResponse(
                message: "\(function) returned an unexpected response: \(error)",
                requestID: echoedID
            )
        }
    }

    /// Builds the `APIError` for a non-2xx response.
    static func error(status: Int, data: Data, headers: HTTPURLResponse?, requestID: String) -> APIError {
        let body = try? FRJSON.makeDecoder().decode(JSONValue.self, from: data)
        let message = body?["error"]?.stringValue
            ?? body?["message"]?.stringValue
            ?? HTTPURLResponse.localizedString(forStatusCode: status).capitalized

        if status == 429 {
            let seconds = body?["retry_after_seconds"]?.doubleValue
                ?? headers?.value(forHTTPHeaderField: "Retry-After").flatMap(Double.init)
            return .rateLimited(
                message: message,
                retryAfter: seconds.map { .milliseconds(Int64(($0 * 1000).rounded())) },
                requestID: requestID
            )
        }

        return .server(APIError.ServerError(
            status: status,
            message: message,
            code: body?["code"]?.stringValue,
            body: body,
            requestID: requestID
        ))
    }
}

/// Decode target for functions whose success body you don't need.
/// Accepts an empty body or any JSON value.
public struct EmptyResponse: Decodable, Sendable, Equatable {
    public init() {}
    public init(from decoder: any Decoder) throws {}
}
