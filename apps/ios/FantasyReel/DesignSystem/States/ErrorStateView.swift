import SwiftUI

/// A load failure with a Try Again button (V2DraftOffline "Draft didn't load").
///
/// - `.screen`: centered, for a whole screen or tab that failed to load.
/// - `.card`: a compact card (icon bubble, title, message, button) for one
///   section of a screen that otherwise loaded.
///
/// The message is the server's or `APIError`'s user-facing text; it stays on
/// screen until the user retries (never a transient toast).
struct ErrorStateView: View {
    enum Layout: Sendable {
        case screen
        case card
    }

    private let title: String
    private let message: String
    private let retryTitle: String
    private let layout: Layout
    private let retry: (() -> Void)?

    init(
        title: String = "Couldn't load",
        message: String,
        retryTitle: String = "Try Again",
        layout: Layout = .screen,
        retry: (() -> Void)? = nil
    ) {
        self.title = title
        self.message = message
        self.retryTitle = retryTitle
        self.layout = layout
        self.retry = retry
    }

    var body: some View {
        switch layout {
        case .screen: screen
        case .card: card
        }
    }

    private var screen: some View {
        VStack(spacing: 0) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 36, weight: .regular))
                .foregroundStyle(Color.frTextSecondary)
                .accessibilityHidden(true)
            Text(title)
                .frFont(.panelTitle)
                .foregroundStyle(Color.frText)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, 12)
            Text(message)
                .frFont(.body)
                .foregroundStyle(Color.frTextSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 300)
                .padding(.top, 8)
            if let retry {
                Button(retryTitle, action: retry)
                    .buttonStyle(.fr(.secondary, size: .medium))
                    .padding(.top, 20)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, FRMetrics.pageMargin)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var card: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                cardText
                retryButton
            }
            VStack(alignment: .leading, spacing: 12) {
                cardText
                retryButton
            }
        }
        .padding(FRMetrics.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frCardBackground()
    }

    private var cardText: some View {
        HStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark")
                .font(.body.weight(.semibold))
                .foregroundStyle(Color.frTextSecondary)
                .frame(width: 36, height: 36)
                .background(Color.frNeutralFill, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .frFont(.rowTitle)
                    .foregroundStyle(Color.frText)
                Text(message)
                    .frFont(.meta)
                    .foregroundStyle(Color.frTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var retryButton: some View {
        if let retry {
            Button(retryTitle, action: retry)
                .buttonStyle(.fr(.secondary, size: .medium))
        }
    }
}

#if DEBUG
#Preview("Errors · dark") {
    FRPreviewCanvas {
        ErrorStateView(title: "Draft didn't load", message: "Check your connection.", layout: .card) {}
        ErrorStateView(message: "The server didn't respond. Your roster hasn't changed.") {}
            .frame(height: 320)
    }
}

#Preview("Errors · light") {
    FRPreviewCanvas {
        ErrorStateView(title: "Draft didn't load", message: "Check your connection.", layout: .card) {}
    }
    .preferredColorScheme(.light)
}
#endif
