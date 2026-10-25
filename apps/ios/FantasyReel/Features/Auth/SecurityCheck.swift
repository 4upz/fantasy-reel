import FantasyReelAPI
import SwiftUI
import UIKit
import WebKit

/// The Cloudflare Turnstile token for one form (N-03), the native `useCaptcha`.
///
/// Production Supabase requires a token on sign-up, password sign-in, reset and
/// resend. The check runs out of sight (Turnstile's `interaction-only`
/// appearance): the widget appears only when Cloudflare wants the person to
/// interact, and otherwise the token arrives without anything on screen.
/// Each token is single-use and consumed even when the request fails, so
/// `take()` hands it over and starts a fresh challenge at the same time.
/// With no site key configured (local Supabase) the check is off: no widget
/// is drawn and `take()` returns nil, which Supabase accepts there.
@Observable
@MainActor
final class SecurityCheck {
    private(set) var token: String?
    /// Bumped to run a fresh challenge in the widget already on screen.
    private(set) var resets = 0
    /// Bumped to reload the widget from scratch (Try Again).
    private(set) var reloads = 0
    /// Cloudflare wants the person to interact, so the widget is on screen.
    fileprivate(set) var needsInteraction = false
    /// The challenge script couldn't load (offline, content blocker).
    fileprivate(set) var loadFailed = false

    /// How long a submit waits for a check still running out of sight.
    private static let tokenWait = Duration.seconds(10)
    private static let pollInterval = Duration.milliseconds(100)

    /// Waits briefly for a token when the check is still running out of
    /// sight, so a quick submit (AutoFill) doesn't fail for something the
    /// person can't see. Returns nil when the form may submit, otherwise the
    /// message to show. Call it inside the form's `AsyncAction`, so the
    /// button shows its loading state while it waits.
    func waitUntilReady(_ configuration: AppConfiguration) async throws -> String? {
        guard configuration.turnstileSiteKey != nil else { return nil }
        let deadline = ContinuousClock.now + Self.tokenWait
        while token == nil, !needsInteraction, !loadFailed, ContinuousClock.now < deadline {
            try await Task.sleep(for: Self.pollInterval)
        }
        if token != nil { return nil }
        return needsInteraction || loadFailed ? AuthMessages.captchaPending : AuthMessages.captchaSlow
    }

    /// The token for one request; the widget reloads for the next one.
    func take() -> String? {
        defer { reset() }
        return token
    }

    func reset() {
        token = nil
        needsInteraction = false
        if loadFailed {
            reload()
        } else {
            resets += 1
        }
    }

    func reload() {
        token = nil
        needsInteraction = false
        loadFailed = false
        reloads += 1
    }

    fileprivate func receive(_ token: String?) {
        self.token = token
        if token != nil { loadFailed = false }
    }
}

extension View {
    /// Puts the security check directly above this view (the form's submit
    /// button). It takes no space while the check runs out of sight, and
    /// appears with its own spacing only when Cloudflare wants interaction
    /// or the check couldn't load. Does nothing when the check is off.
    func securityCheck(_ check: SecurityCheck) -> some View {
        modifier(SecurityCheckPlacement(check: check))
    }
}

private struct SecurityCheckPlacement: ViewModifier {
    let check: SecurityCheck

    @Environment(AppEnvironment.self) private var environment

    func body(content: Content) -> some View {
        if environment.configuration.turnstileSiteKey != nil {
            VStack(spacing: check.needsInteraction || check.loadFailed ? FRMetrics.sectionSpacing : 0) {
                SecurityCheckView(check: check)
                content
            }
        } else {
            content
        }
    }
}

/// The Turnstile widget. It lives in a locked-down web view whose only job is
/// to produce the token: it loads one first-party page, allows no navigation
/// except Cloudflare's challenge frames, and opens any link (Cloudflare's
/// privacy and help pages) in Safari.
private struct SecurityCheckView: View {
    let check: SecurityCheck

    @Environment(AppEnvironment.self) private var environment
    @Environment(\.colorScheme) private var colorScheme
    /// False until the screen has finished sliding in. Creating a web view
    /// blocks the main thread, so doing it during the push makes the
    /// transition stutter.
    @State private var isMounted = false

