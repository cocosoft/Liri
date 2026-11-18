/**
 * @owner chat/ChatManager（自 2026-07-13，原属于 query/TAORLoop）
 *
 * Token 预算的**查询层类型契约**（参考 CC 源码 cc_code/query/tokenBudget.ts）。
 *
 * ⚠️ 2026-10-06（P2-8 ② 死代码清偿）：本文件原有的 **`TokenBudgetManagerImpl` 实现类
 * 已删除** —— 它是 `TokenBudgetController`（`tokenBudget/`，329 行，最成熟实现）的
 * 冗余重复实现，**全仓零实例化/零导入**（唯一实例化点为其自身的工厂函数
 * `createTokenBudgetManager`，该工厂亦零消费者）；`tokenBudget/TokenBudgetController.ts`
 * 的 Phase D 计划早已记载「删除 services/TokenBudgetManager + query/TokenBudgetManagerImpl」。
 * 同批一并删除的文件内孤儿：`lazyInitNative` / `MODEL_FAMILY_HEURISTICS`（后者含
 * `claude` 模型名硬编码，违反 `model-usage.md`）。
 * 本文件**保留类型契约**（`TokenBudgetStatus` / `TokenBudgetConfig` / `TokenBudgetState` /
 * `TokenBudgetManager`），供 `query/index.ts` 的 legacy 类型再导出使用。
 */

export enum TokenBudgetStatus {
  NORMAL = 'normal',
  WARNING = 'warning',
  CRITICAL = 'critical',
  EXCEEDED = 'exceeded',
}

export interface TokenBudgetConfig {
  maxTokens: number;
  maxOutputTokens: number;
  warningThreshold: number;
  criticalThreshold: number;
  budgetRefreshIntervalMs: number;
  enableCompression: boolean;
  modelName: string;
}

export interface TokenBudgetState {
  status: TokenBudgetStatus;
  currentTokens: number;
  maxTokens: number;
  maxOutputTokens: number;
  percentUsed: number;
  isWarning: boolean;
  isCritical: boolean;
  remainingTokens: number;
  remainingOutputTokens: number;
  resetAt: number;
  totalTokensUsed: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalOutputTokensUsed: number;
  messagesProcessed: number;
  shouldCompact: boolean;
  modelName: string;
  warningMessage?: string;
}

export interface TokenBudgetManager {
  getCurrentBudgetState(): TokenBudgetState;
  consumeTokens(tokens: number): void;
  consumeOutputTokens(tokens: number): void;
  resetBudget(): void;
  checkBudget(): TokenBudgetStatus;
  estimateMessageTokens(content: string): number;
  canSendMessage(content: string): boolean;
  canSendOutput(tokens: number): boolean;
  getCompressionLevel(): 0 | 1 | 2 | 3;
  setModel(modelName: string): void;
  getModelName(): string;
  /** Phase 3: 递减回报检测 */
  checkDecliningReturn(): { isDeclining: boolean; consecutiveLowTurns: number };
  /** Phase 3: 是否允许 grace call */
  canUseGraceCall(): boolean;
  /** Phase 3: 使用 grace call */
  useGraceCall(): void;
}
