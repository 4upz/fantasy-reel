const reasons = [
  {
    title: 'Make movie season more fun',
    description:
      'Turn every new release into a chance to score points and bragging rights with your friends.',
  },
  {
    title: 'No fantasy sports knowledge needed',
    description:
      "If you love movies and have opinions on what's coming out, you already know how to play.",
  },
  {
    title: 'Draft with friends or join public leagues',
    description:
      'Create a private league for your film club or jump into a public league to compete with cinephiles everywhere.',
  },
]

export default function WhyPlay(): React.ReactElement {
  return (
    <section className="py-24 px-6 bg-surface">
      <div className="max-w-4xl mx-auto">
        <h2 className="font-display text-3xl md:text-4xl font-bold text-center text-foreground mb-16">
          Why Play?
        </h2>

        <div className="space-y-10">
          {reasons.map((reason) => (
            <div key={reason.title} className="value-prop">
              <h3 className="font-display text-xl font-semibold text-foreground mb-2">
                {reason.title}
              </h3>
              <p className="text-foreground-secondary leading-relaxed">{reason.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