    /// About the length of a navigation push.
    private static let mountDelay = Duration.milliseconds(400)
    /// Turnstile's flexible widget height.
    private static let widgetHeight: CGFloat = 65

    var body: some View {
        if let siteKey = environment.configuration.turnstileSiteKey {
            VStack(spacing: 6) {
                Group {
                    if isMounted {
                        TurnstileWebView(
                            siteKey: siteKey,
                            // The page's origin is the website's, which is the host the
                            // site key allows; nothing is fetched from it.
                            baseURL: environment.configuration.siteURL,
                            theme: colorScheme == .light ? "light" : "dark",
                            resets: check.resets,
                            reloads: check.reloads,
                            onEvent: handle
                        )
                    } else {
                        Color.clear
                    }
                }
                // The web view keeps its full size while hidden: clipping it,
                // rather than shrinking it, keeps WebKit from treating the
                // challenge as off screen and throttling it.
                .frame(height: Self.widgetHeight)
                .frame(maxWidth: .infinity)
                .frame(height: check.needsInteraction ? Self.widgetHeight : 0, alignment: .top)
                .clipped()
                .allowsHitTesting(check.needsInteraction)
                .accessibilityHidden(!check.needsInteraction)
                .task {
                    try? await Task.sleep(for: Self.mountDelay)
                    isMounted = true
                }
                if check.loadFailed {
                    Text("The security check couldn't load. Check your connection, then try again.")
                        .frFont(.meta)
                        .foregroundStyle(Color.frError)
                        .multilineTextAlignment(.center)
                    Button("Try Again") { check.reload() }
                        .buttonStyle(.fr(.secondary, size: .compact))
                }
            }
            .animation(.default, value: check.needsInteraction)
            // A theme change reloads the widget, so the token it gave is gone.
            .onChange(of: colorScheme) {
                check.receive(nil)
                check.needsInteraction = false
            }
        }
    }

    private func handle(_ event: TurnstileWebView.Event) {
        switch event {
        case .token(let token):
            if check.needsInteraction { Announcer.announce("Security check passed.") }
            check.receive(token)
        case .interactionRequired:
            check.needsInteraction = true
            Announcer.announce("Complete the security check.")
        case .expired, .failed:
            check.receive(nil)
        case .loadFailed:
            check.receive(nil)
            check.loadFailed = true
            Announcer.announce("The security check couldn't load.")
        }
    }
}

/// Starts WebKit's web content process ahead of the first security check.
/// The first web view in the app pays for launching that process; doing it
/// while Welcome is on screen keeps it out of the Log In and Sign Up pushes.
@MainActor
enum SecurityCheckPrewarm {
    private static var webView: WKWebView?

    /// Does nothing when the security check is off or already warmed.
    static func run(_ configuration: AppConfiguration) {
        guard configuration.turnstileSiteKey != nil, webView == nil else { return }
        let warm = TurnstileWebView.makeWebView()
        // Same origin as the real check, so WebKit reuses this process for it.
        warm.loadHTMLString("<!doctype html><html></html>", baseURL: configuration.siteURL)
        webView = warm
    }

    /// Releases the warm web view once nobody signed out needs it.
    static func release() {
        webView = nil
    }
}

private struct TurnstileWebView: UIViewRepresentable {
    enum Event: Equatable {
        case token(String)
        case interactionRequired, expired, failed, loadFailed
    }

    let siteKey: String
    let baseURL: URL
    let theme: String
    let resets: Int
    let reloads: Int
    let onEvent: @MainActor (Event) -> Void

    static let handlerName = "turnstile"
    static let challengeHost = "challenges.cloudflare.com"
    /// In memory only, so nothing from a challenge outlives the app session;
    /// shared so each form doesn't spin up its own web process storage.
    @MainActor private static let dataStore = WKWebsiteDataStore.nonPersistent()

    func makeCoordinator() -> Coordinator { Coordinator() }

