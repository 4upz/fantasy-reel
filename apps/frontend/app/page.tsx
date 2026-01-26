import HeroSection from './components/landing/HeroSection'
import HowItWorks from './components/landing/HowItWorks'
import WhyPlay from './components/landing/WhyPlay'
import CTAFooter from './components/landing/CTAFooter'

export default function LandingPage(): React.ReactElement {
  return (
    <main>
      <HeroSection />
      <HowItWorks />
      <WhyPlay />
      <CTAFooter />
    </main>
  )
}
