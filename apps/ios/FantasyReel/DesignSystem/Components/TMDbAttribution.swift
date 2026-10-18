import SwiftUI

/// TMDb's required attribution, at the foot of every screen that shows movie
/// data from TMDb (and only those).
struct TMDbAttribution: View {
    var body: some View {
        VStack(spacing: 8) {
            Link(destination: URL(string: "https://www.themoviedb.org")!) {
                Image("TMDbLogo")
                    .resizable()
                    .aspectRatio(273.42 / 35.52, contentMode: .fit)
                    .frame(height: 12)
                    .frame(minHeight: FRMetrics.minTapTarget)
                    .accessibilityLabel("The Movie Database")
            }
            Text("This product uses the TMDb API but is not endorsed or certified by TMDb.")
                .frFont(.caption)
                .foregroundStyle(Color.frTextSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }
}

