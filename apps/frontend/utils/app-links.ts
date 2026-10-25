// Universal Links for the iPhone app. iOS fetches this association from both
// site hosts (through Apple's CDN, which never follows redirects) and then
// opens matching links in the app instead of Safari when it is installed.
//
// Claim only paths the app's `DeepLink.parse`
// (apps/ios/Packages/FantasyReelKit/Sources/FantasyReelCore/DeepLinks/DeepLink.swift)
// routes, so a claimed link never lands in the app with nowhere to go. Auth
// callbacks, `/unsubscribe`, the landing page and the legal pages stay on the web.

/** Apple team ID + bundle ID of the iPhone app (com.fantasyreel.ios). */
export const IOS_APP_ID = 'TQC372U58U.com.fantasyreel.ios'

// Apple's patterns: `*` is any run of characters, `?` exactly one. A league
// link needs a UUID-shaped id and a join link a non-empty code or token, as
// `DeepLink.parse` does, so a truncated link stays on the web page.
const UUID_PATTERN = '????????-????-????-????-????????????'

/** Link patterns that open in the app, as Apple `components` entries. */
export const APP_LINK_COMPONENTS: ReadonlyArray<{ '/': string; '?'?: Record<string, string> }> = [
  { '/': '/join', '?': { token: '?*' } },
  { '/': '/join', '?': { code: '?*' } },
  { '/': `/league/${UUID_PATTERN}` },
  { '/': `/league/${UUID_PATTERN}/*` },
  { '/': '/dashboard' },
  { '/': '/movies' },
  { '/': '/wishlist' },
  { '/': '/settings' },
  { '/': '/help' },
  { '/': '/how-to-play' },
]

export const appleAppSiteAssociation = {
  applinks: {
    details: [
      {
        appIDs: [IOS_APP_ID],
        components: APP_LINK_COMPONENTS,
      },
    ],
  },
  // Lets the app offer passwords saved for the site in iCloud Keychain.
  webcredentials: {
    apps: [IOS_APP_ID],
  },
}
