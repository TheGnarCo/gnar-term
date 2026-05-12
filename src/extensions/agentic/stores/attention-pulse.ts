import { derived, type Readable } from "svelte/store";
import type { ExtensionAPI } from "../../api";

export function attentionPulseStore(api: ExtensionAPI): Readable<boolean> {
  return derived(api.attention, ($a) => $a.length > 0);
}
