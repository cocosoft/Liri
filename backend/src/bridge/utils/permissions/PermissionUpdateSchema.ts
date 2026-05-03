export type PermissionAction = 'allow' | 'deny' | 'ask';
export type PermissionResource = 'file' | 'command' | 'network' | 'environment';

export interface PermissionUpdate {
  resource: PermissionResource;
  action: PermissionAction;
  target: string;
  reason?: string;
  timestamp?: number;
}
