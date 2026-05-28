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
/**
 * ACP 协议入口（向后兼容层）
 *
 * 新代码请直接使用 @modules/acp，本文件仅作为存量兼容保留。
 *
 * @deprecated 请使用 @modules/acp
 */

// ── 新的核心类型和函数（来自 @modules/acp） ──
export {
  ACP_PROTOCOL_VERSION,
  ACP_SESSION_ID_PREFIX,
  ACP_PROVENANCE_MODE_VALUES,
  ACP_AGENT_INFO,
  normalizeText,
  isBlank,
  truncateText,
  createSharedRecord,
  generateSessionId,
  isValidSessionId,
  createAcpClient,
  readSecretFromFile,
  createInMemorySessionStore,
  getDefaultSessionStore,
  createAcpGateway,
  AcpGateway,
  AcpGatewayAgent,
  createAcpGatewayAgent,
  mapRuntimeEventToGatewayEvent,
  isTerminalGatewayEvent,
  getAcpMetaInfo,
  createCapabilityEntry,
  mapSessionToInfo,
  resolveInteractionMode,
  getSupportedCommands,
  findCommandDefinition,
  isSupportedControl,
  isAcpEnabledByPolicy,
  isAcpAgentAllowedByPolicy,
  resolveAcpDispatchPolicyState,
  classifyAcpToolApproval,
  AcpSessionManager,
  createAcpSessionManager,
  resolveRuntimeOptions,
  validateRuntimeOption,
  SessionActorQueue,
  getSessionActorQueue,
  clearSessionActorQueue,
  RuntimeCapabilitiesCache,
  NoopRuntimeCapabilitiesCache,
  validateServerOptions,
  hasValidServerOptions,
  PersistentBindingLifecycle,
  resolveBindingConfigToEnsureInput,
  createInitialBindingState,
  AcpRuntimeError,
  isAcpRuntimeError,
  toAcpRuntimeError,
  AcpRuntimeRegistry,
  getAcpRuntimeRegistry,
  formatSessionIdentity,
  parseSessionIdentity,
  createSessionIdentity,
  buildServerArgs,
  buildAcpClientStripKeys,
  resolveAcpClientSpawnEnv,
  resolveAcpClientSpawnInvocation,
  resolvePermissionRequest,
  interactionModeToString,
  mapSessionIdentityToSessionKey,
  setSessionMeta,
  getSessionMeta,
  deleteSessionMeta,
  getSessionMetaKeys,
  clearSessionMeta,
  clearAllSessionMeta,
  getSessionMetaSnapshot,
  generateRuntimeSessionName,
  isValidRuntimeSessionName,
  formatSessionIdentifier,
  parseSessionIdentifier,
  checkRuntimeAvailability,
  waitForRuntimeReady,
  assertRuntimeReady,
  MockAcpRuntime,
  createMockAcpRuntime,
  createMockAcpRuntimeHandle,
  createMockDoctorReport,
  registerPendingSessionIdentity,
  unregisterPendingSessionIdentity,
  getPendingSessionIdentities,
  clearPendingSessionIdentities,
  reconcilePendingSessionIdentities,
  reconcileAllSessions,
  executeRuntimeControl,
  isSupportedRuntimeControl,
  getSupportedRuntimeControls,
  setSessionMode,
  setSessionConfigOption,
  getSessionStatus,
  consumeTurnStream,
  collectTurnEvents,
  processTurnEvents,
} from '@modules/acp/index.js';

import type {
  AcpApprovalClass,
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpSessionStore,
} from '@modules/acp/index.js';

export type {
  AcpProvenanceMode,
  SessionId,
  AcpSession,
  AcpServerOptions,
  AcpClientOptions,
  AcpClientHandle,
  AcpApprovalClass,
  SharedRecord,
  AcpRuntimeErrorCode,
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
  AcpRuntimeRegistration,
  AcpSessionIdentity,
  ClientSideConnection,
  ResolvePermissionRequestParams,
  RequestPermissionResponse,
  AcpSessionStore,
  AgentSideConnection,
  GatewayClient,
  GatewayEvent,
  AcpMetaInfo,
  AcpCapabilityEntry,
  MappedSessionInfo,
  InteractionMode,
  AcpCommandDefinition,
  AcpPolicyConfig,
  AcpDispatchPolicyState,
  ApprovalClassificationInput,
  ResolvedRuntimeOptions,
  AcpSessionManagerConfig,
  AcpSessionManagerState,
  AcpSessionManagerEvents,
  BindingLifecycle,
  PersistentBindingConfig,
  PersistentBindingState,
  RuntimeAvailabilityResult,
  MockAcpRuntimeOptions,
  PendingSessionIdentity,
  IdentityReconcileResult,
  RuntimeControlRequest,
  RuntimeControlResult,
  TurnStreamHandler,
  TurnStreamResult,
} from '@modules/acp/index.js';

// ── 向后兼容的类型别名 ──

/** @deprecated 使用 AcpApprovalClass */
export type AcpPermissionLevel = AcpApprovalClass;

/** @deprecated 使用 AcpRuntimeEvent */
export type AcpTransportEvent = AcpRuntimeEvent;

/** @deprecated 使用 AcpRuntimeHandle */
export type AcpTransportHandle = AcpRuntimeHandle;

/** @deprecated 使用 AcpSessionStore */
export type AcpStorage = AcpSessionStore;
