/**
 * Cloudflare Turnstile CAPTCHA for Supabase Auth.
 *
 * Supabase verifies the token itself (Authentication > Bot and Abuse
 * Protection), so the app only collects it in the browser and forwards it as
 * `captchaToken`. With NEXT_PUBLIC_TURNSTILE_SITE_KEY unset no widget renders
 * and no token is sent, which is what local dev and E2E rely on (local
 * Supabase has CAPTCHA off).
 *
 * Supabase requires a token on sign-up, password sign-in (including
 * re-authentication), password-reset and resend-confirmation requests. Each
 * token is single-use, so reset the widget after every attempt.
 */

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''
export const CAPTCHA_ENABLED = TURNSTILE_SITE_KEY !== ''

/** FormData field the client puts the Turnstile token in. */
export const CAPTCHA_FIELD = 'captchaToken'

export const CAPTCHA_FAILED_MESSAGE =
  'The security check expired or failed. Please complete it and try again.'

/** Read the token a form submitted; an empty field means "none". */
export function readCaptchaToken(formData: FormData): string | undefined {
  const token = formData.get(CAPTCHA_FIELD)
  return typeof token === 'string' && token !== '' ? token : undefined
}

/** True when Supabase Auth rejected the request's CAPTCHA token. */
export function isCaptchaError(error: { code?: string; message: string }): boolean {
  return error.code === 'captcha_failed' || error.message.startsWith('captcha protection')
}
