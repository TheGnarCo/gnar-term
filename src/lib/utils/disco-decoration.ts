/**
 * Disco decoration data and hash helpers for the "Molly Disco" theme.
 * These are pure data/utilities with no component-lifecycle dependency.
 */

export const discoEmojis: readonly string[] = [
  "✨",
  "🦄",
  "🌈",
  "💜",
  "🪩",
  "⚡",
  "💫",
  "🔮",
  "🎀",
  "💎",
  "🌸",
  "🍭",
  "🫧",
  "💗",
  "🦋",
  "🎠",
  "🧚",
  "💖",
  "🌺",
  "🎵",
  "🩵",
  "🪻",
  "🎪",
  "🧸",
  "🌟",
  "💐",
  "🩷",
  "🏄",
  "🐬",
  "🌊",
  "🎨",
  "🧜",
  "🫶",
  "💕",
  "🌙",
  "🐾",
  "🍬",
  "🎶",
  "🌻",
  "🐱",
  "💝",
  "🎈",
  "🪼",
  "🦩",
  "🫀",
  "🧁",
  "🍩",
  "🎯",
];

export const discoColors: readonly string[] = [
  "#e91e63",
  "#c026d3",
  "#2979ff",
  "#00bfa5",
  "#ff4081",
  "#e040fb",
  "#448aff",
  "#1de9b6",
  "#ff9100",
  "#18ffff",
];

/** Returns a stable emoji for the given workspace id based on a hash. */
export function discoEmojiFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return discoEmojis[Math.abs(h) % discoEmojis.length] ?? "";
}

/** Returns a stable color for the given workspace id based on a hash. */
export function discoColorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 37 + id.charCodeAt(i)) | 0;
  return discoColors[Math.abs(h) % discoColors.length] ?? "";
}
