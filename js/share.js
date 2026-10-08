const EMOJI = { T: '🔵', S: '🟡', H: '💡' };
const PER_LINE = 4;

export function buildShareText({ state, puzzle, label, url }) {
  const emojis = state.log.map((entry) => EMOJI[entry]);
  const lines = [];
  for (let i = 0; i < emojis.length; i += PER_LINE) lines.push(emojis.slice(i, i + PER_LINE).join(''));
  return [`UnStranded #${label}`, `"${puzzle.clue}"`, ...lines, ...(url ? [url] : [])].join('\n');
}

export async function shareText(text, nav = globalThis.navigator) {
  if (nav?.share) {
    try {
      await nav.share({ text });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await nav.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
