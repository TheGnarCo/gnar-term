export interface MenuItem {
  label: string;
  action: () => void;
  shortcut?: string;
  separator?: boolean;
  disabled?: boolean;
  danger?: boolean;
}
