import { variantColor } from "../status-colors";

export type BotHatStatus = "none" | "thinking" | "attention" | "idle";

const ATTENTION = variantColor("warning");
const THINKING = variantColor("success");
const IDLE = variantColor("muted");

/**
 * Color for the rail "hat" overlay and the rail's top border when a
 * bot is present. Returns `null` for "none" so callers can branch on
 * "no hat painted at all".
 */
export function botHatColor(status: BotHatStatus): string | null {
  switch (status) {
    case "attention":
      return ATTENTION;
    case "thinking":
      return THINKING;
    case "idle":
      return IDLE;
    case "none":
      return null;
  }
}
