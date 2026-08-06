import { GoogleIcon } from 'fantasy-reel'

/** Unlike DiscordIcon this glyph carries Google's own brand colours and must
    not be recoloured — brand guidelines require the four-colour mark. */
export const Sizes = () => (
  <div className="flex items-center gap-6">
    <GoogleIcon className="w-4 h-4" />
    <GoogleIcon className="w-6 h-6" />
    <GoogleIcon className="w-10 h-10" />
  </div>
)

/** Where it is actually used: the Google OAuth entry point. */
export const OnAButton = () => (
  <button className="btn btn-secondary gap-2">
    <GoogleIcon className="w-5 h-5" />
    Continue with Google
  </button>
)

/** Both providers, as they appear stacked on the sign-in screen. */
export const SignInOptions = () => (
  <div className="flex flex-col gap-3 max-w-xs">
    <button className="btn btn-secondary gap-2 w-full">
      <GoogleIcon className="w-5 h-5" />
      Continue with Google
    </button>
  </div>
)
