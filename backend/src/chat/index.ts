export { ChatService, createChatService } from './services/chatService';
export { ChatSession } from './sessions/chatSession';
export { ChatHistory } from './history/chatHistory';
export { ChatMessage, ChatSessionOptions, ChatResponse } from './models/types';

export { AdvancedStreamingProcessor, advancedStreamingProcessor, StreamState } from './streaming/AdvancedStreamingProcessor';
export type { StreamChunk, StreamMetrics, StreamSession, ChunkCallback, CompleteCallback, ErrorCallback, StateChangeCallback, IAdvancedStreamingProcessor } from './streaming/AdvancedStreamingProcessor';

export { SmartToolIntegrator, smartToolIntegrator } from './tool/SmartToolIntegrator';
export type { SmartTool, ToolContext, ToolExecutionResult, ToolUsageMetrics, ToolCompatibilityReport, ISmartToolIntegrator } from './tool/SmartToolIntegrator';

export { CompleteSecuritySystem, completeSecuritySystem, SecurityLevel } from './security/CompleteSecuritySystem';
export type { SecurityCheckResult, AuditRecord, SecurityConfig, SecurityReport, ICompleteSecuritySystem } from './security/CompleteSecuritySystem';

export { ChatEcosystem, chatEcosystem } from './ecosystem/ChatEcosystem';
export type { Extension, ExtensionPoint, ExtensionHandler, EcosystemEvent, EcosystemMetrics, EventListener, IChatEcosystem } from './ecosystem/ChatEcosystem';

export * from './types/message';
export * from './types/session';
export * from './types/tool';
export * from './types/ToolUseBlock';

const chatService = createChatService();
export default chatService;
