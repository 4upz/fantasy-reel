import Foundation

/// The words the auth screens show, matching the web app so a person sees the
/// same sentence on either (F-02, N-03). Sources: `apps/frontend/utils/password.ts`,
/// `utils/captcha.ts`, `components/auth/Turnstile.tsx` and the server actions
/// under `app/(public)/`.
public enum AuthMessages {
    /// Supabase enforces the same minimum server-side; this only answers sooner.
    /// It applies when a password is set, never at sign-in, so accounts created
    /// under the old 6-character minimum still sign in.
    public static let minimumPasswordLength = 8

    public static let passwordTooShort = "Password must be at least \(minimumPasswordLength) characters"
    public static let passwordBreached = "This password has appeared in a data breach. Please choose a different one."
    public static let reauthenticationNeeded = "For your security, please sign out and sign back in, then try again."
    public static let passwordsDoNotMatch = "Passwords do not match"
    public static let samePassword = "New password must be different from your current password"
    public static let passwordUpdateFailed = "Failed to update password. Please try again."
    public static let invalidCredentials = "Invalid email or password"
    public static let emailNotConfirmed = "Please confirm your email address before signing in"
    public static let accountExists = "An account with this email already exists"
    public static let invalidEmail = "Please enter a valid email address"
    public static let emailRateLimited = "Please wait a minute before requesting another email"
    public static let tooManyAttempts = "Too many attempts. Please wait a minute and try again."
    public static let captchaFailed = "The security check expired or failed. Please complete it and try again."
    /// Shown when a form is submitted before the security check has issued a token.
    public static let captchaPending = "Complete the security check, then try again."

    /// What the person was doing, which decides a few fallbacks.
    public enum Context: Sendable {
        case signIn
        case signUp
        /// Choosing a new password (recovery, or changing it in Account).
        case setPassword
        /// Reset or resend: the answer must never reveal whether an account exists.
        case emailRequest
    }

    /// The machine-readable codes the screens branch on.
    public enum Code {
        public static let captchaFailed = "captcha_failed"
        public static let emailNotConfirmed = "email_not_confirmed"
        public static let weakPassword = "weak_password"
    }

    /// The person-facing message for a Supabase Auth error, or nil when the
    /// server's own message should be shown as is.
    public static func message(code: String?, serverMessage: String, reasons: [String] = [], context: Context) -> String? {
        let lowered = serverMessage.lowercased()
        if isCaptchaFailure(code: code, serverMessage: serverMessage) {
            return captchaFailed
        }
        if isRateLimited(code: code, serverMessage: serverMessage) {
            return context == .emailRequest ? emailRateLimited : tooManyAttempts
        }
        switch code {
        case "weak_password":
            return reasons.contains("pwned") ? passwordBreached : passwordTooShort
        case "reauthentication_needed":
            return reauthenticationNeeded
        case "same_password":
            return samePassword
        case "invalid_credentials":
            return invalidCredentials
        case "email_not_confirmed":
            return emailNotConfirmed
        case "user_already_exists", "email_exists":
            return accountExists
        default:
            break
        }
        // Older servers send no code; match the messages the web matches.
        if lowered.contains("invalid login credentials") { return invalidCredentials }
        if lowered.contains("email not confirmed") { return emailNotConfirmed }
        if lowered.contains("already registered") { return accountExists }
        if lowered.contains("should be different") { return samePassword }
        if context == .setPassword { return passwordUpdateFailed }
        return nil
    }

    /// True when Supabase rejected the request's CAPTCHA token. Nothing was
    /// sent, so a reset or resend must not report "email sent".
    public static func isCaptchaFailure(code: String?, serverMessage: String) -> Bool {
        code == Code.captchaFailed || serverMessage.lowercased().hasPrefix("captcha protection")
    }

    public static func isRateLimited(code: String?, serverMessage: String) -> Bool {
        if let code, code.hasPrefix("over_"), code.hasSuffix("_rate_limit") { return true }
        let lowered = serverMessage.lowercased()
        return lowered.contains("rate limit") || lowered.contains("60 seconds") || lowered.contains("for security purposes")
    }

    /// A light format check before the round trip, as the web does.
    public static func looksLikeEmail(_ email: String) -> Bool {
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let at = trimmed.firstIndex(of: "@") else { return false }
        return at != trimmed.startIndex && trimmed.index(after: at) != trimmed.endIndex
    }

    /// Checks a new password and its confirmation the way the web forms do:
    /// matching first, then length. Nil when both pass.
    public static func newPasswordProblem(_ password: String, confirmation: String) -> String? {
        if password != confirmation { return passwordsDoNotMatch }
        if password.count < minimumPasswordLength { return passwordTooShort }
        return nil
    }
}

/// Why an incoming `fantasyreel://auth/callback` link didn't sign this iPhone in,
/// worded like the web's login notices (F-02).
public enum AuthLinkFailure: Sendable, Equatable {
    /// The link was used already or is too old.
    case expired
    /// The link was requested somewhere else (or before a reinstall), so this
    /// app holds no PKCE verifier. A confirmation link still confirmed the email.
    case openedElsewhere
    /// The provider or Supabase reported an error (cancelled consent, bad config).
    case failed

    /// Reads the error Supabase put on the callback URL (`error_code`, in the
    /// query or the fragment), else the error from exchanging its code. A code
    /// that fails to exchange for any other reason is what a link requested
    /// elsewhere looks like: this app holds no PKCE verifier for it.
    public static func classify(_ url: URL, exchangeErrorCode: String? = nil) -> AuthLinkFailure {
        let params = callbackParameters(url)
        if let code = params["error_code"] ?? params["error"] {
            return code == "otp_expired" ? .expired : .failed
        }
        guard params["code"] != nil else { return .failed }
        return exchangeErrorCode == "flow_state_expired" ? .expired : .openedElsewhere
    }

    /// The notice for the sign-in (or reset) screen.
    public func message(isRecovery: Bool) -> String {
        switch (self, isRecovery) {
        case (.expired, true):
            return "That reset link has expired or was already used. Send yourself a new one."
        case (.openedElsewhere, true):
            return "Reset links only work on the device that asked for them. Send a new link from this iPhone."
        case (.expired, false):
            return "That link has expired or was already used. If it was a confirmation link, sign in to get a new one."
        case (.openedElsewhere, false):
            return "We couldn't finish signing you in. If you opened a confirmation email that was requested somewhere else, your email is still confirmed, so sign in below."
        case (.failed, true):
            return "That reset link didn't work. Send yourself a new one."
        case (.failed, false):
            return "Sign-in didn't finish. Please try again."
        }
    }

    static func callbackParameters(_ url: URL) -> [String: String] {
        var result: [String: String] = [:]
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        for item in components?.queryItems ?? [] {
            if let value = item.value { result[item.name] = value }
        }
        if let fragment = components?.fragment {
            var fragmentComponents = URLComponents()
            fragmentComponents.query = fragment
            for item in fragmentComponents.queryItems ?? [] {
                if let value = item.value { result[item.name] = value }
            }
        }
        return result
    }
}
