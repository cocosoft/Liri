export { PluginLifecycleManager, pluginLifecycleManager } from './PluginLifecycleManager.js';
export type { LifecycleConfig, PluginState } from './PluginLifecycleManager.js';

export { ActivationContextManager, activationContextManager } from './ActivationContext.js';
export type { ActivationReason, ActivationContext } from './ActivationContext.js';

export { LifecyclePlanner, lifecyclePlanner } from './LifecyclePlanner.js';
export type { PlanStep, LifecyclePlan, PlanExecution } from './LifecyclePlanner.js';

export { SourceConfigManager, sourceConfigManager } from './SourceConfig.js';
export type { ConfigSourceType, ConfigSource, LifecycleConfigItem } from './SourceConfig.js';

export { LifecycleTrace, lifecycleTrace } from './LifecycleTrace.js';
export type { TraceLevel, TraceEvent, TraceFilter, TraceReport } from './LifecycleTrace.js';
