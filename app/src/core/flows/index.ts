export { sortFlowContributionsByLabel } from './types.js';
export type {
  FlowDocsLink,
  FlowContributionKind,
  FlowContributionSurface,
  FlowOptionGroup,
  FlowOption,
  FlowContribution,
  HealthCheckResult,
  HealthCheckReport,
  ChannelSetupResult,
  ModelPickerResult,
  ProviderSetupResult,
  FlowContext,
  FlowConfigProvider,
} from './types.js';

export {
  registerChannelSetupPlugin,
  getChannelSetupPlugin,
  listChannelSetupPlugins,
  setupChannel,
  setupChannels,
  isChannelConfigured,
} from './channel-setup.js';
export type { ChannelSetupPlugin } from './channel-setup.js';

export {
  registerHealthCheck,
  registerHealthChecks,
  unregisterHealthCheck,
  initializeDefaultHealthChecks,
  runHealthChecks,
  listHealthChecks,
} from './doctor-health.js';
export type { HealthCheck } from './doctor-health.js';

export {
  registerModel,
  registerModels,
  getModel,
  listModels,
  listModelsByProvider,
  listProviders,
  pickModel,
  getModelPickerOptions,
  parseModelRef,
} from './model-picker.js';
export type { ModelCatalogEntry, ModelPickerOptions } from './model-picker.js';

export {
  registerProviderFlowContribution,
  getProviderSetupFlow,
  getProviderSetupFlowContributions,
  listRegisteredProviderIds,
  resolveProviderAuthConfig,
  setupProvider,
} from './provider-flow.js';
export type {
  ProviderFlowScope,
  ProviderSetupFlowOption,
  ProviderSetupFlowContribution,
  ProviderAuthConfig,
} from './provider-flow.js';
