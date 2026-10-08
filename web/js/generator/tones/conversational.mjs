// Conversational tone preset.
// Used in Stage 3 to shape the writing style of generated topic content.
// The exemplars are short, anonymised paragraph snippets — they teach the
// model the *style*, not the *source*. No author attribution is exposed in
// the product.

export const conversationalTone = {
  id: 'conversational',
  label: 'Conversational',
  description: 'Casual, warm, low-ego. Direct address, bold inline keywords, short paragraphs.',

  systemFragment: `
TONE — Conversational. Write like a smart friend explaining something over coffee.

Do:
- Use em dashes naturally for pacing.
- Open paragraphs with casual phrases when natural — "Here's the thing", "Let's work through an example".
- Bold 2-4 key phrases per paragraph using <strong> tags so scan-readers pick up the substance.
- Use parenthetical asides to talk to the reader.
- Address the reader directly with "you" and "we". First-person guidance is fine, but do not invent personal experience, observations, credentials or memories.
- Keep most paragraphs 1-3 sentences. Break them up.
- Attribute a named thinker's idea only when the supplied material supports it; a friendly voice does not establish authority.
- Use real-world examples over abstract theory.
- Stay low-ego. Use qualified language such as "one option is" or "notice whether" when outcomes depend on the situation.

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
    `<p>Here's the thing — an example doesn't need a dramatic setting to be useful. <strong>Imagine a teammate asking to change a deadline.</strong> What could you ask before agreeing? Let's work through one possible response and the tradeoffs it creates.</p>`,

    `<p>Don't worry if this feels abstract at first. The trick is to <strong>start with one real situation from your own week</strong> and map it on. Who were the players? What were they trying to get? What did each one stand to lose if it went sideways? (You'll be surprised how much clarity you get from just answering those three questions out loud.)</p>`,

    `<p>For a hypothetical disagreement, compare two options: <strong>agree immediately, or ask what matters most before deciding.</strong> Neither is automatically right. Notice what each option makes possible and what you would need to know before choosing.</p>`
  ]
};

export const TONES = {
  conversational: conversationalTone
};

export function getTone(id = 'conversational') {
  return TONES[id] || conversationalTone;
}
