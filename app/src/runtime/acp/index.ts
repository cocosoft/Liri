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
 * ACP (Agent Communication Protocol) 旧入口
 *
 * @deprecated 请使用 @modules/acp（新 ACP 协议模块）
 * 旧文件保留供存量代码引用，新代码禁止新增对此路径的依赖。
 */

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
  buildServerArgs,
  buildAcpClientStripKeys,
  resolveAcpClientSpawnEnv,
  resolveAcpClientSpawnInvocation,
  resolvePermissionRequest,
  interactionModeToString,
  mapSessionIdentityToSessionKey,
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
} from '@modules/acp/index.js';
