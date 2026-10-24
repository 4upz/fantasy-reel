// Universal Links for the iPhone app. iOS fetches this association from both
// site hosts (through Apple's CDN, which never follows redirects) and then
// opens matching links in the app instead of Safari when it is installed.
//
// Claim only paths the app's `DeepLink.parse`
// (apps/ios/Packages/FantasyReelKit/Sources/FantasyReelCore/DeepLinks/DeepLink.swift)
// routes, so a claimed link never lands in the app with nowhere to go. Auth
// callbacks, `/unsubscribe` and the legal pages stay on the web.

/** Apple team ID + bundle ID of the iPhone app (com.fantasyreel.ios). */
export const IOS_APP_ID = 'TQC372U58U.com.fantasyreel.ios'

/** Paths that open in the app, in Apple's `components` pattern syntax. */
export const APP_LINK_PATHS = [
  '/join',
  '/league/*',
  '/movies',
  '/wishlist',
  '/settings',
  '/help',
  '/how-to-play',
] as const

export const appleAppSiteAssociation = {
  applinks: {
    details: [
      {
        appIDs: [IOS_APP_ID],
        components: APP_LINK_PATHS.map((path) => ({ '/': path })),
      },
    ],
  },
  // Lets the app offer passwords saved for the site in iCloud Keychain.
  webcredentials: {
    apps: [IOS_APP_ID],
  },
}
