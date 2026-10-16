import FantasyReelCore
import Foundation
import Supabase

/// Everything that can go wrong talking to the backend, in the shape screens
/// need to react to it (requirements N-04).
///
/// The important distinction is `isUncertainOutcome`: a timeout or a connection
/// dropped mid-request does **not** mean the server rolled back. Mutation screens
/// must re-read state before offering a retry, never resubmit blindly.
public enum APIError: Error, Sendable, Equatable {
    /// No signed-in session to attach. The caller should route to sign-in.
    case notSignedIn
    /// The request ran past its deadline. The server may or may not have acted.
    case timedOut(requestID: String)
    /// Transport failure. `code` tells whether the request could have reached the server.
    case network(code: URLError.Code, requestID: String)
    /// 429 from a per-user throttle. Show `message` and keep the action disabled
    /// until `retryAfter`; never auto-retry a mutation.
    case rateLimited(message: String, retryAfter: Duration?, requestID: String?)
    /// Any other non-2xx response, or a PostgREST/Auth error.
    case server(ServerError)
    /// 2xx, but the body didn't match the expected shape. The action *did* run.
    case unexpectedResponse(message: String, requestID: String?)

    /// A non-2xx response with the server's own explanation.
    public struct ServerError: Sendable, Equatable {
        /// HTTP status; nil for SDK errors that don't carry one.
        public let status: Int?
        /// The server's message (`error` field), ready to show the user.
        public let message: String
        /// A machine-readable code when the endpoint sends one
        /// (`reauth_required`, `live_draft`, a Postgres error code, …).
        public let code: String?
        /// The whole JSON body, for endpoints that send more than a message
        /// (`invalid_source_ids`, `leagues`, conflict metadata).
        public let body: JSONValue?
        /// Echoed `X-Request-Id`, quoted to support for unexpected failures.
        public let requestID: String?

        public init(status: Int?, message: String, code: String? = nil, body: JSONValue? = nil, requestID: String? = nil) {
            self.status = status
            self.message = message
            self.code = code
            self.body = body
            self.requestID = requestID
        }
    }

    /// Text to show the user. Server messages are already written for people.
    public var userMessage: String {
        switch self {
        case .notSignedIn:
            return "Your session has ended. Sign in again to continue."
        case .timedOut:
            return "The request took too long. Check the latest state before trying again."
        case .network(let code, _):
            switch code {
            case .notConnectedToInternet, .dataNotAllowed:
                return "You're offline. Connect to the internet and try again."
            default:
                return "We couldn't reach Fantasy Reel. Check your connection and try again."
            }
        case .rateLimited(let message, _, _):
            return message
        case .server(let error):
            return error.message
        case .unexpectedResponse:
            return "Something went wrong reading the response. Refresh to see the latest state."
        }
    }

    /// True when the server may have completed the action even though we saw an
    /// error. Screens refresh before re-enabling a mutation in this case.
    public var isUncertainOutcome: Bool {
        switch self {
        case .timedOut, .unexpectedResponse:
            return true
        case .network(let code, _):
            // These mean the request never left the device.
            let neverSent: [URLError.Code] = [
                .notConnectedToInternet, .dataNotAllowed, .cannotFindHost,
                .cannotConnectToHost, .dnsLookupFailed, .appTransportSecurityRequiresSecureConnection,
                .secureConnectionFailed, .serverCertificateUntrusted,
            ]
            return !neverSent.contains(code)
        case .notSignedIn, .rateLimited, .server:
            return false
        }
    }

    /// The request ID to quote to support, when there is one.
    public var supportReference: String? {
        switch self {
        case .timedOut(let id), .network(_, let id):
            return id
        case .rateLimited(_, _, let id), .unexpectedResponse(_, let id):
            return id
        case .server(let error):
            return error.requestID
        case .notSignedIn:
            return nil
        }
    }

    /// The HTTP status, when the server answered.
    public var status: Int? {
        switch self {
        case .server(let error): return error.status
        case .rateLimited: return 429
        default: return nil
        }
    }

    /// The endpoint's machine-readable `code`, when it sent one.
    public var serverCode: String? {
        if case .server(let error) = self { return error.code }
        return nil
    }

    /// Rows a trade validator rejected (`invalid_source_ids`), so the composer can mark them.
    public var invalidSourceIDs: [String] {
        guard case .server(let error) = self,
              let ids = error.body?["invalid_source_ids"]?.arrayValue
        else { return [] }
        return ids.compactMap(\.stringValue)
    }
}

extension APIError: LocalizedError {
    public var errorDescription: String? { userMessage }
}

extension APIError {
    /// Wraps an error thrown by the Supabase SDK (PostgREST, Auth, Storage) so
    /// every screen handles one error type. Cancellation passes through
    /// unchanged; check for `CancellationError` before calling this.
    public static func wrap(_ error: any Error) -> APIError {
        if let apiError = error as? APIError { return apiError }
        if let urlError = error as? URLError {
            return .network(code: urlError.code, requestID: "")
        }
        if let postgrest = error as? PostgrestError {
            return .server(ServerError(status: nil, message: postgrest.message, code: postgrest.code))
        }
        if let auth = error as? AuthError {
            return .server(ServerError(status: nil, message: auth.message, code: auth.errorCode.rawValue))
        }
        let message = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
        return .server(ServerError(status: nil, message: message))
    }
}
