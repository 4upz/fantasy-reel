'use client'

import Image from 'next/image'
import { useState } from 'react'

export default function UiPreview(): React.ReactElement {
  const [imageError, setImageError] = useState(false)
  return (
    <section id="how-it-works" className="py-24 px-6 bg-surface">
      <div className="max-w-6xl mx-auto">
        <h2 className="font-display text-3xl md:text-4xl font-bold text-center text-foreground mb-16">
          What You&apos;re Getting Into
        </h2>

        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Copy */}
          <div className="space-y-8">
            <div className="value-prop">
              <h3 className="font-display text-xl font-semibold text-foreground mb-2">
                Draft Night
              </h3>
              <p className="text-foreground-secondary leading-relaxed">
                Pick your roster from upcoming releases. Bid on sleepers. Steal
                from your friends&apos; watchlists. The draft is where reputations
                are made (and destroyed).
              </p>
            </div>

            <div className="value-prop">
              <h3 className="font-display text-xl font-semibold text-foreground mb-2">
                Then You Wait
              </h3>
              <p className="text-foreground-secondary leading-relaxed">
                Movies release. Critics review. Scores update automatically from
                Rotten Tomatoes, IMDb, and Metacritic. Your &ldquo;risky Blumhouse
                pick&rdquo; either pays off or becomes a running joke.
              </p>
            </div>

            <div className="value-prop">
              <h3 className="font-display text-xl font-semibold text-foreground mb-2">
                Trade & Scheme
              </h3>
              <p className="text-foreground-secondary leading-relaxed">
                Swap movies with other teams. Counter-pick your rivals&apos; best
                draft picks. This isn&apos;t just about movies—it&apos;s about mind games.
              </p>
            </div>
          </div>

          {/* UI Preview */}
          <div className="ui-preview-container">
            <div className="ui-preview-glow" />
            {!imageError ? (
              <Image
                src="/images/draft-board-preview.png"
                alt="Fantasy Reel draft board interface"
                width={600}
                height={400}
                className="ui-preview-image"
                priority
                onError={() => setImageError(true)}
              />
            ) : (
              <div className="ui-preview-image bg-elevated flex items-center justify-center w-[600px] h-[400px]">
                <div className="text-center p-8">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gold-muted flex items-center justify-center">
                    <svg className="w-8 h-8 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                    </svg>
                  </div>
                  <p className="text-foreground-secondary font-display font-semibold">Draft Board Preview</p>
                  <p className="text-foreground-muted text-sm mt-1">See it live when you sign up</p>
                </div>
              </div>
            )}
            <p className="ui-preview-caption">
              The draft board. Where friendships go to be tested.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
