import Foundation
import Testing
@testable import FantasyReelAPI

/// The auth screens must say what the web says (apps/frontend/utils/password.ts,
/// utils/captcha.ts and the (public) server actions).
struct AuthMessagesTests {
    @Test func weakPasswordIsTooShortUnlessBreached() {
        #expect(AuthMessages.message(code: "weak_password", serverMessage: "x", context: .signUp)
            == "Password must be at least 8 characters")
        #expect(AuthMessages.message(code: "weak_password", serverMessage: "x", reasons: ["length", "pwned"], context: .setPassword)
            == "This password has appeared in a data breach. Please choose a different one.")
    }

    @Test func reauthenticationAndSamePassword() {
        #expect(AuthMessages.message(code: "reauthentication_needed", serverMessage: "", context: .setPassword)
            == "For your security, please sign out and sign back in, then try again.")
        #expect(AuthMessages.message(code: nil, serverMessage: "New password should be different from the old password.", context: .setPassword)
            == "New password must be different from your current password")
    }

    @Test func signInErrorsMatchTheWeb() {
        #expect(AuthMessages.message(code: "invalid_credentials", serverMessage: "Invalid login credentials", context: .signIn)
            == "Invalid email or password")
        #expect(AuthMessages.message(code: nil, serverMessage: "Invalid login credentials", context: .signIn)
            == "Invalid email or password")
        #expect(AuthMessages.message(code: "email_not_confirmed", serverMessage: "Email not confirmed", context: .signIn)
            == "Please confirm your email address before signing in")
    }

    @Test func signUpDuplicateEmail() {
        #expect(AuthMessages.message(code: "user_already_exists", serverMessage: "User already registered", context: .signUp)
            == "An account with this email already exists")
    }

    @Test func captchaFailureIsNeverEmailSent() {
        #expect(AuthMessages.message(code: "captcha_failed", serverMessage: "", context: .emailRequest) == AuthMessages.captchaFailed)
        #expect(AuthMessages.message(code: nil, serverMessage: "captcha protection: request disallowed", context: .signIn) == AuthMessages.captchaFailed)
    }

    @Test func rateLimitsDependOnContext() {
        #expect(AuthMessages.message(code: "over_email_send_rate_limit", serverMessage: "", context: .emailRequest)
            == "Please wait a minute before requesting another email")
        #expect(AuthMessages.message(code: nil, serverMessage: "For security purposes, you can only request this after 42 seconds.", context: .emailRequest)
            == "Please wait a minute before requesting another email")
        #expect(AuthMessages.message(code: "over_request_rate_limit", serverMessage: "", context: .signIn) == AuthMessages.tooManyAttempts)
    }

    @Test func unknownErrorsKeepTheServerMessageExceptWhenSettingAPassword() {
        #expect(AuthMessages.message(code: "unexpected_failure", serverMessage: "Boom", context: .signIn) == nil)
        #expect(AuthMessages.message(code: "unexpected_failure", serverMessage: "Boom", context: .setPassword)
            == "Failed to update password. Please try again.")
    }

    @Test func newPasswordChecksMatchingBeforeLength() {
        #expect(AuthMessages.newPasswordProblem("short", confirmation: "other") == "Passwords do not match")
        #expect(AuthMessages.newPasswordProblem("short", confirmation: "short") == "Password must be at least 8 characters")
        #expect(AuthMessages.newPasswordProblem("longenough", confirmation: "longenough") == nil)
    }

    @Test func emailShapeCheck() {
        #expect(AuthMessages.looksLikeEmail(" alice@fantasyreel.test "))
        #expect(!AuthMessages.looksLikeEmail("alice"))
        #expect(!AuthMessages.looksLikeEmail("@fantasyreel.test"))
        #expect(!AuthMessages.looksLikeEmail("alice@"))
    }
}

struct AuthLinkFailureTests {
    private func url(_ string: String) throws -> URL {
        try #require(URL(string: string))
    }

    @Test func expiredLinkFromQueryOrFragment() throws {
        #expect(AuthLinkFailure.classify(try url("fantasyreel://auth/callback?error=access_denied&error_code=otp_expired")) == .expired)
        #expect(AuthLinkFailure.classify(try url("fantasyreel://auth/callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid")) == .expired)
    }

    @Test func otherProviderErrorsFail() throws {
        #expect(AuthLinkFailure.classify(try url("fantasyreel://auth/callback?error=server_error&error_description=Unable")) == .failed)
        #expect(AuthLinkFailure.classify(try url("fantasyreel://auth/callback")) == .failed)
    }

    @Test func aCodeThatWontExchangeWasOpenedElsewhere() throws {
        let link = try url("fantasyreel://auth/callback?code=abc")
        #expect(AuthLinkFailure.classify(link) == .openedElsewhere)
        #expect(AuthLinkFailure.classify(link, exchangeErrorCode: "flow_state_not_found") == .openedElsewhere)
        #expect(AuthLinkFailure.classify(link, exchangeErrorCode: "flow_state_expired") == .expired)
    }

    @Test func noticesMatchTheWebForConfirmationLinks() {
        #expect(AuthLinkFailure.openedElsewhere.message(isRecovery: false).contains("your email is still confirmed"))
        #expect(AuthLinkFailure.openedElsewhere.message(isRecovery: true).contains("only work on the device that asked"))
    }
}

struct TurnstileConfigurationTests {
    private let base: [String: Any] = [
        "FRSupabaseURL": "http://127.0.0.1:54321",
        "FRSupabaseAnonKey": "anon",
        "FRSiteURL": "https://fantasyreel.com",
        "FRURLScheme": "fantasyreel",
    ]

    @Test func emptyOrMissingSiteKeyTurnsTheCheckOff() throws {
        #expect(try AppConfiguration.load(from: base).turnstileSiteKey == nil)
        var info = base
        info["FRTurnstileSiteKey"] = ""
        #expect(try AppConfiguration.load(from: info).turnstileSiteKey == nil)
    }

    @Test func siteKeyIsRead() throws {
        var info = base
        info["FRTurnstileSiteKey"] = "0x4AAAAAAA"
        #expect(try AppConfiguration.load(from: info).turnstileSiteKey == "0x4AAAAAAA")
    }

    @Test func placeholderSiteKeyIsRejected() {
        var info = base
        info["FRTurnstileSiteKey"] = "REPLACE_WITH_TURNSTILE_SITE_KEY"
        #expect(throws: AppConfiguration.LoadError.placeholder(key: "FRTurnstileSiteKey")) {
            try AppConfiguration.load(from: info)
        }
    }
}

struct AppleRelayAccountTests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    @Test func newAppleOnlyRelayAccountIsFlagged() {
        #expect(AuthService.isNewRelayAccount(email: "x7k2@privaterelay.appleid.com", providers: ["apple"], createdAt: now.addingTimeInterval(-5), now: now))
    }

    @Test func realEmailLinkedOrOlderAccountsAreNot() {
        #expect(!AuthService.isNewRelayAccount(email: "alice@fantasyreel.test", providers: ["apple"], createdAt: now, now: now))
        #expect(!AuthService.isNewRelayAccount(email: "x7k2@privaterelay.appleid.com", providers: ["apple", "google"], createdAt: now, now: now))
        #expect(!AuthService.isNewRelayAccount(email: "x7k2@privaterelay.appleid.com", providers: ["apple"], createdAt: now.addingTimeInterval(-86_400), now: now))
    }
}
