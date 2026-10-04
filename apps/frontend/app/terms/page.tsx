import type { Metadata } from 'next'
import Link from 'next/link'
import LegalPage, { ExternalLink, SupportEmailLink, type LegalSection } from '@/app/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'Terms of Service | Fantasy Reel',
  description: 'The terms for using Fantasy Reel, the free fantasy movie league service.',
  alternates: { canonical: '/terms' },
}

const SECTIONS: LegalSection[] = [
  {
    id: 'agreement-and-eligibility',
    title: '1. Agreement and eligibility',
    content: (
      <>
        <p>
          By selecting an option that states you agree to these Terms, you enter into this agreement. If you do
          not agree, do not create an account or use the service.
        </p>
        <p>
          You must be at least 13 and meet any higher minimum age described in our Privacy Policy for your
          location. Parental permission does not waive this minimum age. If you meet the minimum age but are under
          the legal age of majority where you live, your parent or legal guardian must review and agree to these
          Terms with you before you use Fantasy Reel.
        </p>
      </>
    ),
  },
  {
    id: 'your-account',
    title: '2. Your account',
    content: (
      <>
        <p>
          Provide accurate account information and keep your login credentials secure. Do not share or sell your
          account, impersonate someone else, or use another person’s account without permission. Contact us
          promptly if you discover unauthorized access.
        </p>
        <p>
          Our <Link href="/privacy">Privacy Policy</Link> explains how we handle personal information.
        </p>
      </>
    ),
  },
  {
    id: 'playing-fantasy-reel',
    title: '3. Playing Fantasy Reel',
    content: (
      <>
        <p>
          Fantasy Reel is for entertainment. We charge no entry fees and offer no cash prizes. Fantasy Budgets,
          bids, points, and rankings have no monetary value and cannot be purchased, sold, or redeemed for money.
          Do not use Fantasy Reel to organize paid-entry leagues, wagers, or cash prizes.
        </p>
        <p>
          Gameplay follows the published <Link href="/how-to-play">How to Play</Link> guidance and your league’s
          settings. Commissioners manage their leagues and must follow these Terms. Their league rules cannot
          override these Terms.
        </p>
        <p>
          Movie information, release dates, and ratings come from third parties and may change, be delayed, or
          contain errors. We may correct data, scores, or results to address errors or abuse and maintain fair
          play. We will explain material corrections affecting an active league when reasonably practicable.
        </p>
      </>
    ),
  },
  {
    id: 'acceptable-use',
    title: '4. Acceptable use',
    content: (
      <>
        <p>Treat other people respectfully. You must not:</p>
        <ul>
          <li>Harass, threaten, bully, discriminate against, or exploit others.</li>
          <li>
            Post pornography, graphic violence, child sexual exploitation material, or other unlawful or abusive
            content.
          </li>
          <li>
            Infringe intellectual property rights, impersonate others, or share someone’s private information
            without permission.
          </li>
          <li>
            Send spam, distribute malware, access accounts or systems without authorization, or interfere with the
            service.
          </li>
          <li>
            Cheat, exploit bugs, manipulate results through collusion, or use multiple accounts to evade
            restrictions or gain an unfair advantage.
          </li>
        </ul>
        <p>
          These rules cover names, images, messages, and other content submitted through Fantasy Reel. Report
          violations or rights complaints to <SupportEmailLink />, with enough information for us to identify the
          issue. We will review reports and take appropriate action.
        </p>
      </>
    ),
  },
  {
    id: 'your-content',
    title: '5. Your content',
    content: (
      <>
        <p>
          You retain ownership of content you submit, such as profile images, team names, and messages. You must
          have the rights and permissions needed to share it.
        </p>
        <p>
          You grant us a nonexclusive, worldwide, royalty-free license to host, store, copy, format, and display
          that content only to operate and provide Fantasy Reel, including sharing through the features and
          integrations you use. Our service providers may process it for those purposes.
        </p>
        <p>
          This license ends when your content is deleted, except for limited retention described in our Privacy
          Policy. It does not give us a right to sell your content or use it in unrelated advertising. Copies
          already shared with other users or external services may remain under their control.
        </p>
      </>
    ),
  },
  {
    id: 'our-content-and-other-services',
    title: '6. Our content and other services',
    content: (
      <>
        <p>
          Fantasy Reel’s software, design, and branding belong to us or our licensors. Movie images, ratings, and
          other third-party materials belong to their respective owners. You may use the service for personal,
          noncommercial purposes in accordance with these Terms. Other use of protected materials requires
          permission unless allowed by law or an applicable license. Open-source software remains subject to its
          own licenses.
        </p>
        <p>
          Third-party services, including connected accounts and Discord, have their own terms and privacy
          policies. Their availability and operation are outside our control.
        </p>
      </>
    ),
  },
  {
    id: 'apple-apps',
    title: '7. Apple apps',
    content: (
      <p>
        If you download a Fantasy Reel app from Apple’s App Store, Apple’s{' '}
        <ExternalLink href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/">
          Standard End User License Agreement
        </ExternalLink>{' '}
        also applies. These Terms supplement that agreement for Fantasy Reel’s service and do not replace it or
        limit your rights under it. If there is a conflict concerning a matter governed by the Standard EULA, that
        agreement controls. Contact us for Fantasy Reel support.
      </p>
    ),
  },
  {
    id: 'suspension-and-ending-use',
    title: '8. Suspension and ending use',
    content: (
      <>
        <p>
          We may remove content or restrict or close an account when reasonably necessary to address violations of
          these Terms, unlawful conduct, security risks, or harm to other users. Where practicable, we will explain
          the reason and give you an opportunity to resolve the issue. You can ask us to review a decision at{' '}
          <SupportEmailLink />.
        </p>
        <p>
          You may stop using Fantasy Reel at any time and request account deletion as described in our Privacy
          Policy. Ending use does not affect rights or obligations that arose beforehand.
        </p>
      </>
    ),
  },
  {
    id: 'availability-and-liability',
    title: '9. Availability and liability',
    content: (
      <>
        <p>
          We may update, change, or discontinue the service. We will give reasonable advance notice of changes that
          materially reduce the service or of discontinuation when practicable, except where urgent security or
          legal reasons prevent it.
        </p>
        <p>
          To the extent permitted by law, Fantasy Reel is provided “as is” and “as available,” without warranties
          of merchantability, fitness for a particular purpose, or noninfringement. We do not guarantee
          uninterrupted service, error-free data, or that stored content will never be lost.
        </p>
        <p>
          To the extent permitted by law, we are not liable for indirect or consequential losses, lost profits, or
          business interruption arising from the service. Our total liability for claims arising from the service
          or these Terms is limited to US&nbsp;$100.
        </p>
        <p>
          These exclusions and limits do not apply to fraud, willful misconduct, gross negligence, death or
          personal injury caused by negligence, or any liability that cannot lawfully be excluded or limited.
          Nothing in these Terms removes mandatory consumer rights or remedies.
        </p>
      </>
    ),
  },
  {
    id: 'changes-and-legal-terms',
    title: '10. Changes and legal terms',
    content: (
      <>
        <p>
          Maryland law governs these Terms, except that you retain any mandatory protections and rights to bring
          claims in your local courts under the law where you live.
        </p>
        <p>
          We may update these Terms. We will give reasonable advance notice of material changes by email or within
          the service, state when they take effect, and obtain renewed agreement where required by law. Changes
          will not apply retroactively to disputes that arose before they took effect. If you do not agree, stop
          using the service.
        </p>
        <p>
          If a provision is unenforceable, the remaining provisions continue to apply to the extent permitted by
          law.
        </p>
        <p>
          Questions about these Terms: <SupportEmailLink />.
        </p>
      </>
    ),
  },
]

export default function TermsPage(): React.ReactElement {
  return (
    <LegalPage
      title="Terms of service"
      effectiveDate="2026-10-03"
      intro={
        <p>
          Fantasy Reel is a free fantasy movie league service operated by Arik Smith, an individual based in
          Maryland, United States (“Fantasy Reel,” “we,” or “us”). These Terms govern our website and online
          service, including access through any Fantasy Reel app.
        </p>
      }
      sections={SECTIONS}
    />
  )
}
