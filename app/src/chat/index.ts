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
export type { ChatService } from '../chat/models/types';
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
export type { SessionState } from './types/session';
export type { ToolCall, ToolResult } from './types/tool';
export type { ToolUseBlock } from './types/ToolUseBlock';

const chatService = createChatService();
export default chatService;
