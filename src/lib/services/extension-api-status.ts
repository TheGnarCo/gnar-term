/**
 * Extension API Status sub-module — workspace status methods.
 *
 * Builds the status-related slice of the ExtensionAPI, scoping all
 * operations to the calling extension's ID.
 */
import type { Readable } from "svelte/store";
import type { StatusItem, StatusItemInput } from "../types/status";
import {
  setStatusItem,
  clearStatusItem,
  clearAllStatusForSourceAndWorkspace,
  getWorkspaceStatus,
  getWorkspaceStatusByCategory,
} from "./status-registry";

export interface StatusAPI {
  setStatus(workspaceId: string, itemId: string, status: StatusItemInput): void;
  clearStatus(workspaceId: string, itemId: string): void;
  clearAllStatus(workspaceId: string): void;
  getWorkspaceStatus(workspaceId: string): Readable<StatusItem[]>;
  getWorkspaceStatusByCategory(
    workspaceId: string,
    category: string,
  ): Readable<StatusItem[]>;
}

export function createStatusAPI(extId: string): StatusAPI {
  return {
    setStatus(
      workspaceId: string,
      itemId: string,
      status: StatusItemInput,
    ): void {
      setStatusItem(extId, workspaceId, itemId, status);
    },
    clearStatus(workspaceId: string, itemId: string): void {
      clearStatusItem(extId, workspaceId, itemId);
    },
    clearAllStatus(workspaceId: string): void {
      clearAllStatusForSourceAndWorkspace(extId, workspaceId);
    },
    getWorkspaceStatus(workspaceId: string): Readable<StatusItem[]> {
      return getWorkspaceStatus(workspaceId);
    },
    getWorkspaceStatusByCategory(
      workspaceId: string,
      category: string,
    ): Readable<StatusItem[]> {
      return getWorkspaceStatusByCategory(workspaceId, category);
    },
  };
}
