import type { RegistryItem } from "../services/create-registry";

export interface StatusItem extends RegistryItem {
  workspaceId: string;
  category: string;
  priority: number;
  label: string;
  icon?: string;
  tooltip?: string;
  variant?: "default" | "success" | "warning" | "error" | "muted";
  action?: {
    command: string;
    args?: unknown[];
  };
  metadata?: Record<string, unknown>;
}

export type StatusItemInput = Omit<StatusItem, "id" | "source" | "workspaceId">;
