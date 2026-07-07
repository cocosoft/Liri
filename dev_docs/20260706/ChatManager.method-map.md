# ChatManager.method-map.md

> 自动生成于 2026-07-07，由 `scripts/generate-method-map.ts` 扫描 AST 生成
> 源文件: [ChatManager.ts](file:///E:/PY/CODES/PY_APP/app/src/chat/ChatManager.ts) — 82 个方法

---

## 职责域分布

| 职责域 | 方法数 |
|--------|:---:|
| 会话管理 | 22 |
| 未分类 | 13 |
| 上下文管理 | 11 |
| LLM调用 | 10 |
| 工具执行 | 7 |
| 消息收发 | 6 |
| 内部辅助 | 5 |
| 安全检查 | 4 |
| Hook链 | 2 |
| 会话记忆 | 1 |
| 任务计划 | 1 |

## 提取可行性统计

- 纯搬: 12 个
- 需参数化: 70 个
- 总计: 82 个

## 完整方法列表

| 方法名 | 行号 | 可见性 | 静态 | 异步 | this 属性 | this 方法调用 | 职责域 | 提取可行性 |
|--------|:---:|:---:|:---:|:---:|----------|------------|--------|-----------|
| `_getLocalSession` | 302 | private |  |  | _chatSessions | — | 内部辅助 | 需参数化(1个): _chatSessions |
| `getSessionMachine` | 311 | private |  |  | sessionMachines | — | 会话管理 | 需参数化(1个): sessionMachines |
| `_addAndPersistMessage` | 330 | private |  |  | _chatSessions, sessionGateway | — | 会话管理 | 需参数化(2个): _chatSessions, sessionGateway |
| `updateMessageBlocks` | 350 | public |  | ✓ | _chatSessions, messageService, sessionGateway | — | 会话管理 | 需参数化(3个): _chatSessions, messageService, sessionGateway |
| `getHookChainManager` | 421 | public |  |  | hookChainManager | — | Hook链 | 需参数化(1个): hookChainManager |
| `getOrAssembleSystemPrompt` | 428 | private |  | ✓ | llmClient, imageContextService | — | LLM调用 | 需参数化(2个): llmClient, imageContextService |
| `_extractCurrentGoal` | 438 | private |  |  | — | — | 上下文管理 | 纯搬 |
| `initialize` | 448 | public |  | ✓ | llmClient, sessionGateway, sessionAccess | _loadSessionsFromGateway | 会话管理 | 需参数化(3个属性 + 1个方法): llmClient, sessionGateway, sessionAccess; 方法: _loadSessionsFromGateway |
| `_loadSessionsFromGateway` | 485 | private |  | ✓ | sessionGateway, _chatSessions, sessionAccess | — | 会话管理 | 需参数化(3个): sessionGateway, _chatSessions, sessionAccess |
| `_sanitizeApiMessages` | 596 | private |  |  | — | — | 上下文管理 | 纯搬 |
| `_truncateApiMessages` | 609 | private |  | ✓ | _chatSessions | — | 上下文管理 | 需参数化(1个): _chatSessions |
| `_compressToolHistory` | 620 | private |  |  | — | — | 上下文管理 | 纯搬 |
| `_persistTurnSummary` | 632 | private |  |  | — | — | 上下文管理 | 纯搬 |
| `cleanup` | 639 | public |  |  | streamService | — | 消息收发 | 需参数化(1个): streamService |
| `sendMessage` | 654 | public |  | ✓ | _currentSessionId, messageService, hookChainManager, llmClient, imageContextService, toolRegistry, pendingInteractions, _executingPlan | _getOrLoadSession, _addAndPersistMessage, getSessionMachine, getClientForModel, _sanitizeApiMessages, getOrAssembleSystemPrompt, _truncateApiMessages, recordChatResponseUsage, extractMemoryFromChat, _startRollbackRound, executeTool, _compressToolHistory, _endRollbackRound, executePlanSteps, _persistTurnSummary, _accumulateSessionMemory, triggerCouncilDebate | 消息收发 | 需参数化(8个属性 + 17个方法): _currentSessionId, messageService, hookChainManager, llmClient, imageContextService, toolRegistry, pendingInteractions, _executingPlan; 方法: _getOrLoadSession, _addAndPersistMessage, getSessionMachine, getClientForModel, _sanitizeApiMessages, getOrAssembleSystemPrompt, _truncateApiMessages, recordChatResponseUsage, extractMemoryFromChat, _startRollbackRound, executeTool, _compressToolHistory, _endRollbackRound, executePlanSteps, _persistTurnSummary, _accumulateSessionMemory, triggerCouncilDebate |
| `triggerCouncilDebate` | 1557 | private |  | ✓ | — | — | Hook链 | 纯搬 |
| `extractMemoryFromChat` | 1573 | private |  | ✓ | — | — | 会话记忆 | 纯搬 |
| `recordChatResponseUsage` | 1602 | private |  |  | tokenTracker | — | 上下文管理 | 需参数化(1个): tokenTracker |
| `executeStepPrompt` | 1612 | private |  | ✓ | messageService, toolRegistry | getClientForModel, _sanitizeApiMessages, getOrAssembleSystemPrompt, buildToolDefinitions, _truncateApiMessages, recordChatResponseUsage, _addAndPersistMessage, _startRollbackRound, executeTool, _compressToolHistory, _endRollbackRound | LLM调用 | 需参数化(2个属性 + 11个方法): messageService, toolRegistry; 方法: getClientForModel, _sanitizeApiMessages, getOrAssembleSystemPrompt, buildToolDefinitions, _truncateApiMessages, recordChatResponseUsage, _addAndPersistMessage, _startRollbackRound, executeTool, _compressToolHistory, _endRollbackRound |
| `executePlanSteps` | 1981 | private |  | ✓ | taskFacade | executeStepPrompt | 任务计划 | 需参数化(1个属性 + 1个方法): taskFacade; 方法: executeStepPrompt |
| `buildToolDefinitions` | 2041 | private |  |  | toolRegistry | — | LLM调用 | 需参数化(1个): toolRegistry |
| `streamMessage` | 2098 | public |  | ✓ | _currentSessionId, hookChainManager, messageService, imageContextService, toolRegistry, llmClient, _pendingInteraction | _getOrLoadSession, _addAndPersistMessage, getSessionMachine, _sanitizeApiMessages, getOrAssembleSystemPrompt, getClientForModel, _truncateApiMessages, recordChatResponseUsage, extractMemoryFromChat, _startRollbackRound, executeTool, _compressToolHistory, _endRollbackRound, _persistTurnSummary, _accumulateSessionMemory | 消息收发 | 需参数化(7个属性 + 15个方法): _currentSessionId, hookChainManager, messageService, imageContextService, toolRegistry, llmClient, _pendingInteraction; 方法: _getOrLoadSession, _addAndPersistMessage, getSessionMachine, _sanitizeApiMessages, getOrAssembleSystemPrompt, getClientForModel, _truncateApiMessages, recordChatResponseUsage, extractMemoryFromChat, _startRollbackRound, executeTool, _compressToolHistory, _endRollbackRound, _persistTurnSummary, _accumulateSessionMemory |
| `resolveInteraction` | 2922 | public |  |  | _pendingInteraction | — | 未分类 | 需参数化(1个): _pendingInteraction |
| `getPendingInteraction` | 2941 | public |  |  | pendingInteractions | — | 未分类 | 需参数化(1个): pendingInteractions |
| `continueInteraction` | 2951 | public |  | ✓ | pendingInteractions, messageService | _getLocalSession, executeTool, _addAndPersistMessage, getLLMClient, recordChatResponseUsage, _compressToolHistory | 消息收发 | 需参数化(2个属性 + 6个方法): pendingInteractions, messageService; 方法: _getLocalSession, executeTool, _addAndPersistMessage, getLLMClient, recordChatResponseUsage, _compressToolHistory |
| `_getRollbackIntegration` | 3204 | private |  |  | rollbackIntegrations, permissionManager | — | 安全检查 | 需参数化(2个): rollbackIntegrations, permissionManager |
| `_startRollbackRound` | 3237 | private |  | ✓ | — | _getRollbackIntegration | 未分类 | 需参数化(0个属性 + 1个方法): ; 方法: _getRollbackIntegration |
| `_endRollbackRound` | 3251 | private |  | ✓ | rollbackIntegrations | — | 安全检查 | 需参数化(1个): rollbackIntegrations |
| `executeTool` | 3266 | public |  | ✓ | permissionManager, rollbackIntegrations, imageContextService, toolRegistry, toolIntegration | — | 工具执行 | 需参数化(5个): permissionManager, rollbackIntegrations, imageContextService, toolRegistry, toolIntegration |
| `createSession` | 3591 | public |  |  | _chatSessions, _currentSessionId, tokenTracker, sessionGateway, hookChainManager, sessionAccess | — | 会话管理 | 需参数化(6个): _chatSessions, _currentSessionId, tokenTracker, sessionGateway, hookChainManager, sessionAccess |
| `_ensureSessionLoaded` | 3656 | private |  | ✓ | _chatSessions, sessionGateway | createSession | 会话管理 | 需参数化(2个属性 + 1个方法): _chatSessions, sessionGateway; 方法: createSession |
| `_getOrLoadSession` | 3734 | private |  | ✓ | _chatSessions, sessionGateway, sessionAccess | createSession | 会话管理 | 需参数化(3个属性 + 1个方法): _chatSessions, sessionGateway, sessionAccess; 方法: createSession |
| `switchSession` | 3827 | public |  | ✓ | _currentSessionId, _sessionLeaveTimes | _ensureSessionLoaded | 会话管理 | 需参数化(2个属性 + 1个方法): _currentSessionId, _sessionLeaveTimes; 方法: _ensureSessionLoaded |
| `getCurrentSession` | 3869 | public |  |  | _currentSessionId | _getLocalSession | 内部辅助 | 需参数化(1个属性 + 1个方法): _currentSessionId; 方法: _getLocalSession |
| `getSessions` | 3877 | public |  |  | _chatSessions | — | 未分类 | 需参数化(1个): _chatSessions |
| `deleteSession` | 3885 | public |  |  | hookChainManager, _chatSessions, _currentSessionId, sessionAccess, sessionGateway | — | 会话管理 | 需参数化(5个): hookChainManager, _chatSessions, _currentSessionId, sessionAccess, sessionGateway |
| `clearAllSessions` | 3912 | public |  | ✓ | _chatSessions, hookChainManager, _currentSessionId, sessionGateway | — | 会话管理 | 需参数化(4个): _chatSessions, hookChainManager, _currentSessionId, sessionGateway |
| `saveSession` | 3935 | public |  | ✓ | _chatSessions | — | 会话管理 | 需参数化(1个): _chatSessions |
| `loadSession` | 3944 | public |  | ✓ | — | _getLocalSession | 会话管理 | 需参数化(0个属性 + 1个方法): ; 方法: _getLocalSession |
| `loadSessions` | 3952 | public |  | ✓ | _chatSessions | — | 会话管理 | 需参数化(1个): _chatSessions |
| `addMessage` | 3961 | public |  |  | — | _addAndPersistMessage | 内部辅助 | 需参数化(0个属性 + 1个方法): ; 方法: _addAndPersistMessage |
| `getSessionMessages` | 3970 | public |  |  | — | _getLocalSession | 内部辅助 | 需参数化(0个属性 + 1个方法): ; 方法: _getLocalSession |
| `searchMessages` | 3981 | public |  |  | messageService, _chatSessions | _getLocalSession | 内部辅助 | 需参数化(2个属性 + 1个方法): messageService, _chatSessions; 方法: _getLocalSession |
| `getMessageService` | 4001 | public |  |  | messageService | — | 未分类 | 需参数化(1个): messageService |
| `getStreamService` | 4009 | public |  |  | streamService | — | 消息收发 | 需参数化(1个): streamService |
| `getSessionGateway` | 4017 | public |  |  | sessionGateway | — | 会话管理 | 需参数化(1个): sessionGateway |
| `getSessionManager` | 4025 | public |  |  | _currentSessionId, _chatSessions, _checkpointService | _getLocalSession, _addAndPersistMessage | 会话管理 | 需参数化(3个属性 + 2个方法): _currentSessionId, _chatSessions, _checkpointService; 方法: _getLocalSession, _addAndPersistMessage |
| `getClientForModel` | 4075 | private |  |  | llmClient, toolRegistry, toolExecutor | — | LLM调用 | 需参数化(3个): llmClient, toolRegistry, toolExecutor |
| `getLLMClient` | 4106 | public |  |  | llmClient | — | LLM调用 | 需参数化(1个): llmClient |
| `getToolIntegration` | 4122 | public |  |  | toolIntegration | — | 工具执行 | 需参数化(1个): toolIntegration |
| `setToolIntegration` | 4130 | public |  |  | toolIntegration | — | 工具执行 | 需参数化(1个): toolIntegration |
| `setLLMClient` | 4138 | public |  |  | llmClient | — | LLM调用 | 需参数化(1个): llmClient |
| `setToolRegistry` | 4146 | public |  |  | toolRegistry | — | 工具执行 | 需参数化(1个): toolRegistry |
| `getToolRegistry` | 4154 | public |  |  | toolRegistry | — | 工具执行 | 需参数化(1个): toolRegistry |
| `setTokenTracker` | 4161 | public |  |  | tokenTracker | — | 上下文管理 | 需参数化(1个): tokenTracker |
| `getTokenTracker` | 4168 | public |  |  | tokenTracker | — | 上下文管理 | 需参数化(1个): tokenTracker |
| `setPermissionManager` | 4176 | public |  |  | permissionManager | — | 安全检查 | 需参数化(1个): permissionManager |
| `getPermissionManager` | 4184 | public |  |  | permissionManager | — | 安全检查 | 需参数化(1个): permissionManager |
| `setToolExecutor` | 4192 | public |  |  | toolExecutor | — | 工具执行 | 需参数化(1个): toolExecutor |
| `getToolExecutor` | 4200 | public |  |  | toolExecutor | — | 工具执行 | 需参数化(1个): toolExecutor |
| `setSubAgentManager` | 4208 | public |  |  | subAgentManager | — | 未分类 | 需参数化(1个): subAgentManager |
| `getSubAgentManager` | 4216 | public |  |  | subAgentManager | — | 未分类 | 需参数化(1个): subAgentManager |
| `getSessionMetadataService` | 4224 | public |  |  | — | — | 未分类 | 纯搬 |
| `getEventNotificationService` | 4232 | public |  |  | — | — | 未分类 | 纯搬 |
| `getMessageProcessingService` | 4240 | public |  |  | — | — | 未分类 | 纯搬 |
| `getPermissionModeIntegrationService` | 4248 | public |  |  | — | — | 未分类 | 纯搬 |
| `getPerformanceOptimizationService` | 4256 | public |  |  | — | — | 未分类 | 纯搬 |
| `getSecurityService` | 4264 | public |  |  | — | — | 未分类 | 纯搬 |
| `getQueryEngine` | 4272 | public |  |  | queryEngine, queryEngineConfig | — | LLM调用 | 需参数化(2个): queryEngine, queryEngineConfig |
| `setQueryEngineConfig` | 4283 | public |  |  | queryEngineConfig, queryEngine | — | LLM调用 | 需参数化(2个): queryEngineConfig, queryEngine |
| `query` | 4296 | public |  | ✓ | queryEngineConfig | getQueryEngine, setQueryEngineConfig, createSession | LLM调用 | 需参数化(1个属性 + 3个方法): queryEngineConfig; 方法: getQueryEngine, setQueryEngineConfig, createSession |
| `getQueryState` | 4347 | public |  |  | queryEngine | — | LLM调用 | 需参数化(1个): queryEngine |
| `streamQuery` | 4360 | public |  | ✓ | queryEngineConfig | getQueryEngine, setQueryEngineConfig, createSession, getQueryState | 消息收发 | 需参数化(1个属性 + 4个方法): queryEngineConfig; 方法: getQueryEngine, setQueryEngineConfig, createSession, getQueryState |
| `checkCompactBoundary` | 4442 | public |  | ✓ | _currentSessionId, compactService | _getLocalSession | 上下文管理 | 需参数化(2个属性 + 1个方法): _currentSessionId, compactService; 方法: _getLocalSession |
| `compactSession` | 4478 | public |  | ✓ | _currentSessionId, compactService | _getLocalSession | 上下文管理 | 需参数化(2个属性 + 1个方法): _currentSessionId, compactService; 方法: _getLocalSession |
| `getCompactService` | 4519 | public |  |  | compactService | — | 上下文管理 | 需参数化(1个): compactService |
| `createCheckpoint` | 4523 | public |  | ✓ | _checkpointService | _getLocalSession | 会话管理 | 需参数化(1个属性 + 1个方法): _checkpointService; 方法: _getLocalSession |
| `listCheckpoints` | 4545 | public |  | ✓ | _checkpointService | — | 会话管理 | 需参数化(1个): _checkpointService |
| `rollbackToCheckpoint` | 4551 | public |  | ✓ | _checkpointService | _getLocalSession, createSession | 会话管理 | 需参数化(1个属性 + 2个方法): _checkpointService; 方法: _getLocalSession, createSession |
| `deleteCheckpoint` | 4586 | public |  | ✓ | _checkpointService | — | 会话管理 | 需参数化(1个): _checkpointService |
| `getLatestCheckpoint` | 4590 | public |  | ✓ | _checkpointService | — | 会话管理 | 需参数化(1个): _checkpointService |
| `_accumulateSessionMemory` | 4600 | private |  |  | sessionAccess, llmClient, _chatSessions | — | 会话管理 | 需参数化(3个): sessionAccess, llmClient, _chatSessions |

## 按职责域分组

### Hook链（2 个方法）

- **`getHookChainManager`** (L421) — 需参数化(1个): hookChainManager — this 属性: hookChainManager
- **`triggerCouncilDebate`** (L1557) — 纯搬

### LLM调用（10 个方法）

- **`getOrAssembleSystemPrompt`** (L428) — 需参数化(2个): llmClient, imageContextService — this 属性: llmClient, imageContextService
- **`executeStepPrompt`** (L1612) — 需参数化(2个属性 + 11个方法): messageService, toolRegistry; 方法: getClientForModel, _sanitizeApiMessages, getOrAssembleSystemPrompt, buildToolDefinitions, _truncateApiMessages, recordChatResponseUsage, _addAndPersistMessage, _startRollbackRound, executeTool, _compressToolHistory, _endRollbackRound — this 属性: messageService, toolRegistry; 内部调用: getClientForModel, _sanitizeApiMessages, getOrAssembleSystemPrompt, buildToolDefinitions, _truncateApiMessages, recordChatResponseUsage, _addAndPersistMessage, _startRollbackRound, executeTool, _compressToolHistory, _endRollbackRound
- **`buildToolDefinitions`** (L2041) — 需参数化(1个): toolRegistry — this 属性: toolRegistry
- **`getClientForModel`** (L4075) — 需参数化(3个): llmClient, toolRegistry, toolExecutor — this 属性: llmClient, toolRegistry, toolExecutor
- **`getLLMClient`** (L4106) — 需参数化(1个): llmClient — this 属性: llmClient
- **`setLLMClient`** (L4138) — 需参数化(1个): llmClient — this 属性: llmClient
- **`getQueryEngine`** (L4272) — 需参数化(2个): queryEngine, queryEngineConfig — this 属性: queryEngine, queryEngineConfig
- **`setQueryEngineConfig`** (L4283) — 需参数化(2个): queryEngineConfig, queryEngine — this 属性: queryEngineConfig, queryEngine
- **`query`** (L4296) — 需参数化(1个属性 + 3个方法): queryEngineConfig; 方法: getQueryEngine, setQueryEngineConfig, createSession — this 属性: queryEngineConfig; 内部调用: getQueryEngine, setQueryEngineConfig, createSession
- **`getQueryState`** (L4347) — 需参数化(1个): queryEngine — this 属性: queryEngine

### 上下文管理（11 个方法）

- **`_extractCurrentGoal`** (L438) — 纯搬
- **`_sanitizeApiMessages`** (L596) — 纯搬
- **`_truncateApiMessages`** (L609) — 需参数化(1个): _chatSessions — this 属性: _chatSessions
- **`_compressToolHistory`** (L620) — 纯搬
- **`_persistTurnSummary`** (L632) — 纯搬
- **`recordChatResponseUsage`** (L1602) — 需参数化(1个): tokenTracker — this 属性: tokenTracker
- **`setTokenTracker`** (L4161) — 需参数化(1个): tokenTracker — this 属性: tokenTracker
- **`getTokenTracker`** (L4168) — 需参数化(1个): tokenTracker — this 属性: tokenTracker
- **`checkCompactBoundary`** (L4442) — 需参数化(2个属性 + 1个方法): _currentSessionId, compactService; 方法: _getLocalSession — this 属性: _currentSessionId, compactService; 内部调用: _getLocalSession
- **`compactSession`** (L4478) — 需参数化(2个属性 + 1个方法): _currentSessionId, compactService; 方法: _getLocalSession — this 属性: _currentSessionId, compactService; 内部调用: _getLocalSession
- **`getCompactService`** (L4519) — 需参数化(1个): compactService — this 属性: compactService

### 任务计划（1 个方法）

- **`executePlanSteps`** (L1981) — 需参数化(1个属性 + 1个方法): taskFacade; 方法: executeStepPrompt — this 属性: taskFacade; 内部调用: executeStepPrompt

### 会话管理（22 个方法）

- **`getSessionMachine`** (L311) — 需参数化(1个): sessionMachines — this 属性: sessionMachines
- **`_addAndPersistMessage`** (L330) — 需参数化(2个): _chatSessions, sessionGateway — this 属性: _chatSessions, sessionGateway
- **`updateMessageBlocks`** (L350) — 需参数化(3个): _chatSessions, messageService, sessionGateway — this 属性: _chatSessions, messageService, sessionGateway
- **`initialize`** (L448) — 需参数化(3个属性 + 1个方法): llmClient, sessionGateway, sessionAccess; 方法: _loadSessionsFromGateway — this 属性: llmClient, sessionGateway, sessionAccess; 内部调用: _loadSessionsFromGateway
- **`_loadSessionsFromGateway`** (L485) — 需参数化(3个): sessionGateway, _chatSessions, sessionAccess — this 属性: sessionGateway, _chatSessions, sessionAccess
- **`createSession`** (L3591) — 需参数化(6个): _chatSessions, _currentSessionId, tokenTracker, sessionGateway, hookChainManager, sessionAccess — this 属性: _chatSessions, _currentSessionId, tokenTracker, sessionGateway, hookChainManager, sessionAccess
- **`_ensureSessionLoaded`** (L3656) — 需参数化(2个属性 + 1个方法): _chatSessions, sessionGateway; 方法: createSession — this 属性: _chatSessions, sessionGateway; 内部调用: createSession
- **`_getOrLoadSession`** (L3734) — 需参数化(3个属性 + 1个方法): _chatSessions, sessionGateway, sessionAccess; 方法: createSession — this 属性: _chatSessions, sessionGateway, sessionAccess; 内部调用: createSession
- **`switchSession`** (L3827) — 需参数化(2个属性 + 1个方法): _currentSessionId, _sessionLeaveTimes; 方法: _ensureSessionLoaded — this 属性: _currentSessionId, _sessionLeaveTimes; 内部调用: _ensureSessionLoaded
- **`deleteSession`** (L3885) — 需参数化(5个): hookChainManager, _chatSessions, _currentSessionId, sessionAccess, sessionGateway — this 属性: hookChainManager, _chatSessions, _currentSessionId, sessionAccess, sessionGateway
- **`clearAllSessions`** (L3912) — 需参数化(4个): _chatSessions, hookChainManager, _currentSessionId, sessionGateway — this 属性: _chatSessions, hookChainManager, _currentSessionId, sessionGateway
- **`saveSession`** (L3935) — 需参数化(1个): _chatSessions — this 属性: _chatSessions
- **`loadSession`** (L3944) — 需参数化(0个属性 + 1个方法): ; 方法: _getLocalSession — 内部调用: _getLocalSession
- **`loadSessions`** (L3952) — 需参数化(1个): _chatSessions — this 属性: _chatSessions
- **`getSessionGateway`** (L4017) — 需参数化(1个): sessionGateway — this 属性: sessionGateway
- **`getSessionManager`** (L4025) — 需参数化(3个属性 + 2个方法): _currentSessionId, _chatSessions, _checkpointService; 方法: _getLocalSession, _addAndPersistMessage — this 属性: _currentSessionId, _chatSessions, _checkpointService; 内部调用: _getLocalSession, _addAndPersistMessage
- **`createCheckpoint`** (L4523) — 需参数化(1个属性 + 1个方法): _checkpointService; 方法: _getLocalSession — this 属性: _checkpointService; 内部调用: _getLocalSession
- **`listCheckpoints`** (L4545) — 需参数化(1个): _checkpointService — this 属性: _checkpointService
- **`rollbackToCheckpoint`** (L4551) — 需参数化(1个属性 + 2个方法): _checkpointService; 方法: _getLocalSession, createSession — this 属性: _checkpointService; 内部调用: _getLocalSession, createSession
- **`deleteCheckpoint`** (L4586) — 需参数化(1个): _checkpointService — this 属性: _checkpointService
- **`getLatestCheckpoint`** (L4590) — 需参数化(1个): _checkpointService — this 属性: _checkpointService
- **`_accumulateSessionMemory`** (L4600) — 需参数化(3个): sessionAccess, llmClient, _chatSessions — this 属性: sessionAccess, llmClient, _chatSessions

### 会话记忆（1 个方法）

- **`extractMemoryFromChat`** (L1573) — 纯搬

### 内部辅助（5 个方法）

- **`_getLocalSession`** (L302) — 需参数化(1个): _chatSessions — this 属性: _chatSessions
- **`getCurrentSession`** (L3869) — 需参数化(1个属性 + 1个方法): _currentSessionId; 方法: _getLocalSession — this 属性: _currentSessionId; 内部调用: _getLocalSession
- **`addMessage`** (L3961) — 需参数化(0个属性 + 1个方法): ; 方法: _addAndPersistMessage — 内部调用: _addAndPersistMessage
- **`getSessionMessages`** (L3970) — 需参数化(0个属性 + 1个方法): ; 方法: _getLocalSession — 内部调用: _getLocalSession
- **`searchMessages`** (L3981) — 需参数化(2个属性 + 1个方法): messageService, _chatSessions; 方法: _getLocalSession — this 属性: messageService, _chatSessions; 内部调用: _getLocalSession

### 安全检查（4 个方法）

- **`_getRollbackIntegration`** (L3204) — 需参数化(2个): rollbackIntegrations, permissionManager — this 属性: rollbackIntegrations, permissionManager
- **`_endRollbackRound`** (L3251) — 需参数化(1个): rollbackIntegrations — this 属性: rollbackIntegrations
- **`setPermissionManager`** (L4176) — 需参数化(1个): permissionManager — this 属性: permissionManager
- **`getPermissionManager`** (L4184) — 需参数化(1个): permissionManager — this 属性: permissionManager

### 工具执行（7 个方法）

- **`executeTool`** (L3266) — 需参数化(5个): permissionManager, rollbackIntegrations, imageContextService, toolRegistry, toolIntegration — this 属性: permissionManager, rollbackIntegrations, imageContextService, toolRegistry, toolIntegration
- **`getToolIntegration`** (L4122) — 需参数化(1个): toolIntegration — this 属性: toolIntegration
- **`setToolIntegration`** (L4130) — 需参数化(1个): toolIntegration — this 属性: toolIntegration
- **`setToolRegistry`** (L4146) — 需参数化(1个): toolRegistry — this 属性: toolRegistry
- **`getToolRegistry`** (L4154) — 需参数化(1个): toolRegistry — this 属性: toolRegistry
- **`setToolExecutor`** (L4192) — 需参数化(1个): toolExecutor — this 属性: toolExecutor
- **`getToolExecutor`** (L4200) — 需参数化(1个): toolExecutor — this 属性: toolExecutor

### 未分类（13 个方法）

- **`resolveInteraction`** (L2922) — 需参数化(1个): _pendingInteraction — this 属性: _pendingInteraction
- **`getPendingInteraction`** (L2941) — 需参数化(1个): pendingInteractions — this 属性: pendingInteractions
- **`_startRollbackRound`** (L3237) — 需参数化(0个属性 + 1个方法): ; 方法: _getRollbackIntegration — 内部调用: _getRollbackIntegration
- **`getSessions`** (L3877) — 需参数化(1个): _chatSessions — this 属性: _chatSessions
- **`getMessageService`** (L4001) — 需参数化(1个): messageService — this 属性: messageService
- **`setSubAgentManager`** (L4208) — 需参数化(1个): subAgentManager — this 属性: subAgentManager
- **`getSubAgentManager`** (L4216) — 需参数化(1个): subAgentManager — this 属性: subAgentManager
- **`getSessionMetadataService`** (L4224) — 纯搬
- **`getEventNotificationService`** (L4232) — 纯搬
- **`getMessageProcessingService`** (L4240) — 纯搬
- **`getPermissionModeIntegrationService`** (L4248) — 纯搬
- **`getPerformanceOptimizationService`** (L4256) — 纯搬
- **`getSecurityService`** (L4264) — 纯搬

### 消息收发（6 个方法）

- **`cleanup`** (L639) — 需参数化(1个): streamService — this 属性: streamService
- **`sendMessage`** (L654) — 需参数化(8个属性 + 17个方法): _currentSessionId, messageService, hookChainManager, llmClient, imageContextService, toolRegistry, pendingInteractions, _executingPlan; 方法: _getOrLoadSession, _addAndPersistMessage, getSessionMachine, getClientForModel, _sanitizeApiMessages, getOrAssembleSystemPrompt, _truncateApiMessages, recordChatResponseUsage, extractMemoryFromChat, _startRollbackRound, executeTool, _compressToolHistory, _endRollbackRound, executePlanSteps, _persistTurnSummary, _accumulateSessionMemory, triggerCouncilDebate — this 属性: _currentSessionId, messageService, hookChainManager, llmClient, imageContextService, toolRegistry, pendingInteractions, _executingPlan; 内部调用: _getOrLoadSession, _addAndPersistMessage, getSessionMachine, getClientForModel, _sanitizeApiMessages, getOrAssembleSystemPrompt, _truncateApiMessages, recordChatResponseUsage, extractMemoryFromChat, _startRollbackRound, executeTool, _compressToolHistory, _endRollbackRound, executePlanSteps, _persistTurnSummary, _accumulateSessionMemory, triggerCouncilDebate
- **`streamMessage`** (L2098) — 需参数化(7个属性 + 15个方法): _currentSessionId, hookChainManager, messageService, imageContextService, toolRegistry, llmClient, _pendingInteraction; 方法: _getOrLoadSession, _addAndPersistMessage, getSessionMachine, _sanitizeApiMessages, getOrAssembleSystemPrompt, getClientForModel, _truncateApiMessages, recordChatResponseUsage, extractMemoryFromChat, _startRollbackRound, executeTool, _compressToolHistory, _endRollbackRound, _persistTurnSummary, _accumulateSessionMemory — this 属性: _currentSessionId, hookChainManager, messageService, imageContextService, toolRegistry, llmClient, _pendingInteraction; 内部调用: _getOrLoadSession, _addAndPersistMessage, getSessionMachine, _sanitizeApiMessages, getOrAssembleSystemPrompt, getClientForModel, _truncateApiMessages, recordChatResponseUsage, extractMemoryFromChat, _startRollbackRound, executeTool, _compressToolHistory, _endRollbackRound, _persistTurnSummary, _accumulateSessionMemory
- **`continueInteraction`** (L2951) — 需参数化(2个属性 + 6个方法): pendingInteractions, messageService; 方法: _getLocalSession, executeTool, _addAndPersistMessage, getLLMClient, recordChatResponseUsage, _compressToolHistory — this 属性: pendingInteractions, messageService; 内部调用: _getLocalSession, executeTool, _addAndPersistMessage, getLLMClient, recordChatResponseUsage, _compressToolHistory
- **`getStreamService`** (L4009) — 需参数化(1个): streamService — this 属性: streamService
- **`streamQuery`** (L4360) — 需参数化(1个属性 + 4个方法): queryEngineConfig; 方法: getQueryEngine, setQueryEngineConfig, createSession, getQueryState — this 属性: queryEngineConfig; 内部调用: getQueryEngine, setQueryEngineConfig, createSession, getQueryState
