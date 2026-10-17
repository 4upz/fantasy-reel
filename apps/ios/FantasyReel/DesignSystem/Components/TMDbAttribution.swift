import SwiftUI

/// TMDb's required attribution, at the foot of screens that show movie data
/// (not on every page). TMDb's logo joins it once the asset is in the catalog.
struct TMDbAttribution: View {
    var body: some View {
        Text("This product uses the TMDb API but is not endorsed or certified by TMDb.")
            .frFont(.caption)
            .foregroundStyle(Color.frTextMuted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.top, 16)
            .padding(.horizontal, 8)
    }
}
