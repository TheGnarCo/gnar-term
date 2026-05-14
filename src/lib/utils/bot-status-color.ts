import { variantColor } from "../status-colors";

export type BotStatus = "none" | "thinking" | "attention" | "idle";

const ATTENTION = variantColor("warning");
const THINKING = variantColor("success");
const IDLE = variantColor("muted");

/**
 * Color for the rail bot-status bubble overlay and any inline
 * affordances that should agree with it. Returns `null` for `"none"`
 * so callers can branch on "no bot signal painted at all".
 */
export function botStatusColor(status: BotStatus): string | null {
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
