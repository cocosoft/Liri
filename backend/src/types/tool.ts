export interface Tool {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute?(
    input: Record<string, unknown>,
    context: ToolPermissionContext
  ): Promise<unknown>;
}

export interface ToolPermissionContext {
  allowed: boolean;
  permissionLevel: string;
  isBypassPermissionsModeAvailable?: boolean;
  isBypassPermissionsModeEnabled?: boolean;
  circuitBroken?: boolean;
  circuitBrokenAt?: number;
  alwaysAllowRules?: Record<string, unknown>;
  alwaysDenyRules?: Record<string, unknown>;
  alwaysAskRules?: Record<string, unknown>;
  mode?: string;
}
