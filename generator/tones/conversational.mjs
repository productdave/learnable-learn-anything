// Conversational tone preset.
// Used in Stage 3 to shape the writing style of generated topic content.
// The exemplars are short, anonymised paragraph snippets — they teach the
// model the *style*, not the *source*. No author attribution is exposed in
// the product.

export const conversationalTone = {
  id: 'conversational',
  label: 'Conversational',
  description: 'Casual, confessional, low-ego. Direct address, bold inline keywords, short paragraphs.',

  systemFragment: `
TONE — Conversational. Write like a smart friend explaining something over coffee.

Do:
- Use em dashes naturally for pacing.
- Open paragraphs with casual phrases when natural — "Here's the thing", "From what I've seen", "Let's get real".
- Bold 2-4 key phrases per paragraph using <strong> tags so scan-readers pick up the substance.
- Use parenthetical asides to talk to the reader.
- Address the reader directly with "you", "we", "I" — never abstract third-person.
- Keep most paragraphs 1-3 sentences. Break them up.
- Cite named thinkers by full name when relevant (drop them in naturally, not as appeals to authority).
- Use real-world examples over abstract theory.
- Stay low-ego. Say "from what I've observed" or "I've seen this pattern" rather than absolute claims.

Don't:
- Use marketing polish ("unlock", "game-changer", "level up", "crush it").
- Open with confrontational hot takes ("Most people are wrong about…").
- Write long unbroken paragraphs.
- Use empty filler phrases.
- Sound like a hustle-bro LinkedIn influencer.
`.trim(),

  exemplars: [
    // Short, anonymised paragraph examples that demonstrate the style. No
    // source identifiers. The model uses these as voice calibration.
    `<p>Here's the thing — when most people hear "negotiation," they picture a tense boardroom showdown. From what I've seen, the most consequential negotiations happen quietly, in passing, in the moments you barely notice. <strong>The framing question, the timing of the ask, the silence after a counter-offer</strong> — these do more work than any clever tactic.</p>`,

    `<p>Don't worry if this feels abstract at first. The trick is to <strong>start with one real situation from your own week</strong> and map it on. Who were the players? What were they trying to get? What did each one stand to lose if it went sideways? (You'll be surprised how much clarity you get from just answering those three questions out loud.)</p>`,

    `<p>For me, this was one of those "huh" moments. I'd been treating every disagreement as something to <em>resolve</em> — get to agreement, move on. Robert Axelrod's tournaments suggested something different: in long relationships, <strong>the willingness to push back briefly, then forgive quickly</strong>, beats both pure cooperation and pure conflict. The forgiveness is what carries it.</p>`
  ]
};

export const TONES = {
  conversational: conversationalTone
};

export function getTone(id = 'conversational') {
  return TONES[id] || conversationalTone;
}
