/**
 * Workspace Groups — UI-scoped state. Bridges the create-dialog overlay
 * to its caller: the command/workspace-action fires, reads the overlay's
 * submitted values via the resolver, and unblocks.
 *
 * Split from `stores/workspace-groups.ts` so the persisted-data store
 * has no UI coupling.
 */
import { writable } from "svelte/store";

export interface CreateDialogPrefill {
  path: string;
  name?: string;
}

export type CreateDialogResult = {
  name: string;
  path: string;
  color: string;
} | null;

/**
 * When non-null, the create-dialog overlay renders. Cleared by the
 * overlay on submit/cancel.
 */
export const pendingCreateResolver = writable<
  ((result: CreateDialogResult) => void) | null
>(null);

/**
 * Optional fields to pre-populate the create dialog with (e.g. from
 * the Promote-to-Group flow). Cleared by the overlay on close.
 */
export const createDialogPrefill = writable<CreateDialogPrefill | null>(null);
