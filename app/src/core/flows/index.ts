// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
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
