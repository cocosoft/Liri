export type FlowDocsLink = {
  path: string;
  label?: string;
};

export type FlowContributionKind = 'channel' | 'core' | 'provider' | 'search';

export type FlowContributionSurface = 'auth-choice' | 'health' | 'model-picker' | 'setup';

export type FlowOptionGroup = {
  id: string;
  label: string;
  hint?: string;
};

export type FlowOption<Value extends string = string> = {
  value: Value;
  label: string;
  hint?: string;
  group?: FlowOptionGroup;
  docs?: FlowDocsLink;
  assistantPriority?: number;
  assistantVisibility?: 'visible' | 'manual-only';
};

export type FlowContribution<Value extends string = string> = {
  id: string;
  kind: FlowContributionKind;
  surface: FlowContributionSurface;
  option: FlowOption<Value>;
  source?: string;
};

export type HealthCheckResult = {
  ok: boolean;
  check: string;
  message?: string;
  severity: 'info' | 'warning' | 'error';
};

export type HealthCheckReport = {
  timestamp: number;
  checks: HealthCheckResult[];
  summary: {
    total: number;
    passed: number;
    warnings: number;
    errors: number;
  };
};

export type ChannelSetupResult = {
  channelId: string;
  configured: boolean;
  accountId?: string;
  error?: string;
};

export type ModelPickerResult = {
  model?: string;
  provider?: string;
  config?: Record<string, unknown>;
};

export type ProviderSetupResult = {
  providerId: string;
  configured: boolean;
  pluginId?: string;
  error?: string;
};

export type FlowContext = {
  config?: Record<string, unknown>;
  workspaceDir?: string;
  agentDir?: string;
  env?: Record<string, string | undefined>;
};

export type FlowConfigProvider = {
  get: <T>(key: string) => T | undefined;
  set: <T>(key: string, value: T) => void;
  save: () => Promise<boolean>;
};

export function sortFlowContributionsByLabel<T extends FlowContribution>(
  contributions: readonly T[],
): T[] {
  return [...contributions].sort(
    (left: T, right: T) =>
      left.option.label.localeCompare(right.option.label) ||
      left.option.value.localeCompare(right.option.value),
  );
}
