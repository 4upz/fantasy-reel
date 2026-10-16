// swift-tools-version: 6.2
//
// FantasyReelKit holds everything in the iOS app that does not draw pixels:
//
// - FantasyReelCore: wire models, identifiers, dates, scoring and navigation
//   rules. No dependencies, so its tests run in a second on a Mac.
// - FantasyReelAPI: the Supabase client, the Edge Function transport, and the
//   repositories that read from the shared backend.
//
// The app target (apps/ios/FantasyReel) imports both and owns all SwiftUI.

import PackageDescription

let package = Package(
    name: "FantasyReelKit",
    platforms: [
        .iOS(.v26),
        .macOS(.v26),
    ],
    products: [
        .library(name: "FantasyReelCore", targets: ["FantasyReelCore"]),
        .library(name: "FantasyReelAPI", targets: ["FantasyReelAPI"]),
    ],
    dependencies: [
        // Official Supabase Swift client (Auth, PostgREST, Realtime, Storage, Functions).
        // Xcode records the exact resolved version in Package.resolved on first build.
        .package(url: "https://github.com/supabase/supabase-swift.git", from: "2.20.0"),
    ],
    targets: [
        .target(
            name: "FantasyReelCore",
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
        .target(
            name: "FantasyReelAPI",
            dependencies: [
                "FantasyReelCore",
                .product(name: "Supabase", package: "supabase-swift"),
            ],
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
        .testTarget(
            name: "FantasyReelCoreTests",
            dependencies: ["FantasyReelCore"],
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
        .testTarget(
            name: "FantasyReelAPITests",
            dependencies: ["FantasyReelAPI"],
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
    ]
)
