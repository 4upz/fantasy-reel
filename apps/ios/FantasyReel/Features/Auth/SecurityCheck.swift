import FantasyReelAPI
import SwiftUI
import UIKit
import WebKit

/// The Cloudflare Turnstile token for one form (N-03), the native `useCaptcha`.
///
/// Production Supabase requires a token on sign-up, password sign-in, reset and
/// resend. Each token is single-use and consumed even when the request fails,
/// so `take()` hands it over and starts a fresh challenge at the same time.
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
    /// The challenge script couldn't load (offline, content blocker).
    fileprivate(set) var loadFailed = false

    /// Whether a form may submit now. Check it on submit and show
    /// `AuthMessages.captchaPending` instead of disabling the button, so
    /// VoiceOver users hear why nothing happened.
    func isReady(_ configuration: AppConfiguration) -> Bool {
        configuration.turnstileSiteKey == nil || token != nil
    }

    /// The token for one request; the widget reloads for the next one.
    func take() -> String? {
        defer { reset() }
        return token
    }

    func reset() {
        token = nil
        if loadFailed {
            reload()
        } else {
            resets += 1
        }
    }

    func reload() {
        token = nil
        loadFailed = false
        reloads += 1
    }

    fileprivate func receive(_ token: String?) {
        self.token = token
        if token != nil { loadFailed = false }
    }
}

/// The Turnstile widget, or nothing when the security check is off. It lives in
/// a locked-down web view whose only job is to produce the token: it loads one
/// first-party page, allows no navigation except Cloudflare's challenge frames,
/// and opens any link (Cloudflare's privacy and help pages) in Safari.
struct SecurityCheckView: View {
    let check: SecurityCheck

    @Environment(AppEnvironment.self) private var environment
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        if let siteKey = environment.configuration.turnstileSiteKey {
            VStack(spacing: 6) {
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
                .frame(height: 65)
                .frame(maxWidth: .infinity)
                if check.token != nil {
                    AuthNote(systemImage: "checkmark.shield", text: "Security check passed")
                        .frame(maxWidth: .infinity)
                } else if check.loadFailed {
                    Text("The security check couldn't load. Check your connection, then try again.")
                        .frFont(.meta)
                        .foregroundStyle(Color.frError)
                        .multilineTextAlignment(.center)
                    Button("Try Again") { check.reload() }
                        .buttonStyle(.fr(.secondary, size: .compact))
                }
            }
            // A theme change reloads the widget, so the token it gave is gone.
            .onChange(of: colorScheme) { check.receive(nil) }
        }
    }

    private func handle(_ event: TurnstileWebView.Event) {
        switch event {
        case .token(let token):
            check.receive(token)
            Announcer.announce("Security check passed.")
        case .expired, .failed:
            check.receive(nil)
        case .loadFailed:
            check.receive(nil)
            check.loadFailed = true
            Announcer.announce("The security check couldn't load.")
        }
    }
}

private struct TurnstileWebView: UIViewRepresentable {
    enum Event: Equatable {
        case token(String)
        case expired, failed, loadFailed
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

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = Self.dataStore
        configuration.userContentController.add(context.coordinator, name: Self.handlerName)
        let webView = WKWebView(frame: .zero, configuration: configuration)
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
            sitekey:\(key),theme:\(theme),size:'flexible',
            callback:function(t){post({type:'token',token:t})},
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
