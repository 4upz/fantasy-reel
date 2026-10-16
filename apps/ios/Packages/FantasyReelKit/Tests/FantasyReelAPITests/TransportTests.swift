import Foundation
import Testing
@testable import FantasyReelAPI

struct AppConfigurationTests {
    private let valid: [String: Any] = [
        "FRSupabaseURL": "http://127.0.0.1:54321",
        "FRSupabaseAnonKey": "anon",
        "FRSiteURL": "https://fantasyreel.com",
        "FRURLScheme": "fantasyreel",
    ]

    @Test func loadsValidConfiguration() throws {
        let config = try AppConfiguration.load(from: valid)
        #expect(config.supabaseURL.absoluteString == "http://127.0.0.1:54321")
        #expect(config.authCallbackURL.absoluteString == "fantasyreel://auth/callback")
        #expect(config.siteHosts == ["fantasyreel.com", "www.fantasyreel.com"])
    }

    @Test func recoveryCallbackIsMarked() throws {
        let config = try AppConfiguration.load(from: valid)
        #expect(config.recoveryCallbackURL.absoluteString == "fantasyreel://auth/callback?flow=recovery")
        let returned = try #require(URL(string: "fantasyreel://auth/callback?flow=recovery&code=abc"))
        #expect(AppConfiguration.isRecoveryCallback(returned))
        #expect(!AppConfiguration.isRecoveryCallback(config.authCallbackURL))
    }

    @Test func rejectsUnsubstitutedBuildSetting() {
        var info = valid
        info["FRSupabaseAnonKey"] = "$(SUPABASE_ANON_KEY)"
        #expect(throws: AppConfiguration.LoadError.missing(key: "FRSupabaseAnonKey")) {
            try AppConfiguration.load(from: info)
        }
    }

    @Test func rejectsPlaceholders() {
        var info = valid
        info["FRSupabaseURL"] = "https://YOUR-PROJECT.supabase.co"
        #expect(throws: AppConfiguration.LoadError.placeholder(key: "FRSupabaseURL")) {
            try AppConfiguration.load(from: info)
        }
    }
}

struct EdgeFunctionErrorTests {
    private func response(_ status: Int, headers: [String: String] = [:]) -> HTTPURLResponse {
        HTTPURLResponse(url: URL(string: "https://example.test")!, statusCode: status, httpVersion: nil, headerFields: headers)!
    }

    @Test func rateLimitUsesBodyRetryAfter() {
        let body = Data(#"{"error":"You're doing that too often. Please try again in 12 minutes.","retry_after_seconds":720}"#.utf8)
        let error = EdgeFunctionClient.error(status: 429, data: body, headers: response(429), requestID: "r1")
        #expect(error == .rateLimited(message: "You're doing that too often. Please try again in 12 minutes.", retryAfter: .seconds(720), requestID: "r1"))
        #expect(error.isUncertainOutcome == false)
    }

    @Test func rateLimitFallsBackToHeader() {
        let error = EdgeFunctionClient.error(status: 429, data: Data("{}".utf8), headers: response(429, headers: ["Retry-After": "30"]), requestID: "r2")
        guard case .rateLimited(_, let retryAfter, _) = error else {
            Issue.record("expected rate limit, got \(error)")
            return
        }
        #expect(retryAfter == .seconds(30))
    }

    @Test func serverErrorKeepsCodeAndInvalidSourceIDs() {
        let body = Data(#"{"error":"That movie is no longer on your roster.","code":"invalid_items","invalid_source_ids":["a","b"]}"#.utf8)
        let error = EdgeFunctionClient.error(status: 400, data: body, headers: response(400), requestID: "r3")
        #expect(error.userMessage == "That movie is no longer on your roster.")
        #expect(error.serverCode == "invalid_items")
        #expect(error.invalidSourceIDs == ["a", "b"])
        #expect(error.supportReference == "r3")
        #expect(error.status == 400)
    }

    @Test func nonJSONBodyFallsBackToStatusText() {
        let error = EdgeFunctionClient.error(status: 502, data: Data("<html>".utf8), headers: response(502), requestID: "r4")
        #expect(!error.userMessage.isEmpty)
        #expect(error.status == 502)
    }

    @Test func uncertainOutcomes() {
        #expect(APIError.timedOut(requestID: "x").isUncertainOutcome)
        #expect(APIError.network(code: .networkConnectionLost, requestID: "x").isUncertainOutcome)
        #expect(!APIError.network(code: .notConnectedToInternet, requestID: "x").isUncertainOutcome)
    }
}
