import type { Metadata } from 'next'
import LegalPage, { ExternalLink, SupportEmailLink, type LegalSection } from '@/app/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy Policy | Fantasy Reel',
  description: 'How Fantasy Reel collects, uses, shares, and protects personal information.',
  alternates: { canonical: '/privacy' },
}

const SECTIONS: LegalSection[] = [
  {
    id: 'information-we-collect',
    title: 'Information we collect',
    content: (
      <ul>
        <li>
          <strong>Account information:</strong> your email, account ID, display name, profile image, sign-in
          details, and preferences. Google or Discord sign-in shares basic profile information with us, but not
          your password. Your initial display name may come from your provider or email address.
        </li>
        <li>
          <strong>Game information:</strong> leagues, teams, uploaded images, picks, bids, trades and messages,
          scores, season history, and wishlists.
        </li>
        <li>
          <strong>Communications and connections:</strong> invitations, support messages, notification delivery
          records, and Discord identifiers, commands, and connection settings. Someone inviting you may provide
          your email before you register.
        </li>
        <li>
          <strong>Technical information:</strong> IP address, browser and device details, pages visited, feature
          activity, performance data, and errors. Activity records may include league IDs and game actions.
        </li>
      </ul>
    ),
  },
  {
    id: 'how-we-use-information',
    title: 'How we use information',
    content: (
      <p>
        We use this information to run and secure accounts and leagues, send invitations and notifications,
        provide connected features, remember preferences, answer requests, diagnose problems, improve Fantasy
        Reel, and meet legal obligations. Account details are needed to provide an account; profile images,
        wishlist sharing, and Discord connections are optional.
      </p>
    ),
  },
  {
    id: 'what-other-people-can-see',
    title: 'What other people can see',
    content: (
      <ul>
        <li>
          <strong>Profiles:</strong> display names and profile identifiers are publicly accessible. Profile and
          team images are accessible to anyone with their URL. Choose names and images you are comfortable
          sharing.
        </li>
        <li>
          <strong>Leagues:</strong> participants see relevant team information, game activity, messages, and
          results. Commissioners manage invitations and league records. Commissioners and trade participants can
          currently access recipient email addresses in related trade notification records.
        </li>
        <li>
          <strong>Wishlists:</strong> private by default; shared wishlists are visible to signed-in members of
          leagues you actively share.
        </li>
        <li>
          <strong>Discord:</strong> connected channels may receive league updates, including picks, bids,
          trades, messages, and scores. Anyone with access to those channels may see them, including people
          outside your league. Disconnecting does not remove earlier posts.
        </li>
      </ul>
    ),
  },
  {
    id: 'service-providers',
    title: 'Service providers',
    content: (
      <>
        <p>
          We share information with providers that help operate Fantasy Reel: Supabase for accounts, data, and
          images; Vercel for hosting, analytics, and performance measurement; Railway for hosting our Discord bot;
          Sentry for diagnostics and session replay; and Resend for email delivery.
        </p>
        <p>
          Google and Discord process information when you use their sign-in or connected features, under their
          own policies. The Movie Database and MDBList supply movie information. Movie searches go to The Movie
          Database, and external image hosts receive technical request information.
        </p>
        <p>
          We may also disclose information to comply with law, address abuse, protect people or the service, or
          transfer the service subject to applicable privacy protections.
        </p>
      </>
    ),
  },
  {
    id: 'cookies-analytics-and-session-replay',
    title: 'Cookies, analytics, and session replay',
    content: (
      <>
        <p>
          We use cookies to keep you signed in and browser storage to remember preferences. Clearing or blocking
          them may affect sign-in and saved settings. Vercel Analytics and Speed Insights help us understand
          visits, feature use, and website performance.
        </p>
        <p>
          We use Sentry for error reporting, performance monitoring, and session replay to find and fix problems.
          Session replay records website interactions, such as clicks, scrolling, and navigation, in a sample of
          sessions, including sessions with errors. Text and form inputs are masked, and media is blocked. See{' '}
          <ExternalLink href="https://sentry.io/privacy/">Sentry’s privacy policy</ExternalLink>.
        </p>
        <p>Fantasy Reel does not currently respond to browser “Do Not Track” signals.</p>
      </>
    ),
  },
  {
    id: 'retention-and-deletion',
    title: 'Retention and deletion',
    content: (
      <>
        <p>
          We keep information for as long as needed for the purposes above, considering account activity, ongoing
          leagues and season history, troubleshooting, security, disputes, and legal requirements. Leaving a
          league or disconnecting a provider does not delete your account or historical results.
        </p>
        <p>
          You can request deletion at <SupportEmailLink />. Subject to applicable exceptions, we will delete or
          anonymize your information. Limited records may remain where legally necessary, and backups may persist
          until they expire. Copies held independently by other users or services are outside our control.
        </p>
      </>
    ),
  },
  {
    id: 'your-choices-and-rights',
    title: 'Your choices and rights',
    content: (
      <>
        <p>
          You can edit your profile and wishlist-sharing preferences in the app. Depending on your location, you
          may have rights to access, correct, delete, or receive a portable copy of your information; restrict or
          object to processing; withdraw consent; appeal a refusal; or complain to a data protection authority.
        </p>
        <p>
          Email <SupportEmailLink /> to make a request or appeal. We may verify your identity and will respond
          within applicable legal deadlines. Withdrawing consent does not affect earlier lawful processing.
        </p>
      </>
    ),
  },
  {
    id: 'international-users',
    title: 'International users',
    content: (
      <>
        <p>
          Fantasy Reel operates from the United States, where our database is hosted. Providers may process
          information in other countries with different privacy laws.
        </p>
        <p>
          Where European or UK law applies, our legal bases are providing the service under our agreement with
          you; legitimate interests in security, maintenance, and support, balanced against your rights; legal
          obligations; and consent where required. Contact us for information about applicable international
          transfer safeguards.
        </p>
      </>
    ),
  },
  {
    id: 'age-requirements',
    title: 'Age requirements',
    content: (
      <>
        <p>
          Fantasy Reel is for people aged 13 or older. If local law requires a higher age to use the service
          without parental authorization, you must meet that age. We do not offer registration through parental
          consent.
        </p>
        <p>
          If you believe someone below the applicable minimum age has provided personal information, contact{' '}
          <SupportEmailLink /> so we can investigate and remove information where required.
        </p>
      </>
    ),
  },
  {
    id: 'security-and-changes',
    title: 'Security and changes',
    content: (
      <>
        <p>
          We use safeguards intended to protect personal information, but no service can guarantee absolute
          security.
        </p>
        <p>
          We may update this policy by posting a revised effective date, with additional notice or consent where
          legally required.
        </p>
      </>
    ),
  },
]

export default function PrivacyPage(): React.ReactElement {
  return (
    <LegalPage
      title="Privacy policy"
      effectiveDate="2026-10-03"
      intro={
        <>
          <p>
            Fantasy Reel is operated by Arik Smith, an individual in Maryland, United States. This policy
            explains how we handle personal information on fantasyreel.com and through our connected Discord
            features. The operator is responsible for that information (the “data controller,” where
            applicable).
          </p>
          <p>
            For privacy questions or requests, email <SupportEmailLink />.
          </p>
        </>
      }
      sections={SECTIONS}
    />
  )
}
