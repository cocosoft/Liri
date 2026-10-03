/**
 * 会话记忆端口（SessionMemoryPort）
 *
 * T-①07（A5 记忆分层收敛）**T1-4 · 方案①**：会话记忆是**独立的域** —— 其方法面（记忆文件的
 * 逐轮累计/阈值判断/提炼落盘/检索）与记忆条目域的四端口（`memory/ports/MemoryPort.ts`）
 * **零交集**，故为会话域**另立本端口**（而不是硬塞进那四个端口）。
 *
 * 实现者：`session/memory/SessionMemoryManager.ts`（本目录）。
 * 已知消费方：`chat/services/SessionMemoryManager.ts`（chat 层编排，经
 * `SessionAccessFacade.getMemoryManager()` 调 `loadMemory`/`initMemory`/`accumulateTurn`/`readRawMemory`）、
 * `chat/ChatManager.ts:2604`（`getMemoryContext`）。
 *
 * **纳入判据**：实现类真实具备、且构成"会话记忆对外能力"的公共方法。
 * **不纳入（如实记录）**：
 * - `shouldExtract`：内部阈值启发式，其结论已由 `accumulateTurn()` 返回的 `shouldTrigger` 表达；
 * - `extractPerTurn`：D-222 记录为"全仓零外部调用方"，且其入参为文件内自持的最小结构契约；
 * - `getMemoryPath`：文件路径属实现细节（当前仅实现内部与文件 I/O 使用）；
 * - 私有方法（`_appendToMemoryFile` / `_ensureMemoryFileSize` / `_compactMemoryFile` / `keywordSearch` /
 *   `ensureIndexed` / `cosineSimilarity` / `isMemoryItemType` / `parseMemoryMarkdown` /
 *   `buildMemoryMarkdown` / `buildMemoryContextText`）。
 *
 * ⚠️ **类型方向（已知 · 可接受）**：本文件用 `import type` 从实现模块取 `SessionMemory` /
 * `MemoryItem` / `ExtractionInput`（三者声明在实现文件内）。`import type` 编译后擦除、不构成运行时环；
 * 若后续要把三者下沉到 `session/memory/types.ts`（使端口不再依赖实现模块），可单列一步。
 *
 * 硬约束（spec §4）：本端口**不得**把任何调用改成异步化 —— `getSessionMemoryManager()` 是
 * **同步懒初始化**（`session/bootstrap/SessionSystemBootstrap.ts:16,50`），故 `accumulateTurn` /
 * `appendToMemory` / `getMemoryContext` / `readRawMemory` / `writeRawMemory` 保持**同步**签名。
 */
import type {
  ExtractionInput,
  MemoryItem,
  SessionMemory,
} from './SessionMemoryManager';

export interface SessionMemoryPort {
  /** 读取会话记忆 */
  loadMemory(sessionId: string): SessionMemory;

  /** 初始化会话记忆 */
  initMemory(sessionId: string): SessionMemory;

  /**
   * 累计本轮数据（token / 工具调用）并判断是否达到提炼阈值。
   * 注意：本方法**不触发**提炼，仅把判断结论作为 `shouldTrigger` 返回给调用方。
   */
  accumulateTurn(
    memory: SessionMemory,
    input: ExtractionInput
  ): { memory: SessionMemory; shouldTrigger: boolean };

  /** 把提炼结果追加进会话记忆，返回更新后的记忆 */
  appendToMemory(memory: SessionMemory, newItems: MemoryItem[]): SessionMemory;

  /** 生成用于注入提示词的记忆上下文文本 */
  getMemoryContext(sessionId: string): string;

  /**
   * 检索会话记忆项。
   * @param topK 返回条数上限（实现侧默认 5）
   */
  searchMemory(
    sessionId: string,
    query: string,
    topK?: number
  ): Promise<MemoryItem[]>;

  /** 批量索引记忆项（供检索使用） */
  indexMemoryItems(sessionId: string, items: MemoryItem[]): Promise<void>;

  /** 读取会话记忆原文 */
  readRawMemory(sessionId: string): string | null;

  /** 覆写会话记忆原文 */
  writeRawMemory(sessionId: string, content: string): void;
}