    /// A web view sharing the check's in-memory data store, so the warm one
    /// and the real one run in the same web content process.
    @MainActor
    static func makeWebView(configure: (WKWebViewConfiguration) -> Void = { _ in }) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = dataStore
        configure(configuration)
        return WKWebView(frame: .zero, configuration: configuration)
    }

    func makeUIView(context: Context) -> WKWebView {
        let webView = Self.makeWebView { configuration in
            configuration.userContentController.add(context.coordinator, name: Self.handlerName)
        }
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        context.coordinator.onEvent = onEvent
        load(into: webView, coordinator: context.coordinator)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.onEvent = onEvent
        let coordinator = context.coordinator
        if coordinator.loadedPage != pageKey {
            load(into: webView, coordinator: coordinator)
        } else if coordinator.resets != resets {
            // A token was used: run a new challenge without reloading the page.
            coordinator.resets = resets
            webView.evaluateJavaScript("if (window.frWidget !== undefined) { turnstile.reset(window.frWidget) }")
        }
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: handlerName)
    }

    private var pageKey: String { "\(reloads)|\(theme)" }

    private func load(into webView: WKWebView, coordinator: Coordinator) {
        coordinator.loadedPage = pageKey
        coordinator.resets = resets
        coordinator.baseURL = baseURL
        webView.loadHTMLString(html, baseURL: baseURL)
    }

    private var html: String {
        // JSON-encode the values so nothing in them can break out of the script.
        let key = Self.jsString(siteKey)
        let theme = Self.jsString(theme)
        return """
        <!doctype html>
        <html><head>
        <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
        <style>html,body{margin:0;padding:0;background:transparent;display:flex;justify-content:center}</style>
        <script>
        function post(m){window.webkit.messageHandlers.\(Self.handlerName).postMessage(m)}
        function frReady(){
          window.frWidget=turnstile.render('#check',{
            sitekey:\(key),theme:\(theme),size:'flexible',appearance:'interaction-only',
            callback:function(t){post({type:'token',token:t})},
            'before-interactive-callback':function(){post({type:'interactive'})},
            'expired-callback':function(){post({type:'expired'})},
            'error-callback':function(){post({type:'error'})}
          })
        }
        </script>
        <script src="https://\(Self.challengeHost)/turnstile/v0/api.js?onload=frReady&render=explicit" async defer onerror="post({type:'loadFailed'})"></script>
        </head><body><div id="check"></div></body></html>
        """
    }

    private static func jsString(_ value: String) -> String {
        guard let data = try? JSONEncoder().encode(value), let encoded = String(data: data, encoding: .utf8) else {
            return "''"
        }
        return encoded
    }

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
        var onEvent: (@MainActor (Event) -> Void)?
        var loadedPage: String?
        var resets = 0
        var baseURL: URL?

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            // Only the page this view loaded, never one of Cloudflare's frames.
            guard message.frameInfo.isMainFrame,
                  let body = message.body as? [String: Any],
                  let type = body["type"] as? String
            else { return }
            switch type {
            case "token":
                if let token = body["token"] as? String, !token.isEmpty { onEvent?(.token(token)) }
            case "interactive":
                onEvent?(.interactionRequired)
            case "expired":
                onEvent?(.expired)
            case "error":
                onEvent?(.failed)
            case "loadFailed":
                onEvent?(.loadFailed)
            default:
                break
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction
        ) async -> WKNavigationActionPolicy {
            guard let url = navigationAction.request.url else { return .cancel }
            if navigationAction.navigationType == .linkActivated {
                Self.openExternally(url)
                return .cancel
            }
            if url.scheme == "about" { return .allow }
            let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? false
            if isMainFrame {
                // Only the HTML string this view loaded itself, which WebKit
                // reports as a navigation to its base URL.
                return navigationAction.navigationType == .other && url.host() == baseURL?.host() ? .allow : .cancel
            }
            return url.scheme == "https" && url.host() == TurnstileWebView.challengeHost ? .allow : .cancel
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            // A link that asks for a new window opens in Safari instead.
            if let url = navigationAction.request.url { Self.openExternally(url) }
            return nil
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
            report(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
            report(error)
        }

        private func report(_ error: any Error) {
            let error = error as NSError
            // A cancelled or interrupted load is a reload replacing the page or
            // the policy above doing its job, not a failure.
            let cancelled = error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled
            let interrupted = error.domain == "WebKitErrorDomain" && error.code == 102
            if cancelled || interrupted { return }
            onEvent?(.loadFailed)
        }

        private static func openExternally(_ url: URL) {
            guard url.scheme == "https" else { return }
            UIApplication.shared.open(url)
        }
    }
}
