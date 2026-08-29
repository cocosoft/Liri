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
export {
  ACP_PROTOCOL_VERSION,
  ACP_SESSION_ID_PREFIX,
  ACP_PROVENANCE_MODE_VALUES,
  ACP_AGENT_INFO,
} from './types.js';
export type {
  AcpProvenanceMode,
  SessionId,
  AcpSession,
  AcpServerOptions,
  AcpClientOptions,
  AcpClientHandle,
  AcpApprovalClass,
} from './types.js';

export { normalizeText, truncateText } from './normalize-text.js';
export { createSharedRecord } from './record-shared.js';
export type { SharedRecord } from './record-shared.js';
export {
  generateSessionId,
  isValidSessionId,
} from './runtime/session-identity.js';

export {
  AcpRuntimeError,
  ACP_ERROR_CODES,
  isAcpRuntimeError,
  toAcpRuntimeError,
} from './runtime/errors.js';
export type { AcpRuntimeErrorCode } from './runtime/errors.js';
export type {
  AcpRuntime,
  AcpRuntimeHandle,
  AcpRuntimeEnsureInput,
  AcpRuntimeTurnInput,
  AcpRuntimeTurnAttachment,
  AcpRuntimeEvent,
  AcpRuntimeCapabilities,
  AcpRuntimeStatus,
  AcpRuntimeDoctorReport,
  AcpRuntimePromptMode,
  AcpRuntimeSessionMode,
  AcpSessionUpdateTag,
  AcpRuntimeControl,
} from './runtime/types.js';

export {
  AcpRuntimeRegistry,
  getAcpRuntimeRegistry,
  resetAcpRuntimeRegistryForTests,
} from './runtime/registry.js';
export type { AcpRuntimeRegistration } from './runtime/registry.js';
export { formatSessionIdentity } from './runtime/session-identity.js';
export type { AcpSessionIdentity } from './runtime/session-identity.js';

export {
  setSessionMeta,
  getSessionMeta,
  deleteSessionMeta,
  getSessionMetaKeys,
  clearSessionMeta,
  clearAllSessionMeta,
  getSessionMetaSnapshot,
} from './runtime/session-meta.js';

export {
  checkRuntimeAvailability,
  waitForRuntimeReady,
  assertRuntimeReady,
} from './runtime/availability.js';
export type { RuntimeAvailabilityResult } from './runtime/availability.js';

export {
  MockAcpRuntime,
  createMockAcpRuntime,
  createMockAcpRuntimeHandle,
  createMockDoctorReport,
} from './runtime/adapter-contract.testkit.js';
export type { MockAcpRuntimeOptions } from './runtime/adapter-contract.testkit.js';

export { createAcpClient } from './client.js';
export type { ClientSideConnection } from './client.js';
export {
  buildServerArgs,
  buildAcpClientStripKeys,
  resolveAcpClientSpawnEnv,
  resolveAcpClientSpawnInvocation,
  resolvePermissionRequest,
} from './client-helpers.js';
export type {
  ResolvePermissionRequestParams,
  RequestPermissionResponse,
} from './client-helpers.js';
export { readSecretFromFile } from './secret-file.js';
export {
  createInMemorySessionStore,
  getDefaultSessionStore,
  resetDefaultSessionStoreForTests,
} from './session.js';
export type { AcpSessionStore } from './session.js';

export {
  createAcpGateway,
  AcpGateway,
  AcpWebSocketServer,
  createAcpWebSocketServer,
} from './server.js';
export type { AgentSideConnection, GatewayClient } from './server.js';
export type { AcpWebSocketServerConfig } from './types.js';
export { AcpGatewayAgent, createAcpGatewayAgent } from './translator.js';
export {
  mapRuntimeEventToGatewayEvent,
  isTerminalGatewayEvent,
} from './event-mapper.js';
export type { GatewayEvent } from './event-mapper.js';
export { getAcpMetaInfo, createCapabilityEntry } from './meta.js';
export type { AcpMetaInfo, AcpCapabilityEntry } from './meta.js';
export {
  mapSessionToInfo,
  mapSessionIdentityToSessionKey,
} from './session-mapper.js';
export type { MappedSessionInfo } from './session-mapper.js';
export {
  resolveInteractionMode,
  interactionModeToString,
} from './session-interaction-mode.js';
export type { InteractionMode } from './session-interaction-mode.js';
export {
  getSupportedCommands,
  findCommandDefinition,
  isSupportedControl,
} from './commands.js';
export type { AcpCommandDefinition } from './commands.js';

export {
  isAcpEnabledByPolicy,
  isAcpAgentAllowedByPolicy,
  resolveAcpDispatchPolicyState,
} from './policy.js';
export type { AcpPolicyConfig, AcpDispatchPolicyState } from './policy.js';
export { classifyAcpToolApproval } from './approval-classifier.js';
export type { ApprovalClassificationInput } from './approval-classifier.js';

export {
  AcpSessionManager,
  createAcpSessionManager,
} from './control-plane/manager.js';
export {
  resolveRuntimeOptions,
  validateRuntimeOption,
} from './control-plane/runtime-options.js';
export type { ResolvedRuntimeOptions } from './control-plane/runtime-options.js';
export {
  SessionActorQueue,
  getSessionActorQueue,
  clearSessionActorQueue,
} from './control-plane/session-actor-queue.js';
export {
  RuntimeCapabilitiesCache,
  NoopRuntimeCapabilitiesCache,
} from './control-plane/runtime-cache.js';
export {
  validateServerOptions,
  hasValidServerOptions,
} from './control-plane/manager.utils.js';
export type {
  AcpSessionManagerConfig,
  AcpSessionManagerState,
  AcpSessionManagerEvents,
} from './control-plane/manager.types.js';

export {
  registerPendingSessionIdentity,
  unregisterPendingSessionIdentity,
  getPendingSessionIdentities,
  clearPendingSessionIdentities,
  reconcilePendingSessionIdentities,
  reconcileAllSessions,
} from './control-plane/manager.identity-reconcile.js';
export type {
  PendingSessionIdentity,
  IdentityReconcileResult,
} from './control-plane/manager.identity-reconcile.js';

export {
  executeRuntimeControl,
  isSupportedRuntimeControl,
  getSupportedRuntimeControls,
  setSessionMode,
  setSessionConfigOption,
  getSessionStatus,
} from './control-plane/manager.runtime-controls.js';
export type {
  RuntimeControlRequest,
  RuntimeControlResult,
} from './control-plane/manager.runtime-controls.js';

export {
  consumeTurnStream,
  collectTurnEvents,
  processTurnEvents,
} from './control-plane/manager.turn-stream.js';
export type {
  TurnStreamHandler,
  TurnStreamResult,
} from './control-plane/manager.turn-stream.js';

export { PersistentBindingLifecycle } from './persistent-bindings/lifecycle.js';
export type { BindingLifecycle } from './persistent-bindings/lifecycle.js';
export {
  resolveBindingConfigToEnsureInput,
  createInitialBindingState,
} from './persistent-bindings/resolve.js';
export type {
  PersistentBindingConfig,
  PersistentBindingState,
} from './persistent-bindings/types.js';
