import SwiftUI

/// TMDb's required attribution (the web's `TMDbAttribution` footer): the logo
/// and "This product uses the TMDb API but is not endorsed or certified by
/// TMDb." Place it at the foot of screens that show movie data, not on every
/// screen.
struct TMDbAttribution: View {
    private static let site = URL(string: "https://www.themoviedb.org")!

    var body: some View {
        Link(destination: Self.site) {
            HStack(spacing: 12) {
                Image("TMDbLogo")
                    .resizable()
                    .aspectRatio(273.42 / 35.52, contentMode: .fit)
                    .frame(height: 14)
                    .accessibilityHidden(true)
                Text("This product uses the TMDb API but is not endorsed or certified by TMDb.")
                    .frFont(.caption)
                    .foregroundStyle(Color.frTextSecondary)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens themoviedb.org")
    }
}

#Preview {
    TMDbAttribution()
        .padding()
        .background(Color.frBackground)
}
