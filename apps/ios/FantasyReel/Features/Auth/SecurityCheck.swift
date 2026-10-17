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
    /// Bumped to load a fresh challenge.
    private(set) var generation = 0
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
        loadFailed = false
        generation += 1
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
                    generation: check.generation,
                    onEvent: handle
                )
                .frame(height: 65)
                .frame(maxWidth: .infinity)
                .accessibilityLabel("Security check")
                if check.loadFailed {
                    Text("The security check couldn't load. Check your connection, then try again.")
                        .frFont(.meta)
                        .foregroundStyle(Color.frError)
                        .multilineTextAlignment(.center)
                    Button("Try Again") { check.reset() }
                        .buttonStyle(.fr(.secondary, size: .compact))
                }
            }
        }
    }

    private func handle(_ event: TurnstileWebView.Event) {
        switch event {
        case .token(let token):
            check.receive(token)
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
    let generation: Int
    let onEvent: @MainActor (Event) -> Void

    static let handlerName = "turnstile"
    static let challengeHost = "challenges.cloudflare.com"

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // Nothing from the challenge outlives the form.
        configuration.websiteDataStore = .nonPersistent()
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
        if context.coordinator.loadedPage != pageKey {
            load(into: webView, coordinator: context.coordinator)
        }
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: handlerName)
    }

    private var pageKey: String { "\(generation)|\(theme)" }

    private func load(into webView: WKWebView, coordinator: Coordinator) {
        coordinator.loadedPage = pageKey
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
          turnstile.render('#check',{
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
        var baseURL: URL?

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
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
            onEvent?(.loadFailed)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
            // A cancelled navigation is the policy above doing its job.
            if (error as NSError).code == NSURLErrorCancelled { return }
            onEvent?(.loadFailed)
        }

        private static func openExternally(_ url: URL) {
            guard url.scheme == "https" else { return }
            UIApplication.shared.open(url)
        }
    }
}
