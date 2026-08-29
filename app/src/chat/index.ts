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
//
import { createChatService } from './services/chatService';
export { createChatService };
export type { ChatService } from './models/types';

// ChatManager 核心导出
export { createChatManager } from './ChatManager';
export type { ChatManager } from './ChatManagerInterface';
export { ChatSession } from './sessions/chatSession';
export { ChatHistory } from './history/chatHistory';
export type { ChatMessage, ChatSessionOptions } from './models/types';

export {
  AdvancedStreamingProcessor,
  advancedStreamingProcessor,
  StreamState,
} from './streaming/AdvancedStreamingProcessor';
export type {
  StreamChunk,
  StreamMetrics,
  StreamSession,
  ChunkCallback,
  CompleteCallback,
  ErrorCallback,
  StateChangeCallback,
  IAdvancedStreamingProcessor,
} from './streaming/AdvancedStreamingProcessor';

export {
  SmartToolIntegrator,
  smartToolIntegrator,
} from './tool/SmartToolIntegrator';
export type {
  SmartTool,
  ToolContext,
  ToolExecutionResult,
  ToolUsageMetrics,
  ToolCompatibilityReport,
  ISmartToolIntegrator,
} from './tool/SmartToolIntegrator';

export {
  CompleteSecuritySystem,
  completeSecuritySystem,
  SecurityLevel,
} from './security/CompleteSecuritySystem';
export type {
  SecurityCheckResult,
  AuditRecord,
  SecurityConfig,
  SecurityReport,
  ICompleteSecuritySystem,
} from './security/CompleteSecuritySystem';

export { ChatEcosystem, chatEcosystem } from './ecosystem/ChatEcosystem';
export type {
  Extension,
  ExtensionPoint,
  ExtensionHandler,
  EcosystemEvent,
  EcosystemMetrics,
  EventListener,
  IChatEcosystem,
} from './ecosystem/ChatEcosystem';

export { MessageQueue } from './services/MessageQueue.js';
export type { MessageQueueStats } from './services/MessageQueue.js';
export { DeliveryRouter } from './services/DeliveryRouter.js';
export type {
  DeliveryRouterConfig,
  DeliveryResult,
  DeliveryRouterStats,
} from './services/DeliveryRouter.js';

// 导出类型
export type { Message, ContentBlock } from './types/message';
export type { DataSessionStatus } from './types/session';
export type { ToolCall, ToolResult } from './types/tool';
export type { ToolUseBlock } from './types/ToolUseBlock';

const chatService = createChatService();
export default chatService;

export * from './ChatManagerInterface.js';

// 2026-08-30 R03-002 收敛：services / utils 子路径统一出口
export {
  EventNotificationService,
  eventNotificationService,
  EventType,
} from './services/EventNotificationService';
export type {
  EventData,
  EventListener as EventNotificationListener,
} from './services/EventNotificationService';
export {
  PermissionModeIntegrationService,
  permissionModeIntegrationService,
} from './services/PermissionModeIntegrationService';
export type { PermissionModeChangedEvent } from './services/PermissionModeIntegrationService';
export {
  SessionCheckpointService,
  getCheckpointService,
  createCheckpointService,
} from './services/SessionCheckpointService';
export {
  MessageServiceImpl,
  createMessageService,
} from './services/MessageService';
export type { MessageService } from './services/MessageService';
export { ImageDownloader, imageDownloader } from './services/ImageDownloader';
export type {
  ImageDownloadResult,
  ImageDownloadConfig,
} from './services/ImageDownloader';
export { computeUnifiedDiff } from './utils/unifiedDiff';
export type { FileDiffResult } from './utils/unifiedDiff';
export {
  dedupeToolCallBlocks,
  dedupeMessagesToolCallBlocks,
} from './utils/chatBlocks';
