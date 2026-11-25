import {
  ensureDir,
  resolveDataDir,
  resolveTeamMemoryDir,
} from '@openliri/infra/environment';
import { configManager } from '@openliri/infra/config';
import type { Memory, MemoryStats } from './types/Memory';
import { createMemory } from './types/Memory';
// T-①07（A5 记忆分层收敛）T1-2：声明实现四个窄端口（`memory/ports/MemoryPort.ts`）。
// 端口只覆盖本类**真实具备**的能力；本类中不属端口的能力（团队记忆／PYApp 集成／provider／
// 内部访问器等）不受影响。见 .trae/specs/memory-port-unification.md。
import type {
  MemoryReadPort,
  MemoryWritePort,
  MemorySearchPort,
  MemoryForgetPort,
} from './ports/MemoryPort';
import {
  validateMemoryId,
  validateMemoryPath,
  MemoryStoreImpl,
  MemoryStore,
} from './stores/MemoryStore';
import { MemoryScannerImpl } from './scanners/MemoryScanner';
import { MemoryRetrieverImpl } from './retrievers/MemoryRetriever';
import { MemoryType } from './types/MemoryType';
import {
  MemoryPromptService,
  MemoryPrompt,
} from './services/MemoryPromptService';
import {
  AutoMemoryService,
  AutoMemoryConfig,
} from './services/AutoMemoryService';
import {
  TeamMemoryService,
  TeamMemoryConfig,
  TeamMemorySyncStatus,
  TeamMemorySyncRecord,
} from './services/TeamMemoryService';
import {
  PYAppIntegrationService,
  PYAppConfig,
  Rule,
  Preference,
} from './services/PYAppIntegrationService';
import { join } from 'path';
import * as fs from 'fs';
import { AppError, ErrorCategory, ErrorSeverity } from '@openliri/infra/error';
import type { MemoryProvider } from './MemoryProvider';
import { memoryRelationGraph } from './utils/MemoryRelationGraph';
import { writeFileAtomic } from '@openliri/infra/utils/atomicFileWrite';
import { MemoryConsolidator } from './consolidation/MemoryConsolidator';
import { rebuildMemoryWiki } from './services/MemoryWikiService';
import {
  appendTeamSyncHistory,
  buildTeamConflictCandidates,
  pullTeamMemoriesFromSharedDir,
  pushTeamMemoriesToSharedDir,
} from './services/TeamMemorySharedDirSync';
import { isTeamMemorySyncEnabled } from './services/TeamMemorySyncService';
import {
  MemoryConflictDetector,
  type ConflictResult,
} from './consolidation/MemoryConflictDetector';
import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error';
// D-146（2026-10-01）：`trackUsage` 改经 core SPI（`infra -> app` 倒挂收口）
import { resolveAiAccess } from '@openliri/kernel/spi';
import { createHash } from 'crypto';
import {
  encodePayload,
  decodePayload,
} from '@openliri/infra/utils/MemoryFileEnvelope';

// P2-6: LLM 精选记忆检索
import {
  buildSelectionPrompt,
  parseSelectionResult,
  applySelection,
  type MemoryItem,
} from './MemoryLLMSelector';

const logger = getLogger('memory:memoryManager');

/**
 * 记忆管理器接口
 */
export interface MemoryManager {
  // 创建记忆
  createMemory(
    memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Memory>;

  // 获取记忆
  getMemory(id: string): Promise<Memory | null>;

  // 更新记忆
  updateMemory(id: string, updates: Partial<Memory>): Promise<Memory>;

  // 删除记忆
  deleteMemory(id: string): Promise<void>;

  // 检索相关记忆
  getRelevantMemories(query: string, limit?: number): Promise<Memory[]>;

  // 获取所有记忆
  getAllMemories(): Promise<Memory[]>;

  // 获取记忆统计信息
  getMemoryStats(): Promise<MemoryStats>;

  // 自动创建记忆（从聊天）
  createMemoryFromChat(
    messages: unknown[],
    name?: string,
    type?: string
  ): Promise<Memory>;

  // 团队记忆管理
  getTeamMemories(teamId: string): Promise<Memory[]>;
  createTeamMemory(
    teamId: string,
    memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Memory>;

  // 记忆老化管理
  cleanupExpiredMemories(): Promise<number>;
  setMemoryExpiry(id: string, expiresAt: Date): Promise<Memory>;

  // 语义搜索
  searchMemoriesBySemantic(query: string, limit?: number): Promise<Memory[]>;
  searchMemoriesByTags(tags: string[], limit?: number): Promise<Memory[]>;

  // 记忆提示系统
  generateMemoryPrompts(context?: {
    userActions?: string[];
    recentMemories?: Memory[];
    currentTask?: string;
    query?: string;
  }): Promise<MemoryPrompt[]>;
  getMemoryUsageStats(): Promise<{
    totalMemories: number;
    memoryTypes: Record<MemoryType, number>;
    recentMemories: number;
    averageMemorySize: number;
  }>;

  // 自动记忆功能
  processConversation(
    conversationId: string,
    messages: Array<{
      role: string;
      content: string;
      timestamp: Date;
    }>
  ): Promise<Memory[]>;
  setAutoMemoryConfig(config: Partial<AutoMemoryConfig>): void;
  getAutoMemoryConfig(): AutoMemoryConfig;
  clearConversationMemory(conversationId: string): void;
  clearAllConversationMemories(): void;

  // 团队记忆功能
  createTeamMemory(
    memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Memory>;
  getTeamMemories(): Promise<Memory[]>;
  updateTeamMemory(id: string, updates: Partial<Memory>): Promise<Memory>;
  deleteTeamMemory(id: string): Promise<void>;
  setTeamMemoryConfig(config: Partial<TeamMemoryConfig>): void;
  getTeamMemoryConfig(): TeamMemoryConfig;
  getTeamMemorySyncStatus(): TeamMemorySyncStatus;
  getTeamMemoryLastSyncTime(): Date | null;
  getTeamMemorySyncRecords(limit?: number): TeamMemorySyncRecord[];
  triggerTeamMemorySync(): Promise<TeamMemorySyncRecord>;

  // 外部提供者管理
  addProvider(provider: MemoryProvider): Promise<void>;
  getProvider(): MemoryProvider | null;
  removeProvider(): void;

  // Liri.md集成功能
  initializePYAppIntegration(): Promise<void>;
  getPYAppConfig(): PYAppConfig | null;
  getPYAppRules(): Rule[];
  getPYAppRulesByCategory(category: string): Rule[];
  getPYAppRulesByPriority(priority: 'high' | 'medium' | 'low'): Rule[];
  getPYAppPreferences(): Preference[];
  getPYAppPreference(key: string): Preference | undefined;
  getPYAppPreferenceValue(key: string, defaultValue?: unknown): unknown;
  getPYAppRulesText(): string;
  checkPYAppChanges(): Promise<boolean>;
  addPYAppChangeListener(listener: (config: PYAppConfig) => void): void;
  removePYAppChangeListener(listener: (config: PYAppConfig) => void): void;
}

/**
 * 记忆库保留上限（D5-B 护栏，见 `.trae/specs/memory-dedup-blocking-rootfix.md` §D5）。
 *
 * 实测库规模 644 条（2026-09-28）⇒ 短期不触发；超限时按下方淘汰序**归档**（软停用）到 `.trash`。
 * 未做 env/配置开关：§1.4 的环境变量前缀表未含 `MEMORY_*`，护栏也无需运行期调参（有需要再按规范加）。
 */
const MEMORY_MAX_COUNT = 1000;

/**
 * 保留上限的生效开关（P0-2，2026-11-25）。
 *
 * 默认 `false` = dry-run：只报告 + 落 `retention-report.json`，**不移动任何记忆**；
 * 在 `config.json` 设 `memory.retention.enforce = true` 才真归档到 `.trash`。
 */
const MEMORY_RETENTION_ENFORCE_KEY = 'memory.retention.enforce';

function isRetentionEnforced(): boolean {
  return (
    configManager.getValue<boolean>(MEMORY_RETENTION_ENFORCE_KEY, false) === true
  );
}

/**
 * 冲突样本上限（U3，`.trae/specs/memory-conflict-detection.md` D5）。
 *
 * 返回值与日志**只带前 N 条**样本（含 `subject`/双方 id/`confidence`，**不含完整正文**）
 * ⇒ 大库多报时不会造成日志/返回值膨胀。
 */
const CONFLICT_SAMPLE_LIMIT = 5;

/** 冲突候选落盘上限（P0-2，2026-11-25）：只保留前 N 条，避免大库把候选文件撑大 */
const MAX_CONFLICT_CANDIDATES = 200;

/** Validate 单次采样上限（P2-1，2026-11-25）：空闲期不做过重扫描 */
const MAX_VALIDATION_SAMPLES = 5;

/** 证据探测最小长度（过短的 probe 容易误判） */
const MIN_VALIDATION_PROBE_LENGTH = 8;

/** 原始会话证据条目（最小结构，避免 infra 依赖会话层类型） */
export interface MemoryEvidenceEntry {
  role?: string;
  content?: unknown;
}

/**
 * 原始会话证据提供者（P2-1 Validate，2026-11-25）：由 app 侧注入
 * （经会话网关 `searchTranscript`），infra 不直连会话层。
 */
export type MemoryEvidenceProvider = (
  sessionId: string,
  query: string
) => Promise<MemoryEvidenceEntry[]>;

let evidenceProvider: MemoryEvidenceProvider | null = null;

/** 注册/清除证据提供者（`null` = 关闭 Validate 阶段） */
export function setMemoryEvidenceProvider(
  provider: MemoryEvidenceProvider | null
): void {
  evidenceProvider = provider;
}

/** 保留上限报告的候选条数上限（只供审阅，避免报告文件随库规模线性膨胀） */
const MAX_RETENTION_REPORT_CANDIDATES = 200;

/** 保留上限的候选字段（与 `Memory` 解耦，便于纯函数单测） */
export interface EvictionCandidate {
  id: string;
  type: string;
  importance: number;
  isPinned: boolean;
  updatedAt: Date;
}

/** 永久保护的记忆类型（量小、价值高，不参与淘汰） */
const PROTECTED_MEMORY_TYPES = new Set(['user_fact', 'session_summary']);

/** 路径存在判断（等价 fs-extra 的 pathExists：不可访问即视为不存在） */
async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.promises.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * 选出需要归档的记忆 id（**纯函数**，不碰 I/O）。
 *
 * ① 溢出量 = 总数 − `maxCount`；② 候选 = 非保护类型 && 非 pinned && `importance < 0.7`；
 * ③ 候选内按 **importance 升序 → updatedAt 升序**（低价值、最旧先）。
 * 保护项永不入选 ⇒ 全受保护时可能少于溢出量（宁可不减，也不误伤）。
 */
export function selectEvictions(
  memories: EvictionCandidate[],
  maxCount: number
): string[] {
  const overflow = memories.length - maxCount;
  if (overflow <= 0) return [];
  return memories
    .filter(
      (m) =>
        !PROTECTED_MEMORY_TYPES.has(m.type) && !m.isPinned && m.importance < 0.7
    )
    .sort((a, b) => {
      if (a.importance !== b.importance) return a.importance - b.importance;
      return a.updatedAt.getTime() - b.updatedAt.getTime();
    })
    .slice(0, overflow)
    .map((m) => m.id);
}

/**
 * 记忆管理器实现
 *
 * T-①07（A5 记忆分层收敛）T1-2：`implements` 四个记忆窄端口，使"记忆能力契约"与实现**重新绑定**
 * （此前 `interface MemoryManager` 是无人实现的死契约，且近半声明在本类中并不存在）。
 */
export class MemoryManagerImpl
  implements MemoryReadPort, MemoryWritePort, MemorySearchPort, MemoryForgetPort
{
  /**
   * 记忆存储
   */
  private store: MemoryStoreImpl;

  private storeDir: string;

  /**
   * 记忆扫描器
   */
  private scanner: MemoryScannerImpl;

  /**
   * 记忆检索器
   */
  private retriever: MemoryRetrieverImpl;

  /**
   * 最近摘要缓存
   * 同时缓存 Memory[] 对象，支持有 sessionContext 时从缓存重排序而非走全量 I/O
   * 被 createMemory / updateMemory / deleteMemory 写入时失效，随后触发异步预热
   */
  recentSummaryCache: {
    memories: Memory[];
    summaries: string[];
    totalCount: number;
  } | null = null;

  /**
   * 缓存异步预热 Promise，防重复
   */
  private cacheWarmupPromise: Promise<void> | null = null;

  /**
   * 清理/写入并发锁，防止 cleanupExpiredMemories 与 saveMemory 同时执行
   */
  private isCleaning = false;

  /** v1.2: 最近一次 cleanupExpiredMemories 完成时间戳（供 stats 端点使用） */
  private lastCleanupAt: number | null = null;

  /**
   * 记忆去重合并器，在 createMemory 时自动检测内容重复
   */
  private consolidator = new MemoryConsolidator({ similarityThreshold: 0.85 });

  /**
   * 记忆冲突检测器（N-79 接线，2026-10-06）。
   *
   * 依据 `.trae/specs/memory-conflict-detection.md`：原实现**0 消费者**（能力静默无效），
   * 现接入空闲期 `runMaintenancePass()` —— **只检测与记录，不改写任何记忆**
   * （用户裁定：regex 启发式 confidence 0.5，不足以驱动自动消解）。
   */
  private conflictDetector = new MemoryConflictDetector();

  /**
   * 记忆提示服务
   */
  private promptService: MemoryPromptService;

  /**
   * 自动记忆服务
   */
  private autoMemoryService: AutoMemoryService;

  /**
   * 团队记忆服务
   */
  private teamMemoryService: TeamMemoryService;

  /**
   * Liri.md集成服务
   */
  private pyAppIntegrationService: PYAppIntegrationService;

  /**
   * 关联图文件路径
   */
  private relationGraphPath: string;

  /** 关联图保存队列（实例内串行化，避免并发整份快照互相覆盖，见 `saveRelationGraph()`） */
  private relationGraphSaveChain: Promise<void> = Promise.resolve();

  /**
   * 外部记忆提供者（最多 1 个）
   */
  private provider: MemoryProvider | null = null;

  /**
   * 构造函数
   * @param memoryDir 记忆目录路径
   */
  constructor(memoryDir: string = join(resolveDataDir(), 'memory')) {
    this.storeDir = memoryDir;
    this.relationGraphPath = join(memoryDir, 'memory-relation-graph.json');
    this.store = new MemoryStoreImpl(memoryDir);
    this.scanner = new MemoryScannerImpl();
    // P1-1（2026-11-25）：把存储作为向量持久化端口注入检索器（SQLite `memory_vectors`）
    this.retriever = new MemoryRetrieverImpl(memoryDir, undefined, this.store);
    this.promptService = new MemoryPromptService(
      this as unknown as MemoryManager
    );
    this.autoMemoryService = new AutoMemoryService(
      this as unknown as MemoryManager
    );
    this.teamMemoryService = new TeamMemoryService(
      this as unknown as MemoryManager
    );
    this.pyAppIntegrationService = new PYAppIntegrationService();

    // 加载关联图
    // @ignore-catch — 关联图异步加载，非关键路径，失败不阻塞初始化
    this.loadRelationGraph().catch(() => {});

    // 预热摘要缓存，避免首次 getSummaries 冷启动走全量 I/O
    // @ignore-catch — 摘要缓存异步预热，非关键路径，失败不影响主流程
    this.refreshSummaryCache().catch(() => {});
  }

  /**
   * 异步刷新摘要缓存（异步预热）
   * 让下次 getSummaries 读取时直接命中缓存，避免同步全量 I/O
   */
  private async refreshSummaryCache(): Promise<void> {
    // 如果已有预热进行中，避免重复
    if (this.cacheWarmupPromise) {
      return;
    }

    this.cacheWarmupPromise = (async () => {
      try {
        const allMemories = await this.getAllMemories();
        allMemories.sort(
          (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
        );

        const summaries = allMemories.map((m) => {
          const name = m.metadata?.name;
          const content = (m.content || '').trim();
          const truncated =
            content.length > 200 ? content.slice(0, 200) + '…' : content;
          const prefix = name ? `[${name}] ` : '';
          return `${prefix}${truncated}`;
        });

        this.recentSummaryCache = {
          memories: allMemories,
          summaries,
          totalCount: allMemories.length,
        };
      } catch (err) {
        // 预热失败不阻塞主流程，下次读取时自动回退全量扫描
        this.recentSummaryCache = null;
      } finally {
        this.cacheWarmupPromise = null;
      }
    })();

    await this.cacheWarmupPromise;
  }

  /**
   * 创建记忆
   * @param memory 记忆数据
   * @returns 创建的记忆
   */
  async createMemory(
    memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Memory> {
    // 如果清理任务正在执行，等待完成
    while (this.isCleaning) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // 创建记忆对象
    const newMemory = createMemory(memory);

    // 保存到存储
    await this.store.saveMemory(newMemory);

    // 增量更新检索器索引
    this.retriever.updateIndex(newMemory);
    await this.retriever.saveIndex();

    // 持久化关联图
    await this.saveRelationGraph();

    // D1（2026-09-25，`.trae/specs/memory-dedup-blocking-rootfix.md`）：写入热路径**不再跑
    // 全库相似度去重**。原实现每轮对话都对全库做成对 Jaccard 比较（实测 576 条库 = **41.9 秒
    // 同步阻塞** ⇒ 事件循环冻结、在飞的 HTTP 响应被推迟数十秒）。
    // 全量去重已移到**空闲期维护** `runMaintenancePass()`（由 IdleScaleMonitor 驱动、分片让出）。
    // 此处只保留 **O(1) 精确去重**（contentHash 命中缓存 ⇒ 删新建、返回既有），成本可忽略。
    try {
      const contentHash = createHash('sha256')
        .update(newMemory.content)
        .digest('hex');
      const cached = this.recentSummaryCache?.memories;
      if (cached) {
        for (const existing of cached) {
          if (existing.id === newMemory.id) continue;
          const existingHash = createHash('sha256')
            .update(existing.content)
            .digest('hex');
          if (existingHash === contentHash) {
            logger.info(
              `contentHash 精确去重：发现与 ${existing.id} 完全相同的记忆，跳过新建`,
              {
                newMemoryId: newMemory.id,
                existingMemoryId: existing.id,
              }
            );
            // 删除刚创建的新记忆（保留已有记忆）
            await this.store.deleteMemory(newMemory.id);
            this.retriever.removeFromIndex(newMemory.id);
            await this.retriever.saveIndex();
            return existing;
          }
        }
      }
    } catch (err) {
      // 精确去重失败不阻塞主流程（但**不静默**：记 warn 便于排查，CS03-002）
      logger.warn('contentHash 精确去重失败（忽略，不影响写入）', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 摘要缓存失效并异步预热
    this.recentSummaryCache = null;
    // @ignore-catch — 摘要缓存异步预热，非关键路径，失败不影响主流程
    this.refreshSummaryCache().catch(() => {});

    return newMemory;
  }

  /**
   * 空闲期维护：**全库相似度去重**（D1 的落点；不在写入热路径）+ **全库冲突检测**（U3）。
   *
   * 依据（`.trae/specs/memory-dedup-blocking-rootfix.md`）：
   * - 该工作原在 `createMemory` 内、每轮对话同步跑一次 ⇒ 实测 576 条库 **41.9 秒**阻塞主线程；
   * - 现挪到空闲期，并用 `findDuplicatesChunked`（D2 分片让出，每 `chunkPairs` 次比较
   *   `setImmediate` 让出）⇒ 单次同步块毫秒级，**不冻结事件循环**；
   * - D2′ 预分词后全库一遍约 1 秒（原 41.9 秒），故不再需要"单轮比较数上限"。
   *
   * 冲突检测（U3，2026-10-06，`.trae/specs/memory-conflict-detection.md`）：
   * - 复用**同一份** `getAllMemories()` 快照（零额外 I/O），经 `detectChunked` 分片让出；
   * - **只检测与记录**：不改写任何记忆（不删除/不更新/不写 metadata），结果仅进返回值与日志。
   *
   * 调用方：`ChatOrchestrator` 的 `IdleScaleMonitor.onIdle`（复用既有空闲缝）。
   */
  async runMaintenancePass(opts?: { chunkPairs?: number }): Promise<{
    total: number;
    removed: number;
    elapsedMs: number;
    conflicts: number;
    conflictSamples: ConflictResult[];
  }> {
    const startedAt = Date.now();
    const all = await this.getAllMemories();
    const input = all.map((m) => ({
      id: m.id,
      content: m.content ?? '',
      createdAt: m.createdAt.getTime(),
    }));

    const result = await this.consolidator.findDuplicatesChunked(
      input,
      opts?.chunkPairs
    );

    const removedIds = new Set(
      result.duplicates.flatMap((group) => group.slice(1))
    );
    if (result.totalRemoved > 0) {
      logger.info(`记忆维护：发现 ${result.totalRemoved} 条重复记忆`, {
        total: input.length,
      });
      // 删除重复记忆（保留每组第一条）
      for (const group of result.duplicates) {
        for (let i = 1; i < group.length; i++) {
          await this.store.deleteMemory(group[i]);
          this.retriever.removeFromIndex(group[i]);
        }
      }
      await this.retriever.saveIndex();
    }

    // P2-1 Validate（2026-11-25）：仅当 app 侧注入证据提供者时运行；
    // 放在索引重建**之前** ⇒ 新确认的条目立即参与"价值排序"。
    await this.validateMemories(all);

    // P2-2（2026-11-25）：规则笔记完整性报告（「失败→理论→验证→规则」的评估侧）；
    // 放在 Validate 之后 ⇒ 本轮刚写入的 `testedAt` 立即计入完整率。
    await this.evaluateRuleNotes(all.filter((m) => !removedIds.has(m.id)));

    // P0-1（2026-11-25）：重建顶层索引 `MEMORY.md` —— 注入层只读该文件（≤200 行）。
    // 放在去重之后：索引反映的是**最终存活集合**。失败不阻断维护（下一轮空闲期再试）。
    try {
      await this.store.updateMemoryIndex(
        all.filter((m) => !removedIds.has(m.id))
      );
    } catch (err) {
      await handleError(err, {
        module: 'memory:memoryManager',
        action: 'updateMemoryIndex',
      });
    }

    // P2-1 Represent（2026-11-25）：重建 wiki 表示层（按类型分组 + 链接完整性 + 体积上限）。
    // 门禁：`memory.wiki.enabled`（默认 true）；内容未变不重写。
    if (configManager.getValue<boolean>('memory.wiki.enabled', true) === true) {
      try {
        const report = await rebuildMemoryWiki(
          this.storeDir,
          all.filter((m) => !removedIds.has(m.id))
        );
        logger.info('记忆表示层已重建', { ...report });
      } catch (err) {
        await handleError(err, {
          module: 'memory:memoryManager',
          action: 'rebuildMemoryWiki',
        });
      }
    }

    // Phase 1（2026-11-25）：团队记忆共享目录单向拉取（默认关；只读合并、不覆盖、密钥 fail-closed）
    if (isTeamMemorySyncEnabled()) {
      const sharedDir = (
        configManager.getValue<string>('memory.teamSync.sharedDir', '') ?? ''
      ).trim();
      if (sharedDir) {
        const teamDir = resolveTeamMemoryDir();
        try {
          const report = await pullTeamMemoriesFromSharedDir({
            sharedDir,
            localDir: teamDir,
          });
          await writeFileAtomic(
            join(teamDir, 'pull-report.json'),
            JSON.stringify(
              { generatedAt: new Date().toISOString(), ...report },
              null,
              2
            ) + '\n'
          );

          // Phase 2：推送本地团队记忆到共享目录（镜像语义：异文只记冲突、不覆盖）
          const pushReport = await pushTeamMemoriesToSharedDir({
            localDir: teamDir,
            sharedDir,
          });
          await writeFileAtomic(
            join(teamDir, 'push-report.json'),
            JSON.stringify(
              { generatedAt: new Date().toISOString(), ...pushReport },
              null,
              2
            ) + '\n'
          );

          // Phase 3-lite：冲突候选（只供审阅，不自动改写任一侧）
          const candidates = await buildTeamConflictCandidates({
            teamDir,
            sharedDir,
            pullConflicts: report.conflicts,
            pushConflicts: pushReport.conflicts,
          });
          await writeFileAtomic(
            join(teamDir, 'conflicts.json'),
            JSON.stringify(
              {
                generatedAt: new Date().toISOString(),
                total: candidates.length,
                candidates,
              },
              null,
              2
            ) + '\n'
          );

          // Phase 3-lite：同步历史（审计留痕，不参与同步判定）
          await appendTeamSyncHistory(teamDir, {
            pulled: report.imported,
            pushed: pushReport.uploaded,
            pullConflicts: report.conflicts.length,
            pushConflicts: pushReport.conflicts.length,
            rejectedSecrets:
              report.rejectedSecrets.length + pushReport.rejectedSecrets.length,
            errors: report.errors.length + pushReport.errors.length,
          });
        } catch (err) {
          await handleError(err, {
            module: 'memory:memoryManager',
            action: 'pullTeamMemoriesFromSharedDir',
          });
        }
      }
    }

    // U3（2026-10-06，`.trae/specs/memory-conflict-detection.md`）：冲突检测接线。
    // **只检测与记录** —— 不删除/不更新/不写 metadata（用户裁定）。
    // 复用同一次 `all` 快照（零额外 I/O）；`detectChunked` 分片让出 ⇒ 不冻结事件循环。
    const found = await this.conflictDetector.detectChunked(
      all,
      opts?.chunkPairs
    );
    if (found.length > 0) {
      // 措辞为「潜在冲突」：检测器是 regex 启发式（confidence 0.5），不是判定
      logger.info(
        `记忆维护：发现 ${found.length} 处潜在冲突（只记录，不改写）`,
        {
          total: input.length,
          conflicts: found.length,
          samples: found.slice(0, CONFLICT_SAMPLE_LIMIT).map((c) => ({
            conflictType: c.conflictType,
            subject: c.subject,
            memoryIdA: c.memoryIdA,
            memoryIdB: c.memoryIdB,
            confidence: c.confidence,
          })),
        }
      );
    }

    // P0-2（2026-11-25）：冲突候选落盘 —— 结构化、只供审阅，**不自动改写**任何记忆。
    await this.writeConflictCandidates(found);

    return {
      total: input.length,
      removed: result.totalRemoved,
      elapsedMs: Date.now() - startedAt,
      conflicts: found.length,
      conflictSamples: found.slice(0, CONFLICT_SAMPLE_LIMIT),
    };
  }

  /**
   * 处理对话并提取记忆（接口方法，匹配 MemoryManager.processConversation 签名）
   * 内部委托 AutoMemoryService 进行 LLM 提取和去重
   */
  async processConversation(
    conversationId: string,
    messages: Array<{ role: string; content: string; timestamp: Date }>
  ): Promise<Memory[]> {
    return this.autoMemoryService.processConversation(conversationId, messages);
  }

  /**
   * v1.2: 获取即将过期的记忆列表（age > 80% TTL）
   * 供 HTTP handler stats 端点使用
   */
  async getExpiringMemories(): Promise<Memory[]> {
    const allMemories = await this.getAllMemories();
    const now = Date.now();
    return allMemories.filter((m) => {
      const ageMs = now - m.createdAt.getTime();
      const ttlMs = this.getMemoryTTL(m);
      return ageMs > ttlMs * 0.8;
    });
  }

  /**
   * v1.2: 获取最近一次清理时间戳（供 stats 端点使用）
   */
  getLastCleanupAt(): number | null {
    return this.lastCleanupAt;
  }

  /**
   * 获取记忆
   * @param id 记忆ID
   * @returns 记忆对象或null
   */
  async getMemory(id: string): Promise<Memory | null> {
    validateMemoryId(id);
    return this.store.readMemory(id);
  }

  /**
   * 更新记忆
   * @param id 记忆ID
   * @param updates 更新数据
   * @returns 更新后的记忆
   */
  async updateMemory(id: string, updates: Partial<Memory>): Promise<Memory> {
    validateMemoryId(id);

    // 获取现有记忆
    const existingMemory = await this.store.readMemory(id);
    if (!existingMemory) {
      throw new AppError(
        `Memory with id ${id} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 合并更新
    const updatedMemory: Memory = {
      ...existingMemory,
      ...updates,
      metadata: {
        ...existingMemory.metadata,
        ...(updates.metadata || {}),
      },
      updatedAt: new Date(),
    };

    // 保存到存储
    await this.store.saveMemory(updatedMemory);

    // 增量更新检索器索引
    this.retriever.updateIndex(updatedMemory);
    await this.retriever.saveIndex();

    // 持久化关联图
    await this.saveRelationGraph();

    // 摘要缓存失效并异步预热
    this.recentSummaryCache = null;
    // @ignore-catch — 摘要缓存异步预热，非关键路径，失败不影响主流程
    this.refreshSummaryCache().catch(() => {});

    return updatedMemory;
  }

  /**
   * 删除记忆
   * @param id 记忆ID
   */
  async deleteMemory(id: string): Promise<void> {
    validateMemoryId(id);
    await this.store.deleteMemory(id);

    // 从检索器索引中移除
    this.retriever.removeFromIndex(id);
    await this.retriever.saveIndex();

    // 持久化关联图
    await this.saveRelationGraph();

    // 摘要缓存失效并异步预热
    this.recentSummaryCache = null;
    // @ignore-catch — 摘要缓存异步预热，非关键路径，失败不影响主流程
    this.refreshSummaryCache().catch(() => {});
  }

  /**
   * 删除所有记忆
   * @returns 删除的记忆数量
   */
  async deleteAllMemories(): Promise<number> {
    const allMemories = await this.getAllMemories();
    const count = allMemories.length;

    for (const memory of allMemories) {
      await this.store.deleteMemory(memory.id);
      this.retriever.removeFromIndex(memory.id);
    }

    if (count > 0) {
      await this.retriever.saveIndex();
      await this.saveRelationGraph();
    }

    // 摘要缓存失效并异步预热
    this.recentSummaryCache = null;
    // @ignore-catch — 摘要缓存异步预热，非关键路径，失败不影响主流程
    this.refreshSummaryCache().catch(() => {});

    return count;
  }

  /**
   * 检索相关记忆
   * 使用混合搜索（关键词+语义），优先利用 EmbeddingService 提升检索准确度，
   * 同时利用关联图扩展关联记忆（联想记忆），
   * 最后通过 LLM 精选（P2-6）从候选中选出最相关条目。
   * @param query 查询字符串
   * @param limit 返回数量限制
   * @returns 相关记忆列表
   */
  async getRelevantMemories(
    query: string,
    limit: number = 5
  ): Promise<Memory[]> {
    // 获取更多候选（3x limit），给 LLM 精选留空间
    const candidateLimit = limit * 3;
    const results = await this.retriever.hybridSearch(query, candidateLimit);

    // 通过关联图扩展关联记忆
    const resultIds = new Set(results.map((m) => m.id));
    const relatedIds = new Set<string>();

    for (const memory of results) {
      const relations = memoryRelationGraph.getDirectRelations(memory.id);
      for (const relation of relations) {
        if (
          !resultIds.has(relation.targetId) &&
          !relatedIds.has(relation.targetId)
        ) {
          relatedIds.add(relation.targetId);
        }
      }
    }

    const combined: Memory[] = [...results];

    if (relatedIds.size > 0) {
      for (const id of relatedIds) {
        const memory = await this.store.readMemory(id);
        if (memory) combined.push(memory);
      }
    }

    // P2-6: 候选超过 limit 时，用 LLM 精选最相关的记忆
    if (combined.length > limit) {
      try {
        const items: MemoryItem[] = combined.map((m) => ({
          id: m.id,
          type: (m.metadata?.type as string) ?? 'unknown',
          content: m.content,
          createdAt: m.createdAt.getTime(),
        }));

        // 端口内显式经模型路由解析（DB 唯一事实来源）并匹配 provider，保留原
        // "避免 model: undefined 回退默认 provider 的不可控默认模型（曾导致 Kimi-K2.6 400）" 语义。
        const _trackStart = Date.now();
        const chatResult = await resolveAiAccess().chatWithRole(
          'quick',
          [
            {
              role: 'system',
              content: '你是记忆选择器。只返回一个由记忆 ID 组成的 JSON 数组。',
            },
            { role: 'user', content: buildSelectionPrompt(query, items) },
          ],
          { temperature: 0.3, maxTokens: 512 }
        );

        if (chatResult) {
          resolveAiAccess().trackUsage(chatResult.raw, {
            model: chatResult.model,
            providerId: chatResult.providerId,
            latencyMs: Date.now() - _trackStart,
          });

          const selectedIds = parseSelectionResult(chatResult.content);
          if (selectedIds.length > 0) {
            const selected = applySelection(items, selectedIds);
            const selectedIdSet = new Set(selected.map((s) => s.id));
            const refined = combined.filter((m) => selectedIdSet.has(m.id));
            logger.info('LLM 精选记忆完成', {
              candidates: combined.length,
              selected: refined.length,
            });
            const top = refined.slice(0, limit);
            await this.recordMemoryAccess(top.map((m) => m.id));
            return top;
          }
        }
      } catch (err) {
        await handleError(err, {
          module: 'memory:memoryManager',
          action: 'llmSelectMemories',
        });
        logger.warn('LLM 精选记忆失败，降级为 top-K', {
          error: String(err),
        });
      }
    }

    const top = combined.slice(0, limit);
    await this.recordMemoryAccess(top.map((m) => m.id));
    return top;
  }

  /**
   * 记录一次召回（P0-2-4，2026-11-25）：命中的长期记忆 `accessCount` 自增并落盘。
   *
   * 只动 `metadata.accessCount` —— **不**改写正文、**不**刷新 `updatedAt`
   * （避免污染"最近更新"语义与索引的 updatedAt 排序）。
   * 由 `getRelevantMemories` 在返回前调用：单条失败只记日志，不影响检索结果。
   */
  async recordMemoryAccess(ids: string[]): Promise<void> {
    for (const id of new Set(ids)) {
      try {
        const memory = await this.store.readMemory(id);
        if (!memory) continue;
        memory.metadata.accessCount = (memory.metadata.accessCount ?? 0) + 1;
        await this.store.saveMemory(memory);
      } catch (err) {
        await handleError(err, {
          module: 'memory:memoryManager',
          action: 'recordMemoryAccess',
        });
      }
    }
  }

  /**
   * 获取所有记忆
   * @returns 记忆列表
   */
  async getAllMemories(): Promise<Memory[]> {
    // 刷新待写入批次，确保磁盘与运行时一致
    await this.store.flushBatch();

    // 获取所有记忆ID
    const memoryIds = await this.store.listMemories();

    // 读取每个记忆
    const memories: Memory[] = [];
    for (const id of memoryIds) {
      const memory = await this.store.readMemory(id);
      if (memory) {
        memories.push(memory);
      }
    }

    return memories;
  }

  /**
   * 获取记忆统计信息
   * @returns 记忆统计信息
   */
  async getMemoryStats(): Promise<MemoryStats> {
    const memories = await this.getAllMemories();

    // 按类型统计（2026-09-02，D-P1）：枚举键必填 + string 索引可选——自定义注册类型
    // （registerMemoryType，如 session_summary）可计入，不再只统计内置枚举 7 类
    const byType: { [K in MemoryType]: number } & Record<
      string,
      number | undefined
    > = {
      [MemoryType.USER_FACT]: 0,
      [MemoryType.USER_PREFERENCE]: 0,
      [MemoryType.PROJECT_KNOWLEDGE]: 0,
      [MemoryType.CODE_PATTERN]: 0,
      [MemoryType.DECISION]: 0,
      [MemoryType.FEEDBACK]: 0,
      [MemoryType.REFERENCE]: 0,
    };

    let totalSize = 0;
    const now = new Date();
    let recent = 0;

    for (const memory of memories) {
      // 按类型统计（含自定义类型键）
      byType[memory.metadata.type] = (byType[memory.metadata.type] ?? 0) + 1;

      // 计算总大小
      totalSize += Buffer.byteLength(memory.content, 'utf8');

      // 统计最近创建的记忆（7天内）
      const daysSinceCreation =
        (now.getTime() - memory.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceCreation <= 7) {
        recent++;
      }
    }

    return {
      total: memories.length,
      byType,
      recent,
      totalSize,
    };
  }

  /**
   * 注册外部记忆提供者
   * 最多允许 1 个外部提供者，重复注册会覆盖
   * @param provider 记忆提供者实例
   */
  async addProvider(provider: MemoryProvider): Promise<void> {
    if (this.provider) {
      await this.provider.shutdown();
    }

    await provider.initialize();
    this.provider = provider;
  }

  /**
   * 获取当前外部记忆提供者
   * @returns 记忆提供者或 null
   */
  getProvider(): MemoryProvider | null {
    return this.provider;
  }

  /**
   * 移除当前外部记忆提供者
   */
  removeProvider(): void {
    if (this.provider) {
      // @ignore-catch — 外部提供者关闭best-effort，失败不影响内存释放
      this.provider.shutdown().catch(() => {});
      this.provider = null;
    }
  }

  /** 团队记忆同步状态（供设置页 / HTTP 审阅读取） */
  getTeamMemorySyncStatus(): TeamMemorySyncStatus {
    return this.teamMemoryService.getSyncStatus();
  }

  /** 团队记忆最近一次同步时间（无记录 ⇒ null） */
  getTeamMemoryLastSyncTime(): Date | null {
    return this.teamMemoryService.getLastSyncTime();
  }

  /** 团队记忆同步记录（最新在前） */
  getTeamMemorySyncRecords(limit?: number): TeamMemorySyncRecord[] {
    return this.teamMemoryService.getSyncRecords(limit);
  }

  /**
   * 清理已过期的记忆
   * 遍历所有记忆，删除 metadata.expiresAt 已到期的记忆
   * TTL 按重要度差异化：高重要度（>=0.7）TTL×2，低重要度（<0.3）TTL×0.5
   * @returns 被清理的记忆数量
   */
  async cleanupExpiredMemories(): Promise<number> {
    // 防并发：已有清理任务正在执行则跳过
    if (this.isCleaning) return 0;
    this.isCleaning = true;

    try {
      const allMemories = await this.getAllMemories();
      const now = new Date();
      const expired: string[] = [];

      for (const memory of allMemories) {
        const ttlMs = this.getMemoryTTL(memory);
        const ageMs = now.getTime() - memory.createdAt.getTime();

        // 优先检查显式 expiresAt，其次根据 TTL 判断是否过期
        const isExpired =
          (memory.metadata.expiresAt &&
            new Date(memory.metadata.expiresAt) <= now) ||
          (!memory.metadata.expiresAt && ageMs > ttlMs);

        if (isExpired) {
          expired.push(memory.id);
        }
      }

      // D5-B（2026-09-28）：TTL 老化之外补「保留上限 + 归档」护栏。
      // 复用同一次 `getAllMemories()` 遍历与同一把 `isCleaning` 锁 ⇒ 不新增调度器、不新增 I/O 轮次。
      const evictions = selectEvictions(
        allMemories.map((m) => ({
          id: m.id,
          type: m.metadata.type,
          importance: m.metadata.importance ?? 0.5,
          isPinned: m.metadata.isPinned ?? false,
          updatedAt: m.updatedAt,
        })),
        MEMORY_MAX_COUNT
      );

      for (const id of expired) {
        await this.store.deleteMemory(id);
        this.retriever.removeFromIndex(id);
      }

      // 超限条目**归档**（软停用：移动到 `.trash`）而非物理删除；
      // 未开启 `memory.retention.enforce` 时只报告（P0-2：报告 + 归档预览）。
      const enforce = isRetentionEnforced();
      const evictedMemories = allMemories.filter((m) =>
        evictions.includes(m.id)
      );
      const toPreview = (m: Memory): {
        id: string;
        type: string;
        importance: number;
        ageDays: number;
      } => ({
        id: m.id,
        type: m.metadata.type,
        importance: m.metadata.importance ?? 0.5,
        ageDays: Math.round((now.getTime() - m.updatedAt.getTime()) / 86_400_000),
      });

      let archived = 0;
      if (enforce) {
        for (const id of evictions) {
          if (await this.store.archiveMemory(id)) {
            this.retriever.removeFromIndex(id);
            archived += 1;
          }
        }
      }
      if (evictions.length > 0) {
        logger.info(
          enforce
            ? `记忆库超限：已归档 ${archived}/${evictions.length} 条`
            : `记忆库超限：将归档 ${evictions.length} 条（dry-run，未移动文件）`,
          {
            totalMemories: allMemories.length,
            limit: MEMORY_MAX_COUNT,
            preview: evictedMemories.slice(0, 5).map(toPreview),
          }
        );
        await this.writeRetentionReport({
          total: allMemories.length,
          overflow: evictions.length,
          enforce,
          archived,
          candidates: evictedMemories
            .slice(0, MAX_RETENTION_REPORT_CANDIDATES)
            .map(toPreview),
        });
      }

      if (expired.length > 0 || archived > 0) {
        await this.retriever.saveIndex();
        await this.saveRelationGraph();
      }

      // P0-1（2026-11-25）：启动期 / 每 6 小时的清理顺带刷新顶层索引 ——
      // 保证注入层在"首次空闲维护"之前就有可读索引（空态仍零注入）。
      // 复用同一份 `allMemories` 快照（不重复扫盘）。
      const goneIds = new Set(expired);
      if (enforce) {
        for (const m of evictedMemories) goneIds.add(m.id);
      }
      try {
        await this.store.updateMemoryIndex(
          allMemories.filter((m) => !goneIds.has(m.id))
        );
      } catch (err) {
        await handleError(err, {
          module: 'memory:memoryManager',
          action: 'updateMemoryIndex',
        });
      }

      logger.info(`清理了 ${expired.length} 条过期记忆`, {
        totalMemories: allMemories.length,
        cleanedCount: expired.length,
      });

      return expired.length;
    } finally {
      this.isCleaning = false;
      this.lastCleanupAt = Date.now();
    }
  }

  /**
   * 落「保留上限报告」（P0-2，2026-11-25）：供审阅"将归档哪些/多少条"，
   * **不改写任何记忆**；写入失败不阻断清理（记 handleError，下一轮再写）。
   */
  private async writeRetentionReport(input: {
    total: number;
    overflow: number;
    enforce: boolean;
    archived: number;
    candidates: Array<{
      id: string;
      type: string;
      importance: number;
      ageDays: number;
    }>;
  }): Promise<void> {
    const report = {
      generatedAt: new Date().toISOString(),
      limit: MEMORY_MAX_COUNT,
      total: input.total,
      overflow: input.overflow,
      enforced: input.enforce,
      archived: input.archived,
      candidates: input.candidates,
    };
    try {
      await writeFileAtomic(
        join(this.storeDir, 'retention-report.json'),
        JSON.stringify(report, null, 2) + '\n'
      );
    } catch (err) {
      await handleError(err, {
        module: 'memory:memoryManager',
        action: 'writeRetentionReport',
      });
    }
  }

  /**
   * 落「冲突候选」（P0-2，2026-11-25）：结构化候选供人工审阅，
   * **不自动改写**任何记忆（沿用 `.trae/specs/memory-conflict-detection.md` 裁定）。
   */
  private async writeConflictCandidates(
    conflicts: ConflictResult[]
  ): Promise<void> {
    const candidates = conflicts
      .slice(0, MAX_CONFLICT_CANDIDATES)
      .map((c, i) => ({
        conflictId: `${c.memoryIdA}~${c.memoryIdB}#${i}`,
        memoryIdA: c.memoryIdA,
        memoryIdB: c.memoryIdB,
        conflictType: c.conflictType,
        subject: c.subject,
        confidence: c.confidence,
        detectedAt: new Date().toISOString(),
      }));
    try {
      await writeFileAtomic(
        join(this.storeDir, 'conflict-candidates.json'),
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            total: conflicts.length,
            candidates,
          },
          null,
          2
        ) + '\n'
      );
    } catch (err) {
      await handleError(err, {
        module: 'memory:memoryManager',
        action: 'writeConflictCandidates',
      });
    }
  }

  /**
   * Validate 阶段（P2-1，2026-11-25）：抽样"有来源会话、尚未验证"的记忆，
   * 在原始会话记录中查找**同文证据**；命中即写 `metadata.verifiedAt`（**不改写正文**）。
   *
   * 精度边界（如实）：会话检索是"包含 probe"的精确子串匹配 ⇒ 只有**逐字引用原文**的记忆
   * 才会被确认；摘要式记忆通常保持"未验证"。未命中**不**标记 stale（避免误伤），
   * 结果只落 `validation-report.json` 供观测。
   */
  private async validateMemories(memories: Memory[]): Promise<void> {
    if (!evidenceProvider) return;

    const candidates = memories
      .filter((m) => m.metadata.sessionId && !m.metadata.verifiedAt)
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .slice(0, MAX_VALIDATION_SAMPLES);
    if (candidates.length === 0) return;

    const verifiedIds: string[] = [];
    const unverifiedIds: string[] = [];

    for (const memory of candidates) {
      const probe = (memory.content || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
      if (probe.length < MIN_VALIDATION_PROBE_LENGTH) continue;

      try {
        const entries = await evidenceProvider(memory.metadata.sessionId!, probe);
        const matched = entries.some((entry) => {
          const text =
            typeof entry.content === 'string'
              ? entry.content
              : JSON.stringify(entry.content ?? '');
          return text.includes(probe);
        });
        if (!matched) {
          unverifiedIds.push(memory.id);
          continue;
        }
        const confirmedAt = new Date();
        memory.metadata.verifiedAt = confirmedAt;
        // P2-2（2026-11-25）：规则笔记的证据确认同时写 `testedAt`（闭环的"验证"步骤）
        if (memory.metadata.ruleNote)
          memory.metadata.ruleNote.testedAt = confirmedAt;
        await this.store.saveMemory(memory);
        this.retriever.updateIndex(memory);
        verifiedIds.push(memory.id);
      } catch (err) {
        await handleError(err, {
          module: 'memory:memoryManager',
          action: 'validateMemory',
        });
      }
    }

    if (verifiedIds.length > 0 || unverifiedIds.length > 0) {
      logger.info(
        `记忆验证：抽样 ${candidates.length} 条，确认 ${verifiedIds.length} 条`,
        {
          sampled: candidates.length,
          verified: verifiedIds.length,
          unverified: unverifiedIds.length,
        }
      );
      try {
        await writeFileAtomic(
          join(this.storeDir, 'validation-report.json'),
          JSON.stringify(
            {
              generatedAt: new Date().toISOString(),
              sampled: candidates.length,
              verified: verifiedIds.length,
              verifiedIds,
              unverifiedIds,
            },
            null,
            2
          ) + '\n'
        );
      } catch (err) {
        await handleError(err, {
          module: 'memory:memoryManager',
          action: 'writeValidationReport',
        });
      }
    }
  }

  /**
   * 规则笔记完整性评估（P2-2，2026-11-25）。
   *
   * 读取方：把「失败 → 理论 → 验证 → 规则」的结构化记录汇总成 `rule-notes-report.json`
   * （总数 / 完整数 / 不完整数 / 各字段缺失计数 / 不完整样本 ≤5）。
   * 完整 = `rule` + `whyTrue` + `evidenceSeqs`(≥1) + `traps`(≥1) + `testedAt` 均具备。
   * 无规则笔记时**不写报告**（不伪造空态文件）。
   */
  private async evaluateRuleNotes(memories: Memory[]): Promise<void> {
    const noted = memories.filter((m) => m.metadata.ruleNote);
    if (noted.length === 0) return;

    const missing = {
      rule: 0,
      whyTrue: 0,
      evidenceSeqs: 0,
      traps: 0,
      testedAt: 0,
    };
    const incompleteSamples: Array<{
      id: string;
      name: string;
      missing: string[];
    }> = [];
    let incompleteCount = 0;

    for (const memory of noted) {
      const note = memory.metadata.ruleNote as NonNullable<
        Memory['metadata']['ruleNote']
      >;
      const gaps: string[] = [];
      if (!note.rule?.trim()) gaps.push('rule');
      if (!note.whyTrue?.trim()) gaps.push('whyTrue');
      if (!note.evidenceSeqs || note.evidenceSeqs.length === 0)
        gaps.push('evidenceSeqs');
      if (!note.traps || note.traps.length === 0) gaps.push('traps');
      if (!note.testedAt) gaps.push('testedAt');
      for (const field of gaps) {
        missing[field as keyof typeof missing] += 1;
      }
      if (gaps.length > 0) {
        incompleteCount += 1;
        if (incompleteSamples.length < 5) {
          incompleteSamples.push({
            id: memory.id,
            name: memory.metadata.name,
            missing: gaps,
          });
        }
      }
    }

    const complete = noted.length - incompleteCount;
    const report = {
      generatedAt: new Date().toISOString(),
      total: noted.length,
      complete,
      incomplete: incompleteCount,
      completenessRate: Number((complete / noted.length).toFixed(3)),
      missing,
      incompleteSamples,
    };
    logger.info(`规则笔记完整性：${complete}/${noted.length}`, {
      total: report.total,
      complete,
      incomplete: incompleteCount,
    });

    try {
      await writeFileAtomic(
        join(this.storeDir, 'rule-notes-report.json'),
        JSON.stringify(report, null, 2) + '\n'
      );
    } catch (err) {
      await handleError(err, {
        module: 'memory:memoryManager',
        action: 'writeRuleNotesReport',
      });
    }
  }

  /**
   * 根据记忆重要度计算 TTL（毫秒）
   * 高重要度（importance >= 0.7）：180 天
   * 中重要度（0.3 <= importance < 0.7）：90 天（默认）
   * 低重要度（importance < 0.3）：45 天
   */
  private getMemoryTTL(memory: Memory): number {
    const baseTTL = 90 * 24 * 60 * 60 * 1000; // 90 天
    const importance = memory.metadata.importance ?? 0.5;
    if (importance >= 0.7) return baseTTL * 2;
    if (importance < 0.3) return baseTTL * 0.5;
    return baseTTL;
  }

  /**
   * 设置记忆过期时间
   * @param id 记忆ID
   * @param expiresAt 过期时间
   * @returns 更新后的记忆
   */
  async setMemoryExpiry(id: string, expiresAt: Date): Promise<Memory> {
    validateMemoryId(id);
    const memory = await this.store.readMemory(id);
    if (!memory) {
      throw new AppError(
        `Memory with id ${id} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    memory.metadata.expiresAt = expiresAt;
    memory.updatedAt = new Date();

    await this.store.saveMemory(memory);
    this.retriever.updateIndex(memory);
    await this.retriever.saveIndex();
    await this.saveRelationGraph();

    return memory;
  }

  /**
   * 扫描记忆目录
   */
  async scanMemoryDirectory(): Promise<void> {
    await this.retriever.scanMemoryDirectory();
  }

  /**
   * 构建记忆索引
   */
  async buildMemoryIndex(): Promise<void> {
    await this.retriever.buildMemoryIndex();
    await this.retriever.saveIndex();
  }

  /**
   * 获取记忆存储
   * @returns 记忆存储
   */
  getStore(): MemoryStore {
    return this.store;
  }

  /**
   * 导出记忆为Markdown文件
   * @param id 记忆ID
   * @param exportDir 导出目录
   * @returns 导出文件路径
   */
  async exportMemoryAsMarkdown(
    id: string,
    exportDir: string = './exports'
  ): Promise<string> {
    validateMemoryId(id);
    validateMemoryPath(exportDir, 'exportDir');
    return this.store.exportMemoryAsMarkdown(id, exportDir);
  }

  /**
   * 导入Markdown文件为记忆
   * @param filePath Markdown文件路径
   * @returns 创建的记忆ID
   */
  async importMemoryFromMarkdown(filePath: string): Promise<string> {
    validateMemoryPath(filePath, 'filePath');
    const id = await this.store.importMemoryFromMarkdown(filePath);

    // 重新构建索引
    await this.buildMemoryIndex();

    return id;
  }

  /**
   * 获取记忆的Markdown预览
   * @param id 记忆ID
   * @returns Markdown预览内容
   */
  async getMemoryMarkdownPreview(id: string): Promise<string> {
    return this.store.getMemoryMarkdownPreview(id);
  }

  /**
   * 获取记忆扫描器
   * @returns 记忆扫描器
   */
  getScanner(): MemoryScannerImpl {
    return this.scanner;
  }

  /**
   * 获取记忆检索器
   * @returns 记忆检索器
   */
  getRetriever(): MemoryRetrieverImpl {
    return this.retriever;
  }

  /**
   * 备份记忆数据
   * @param backupDir 备份目录
   */
  async backupMemoryData(backupDir: string = './backups'): Promise<void> {
    ensureDir(backupDir);

    // 复制记忆目录到备份目录
    const backupPath = join(
      backupDir,
      `memory_backup_${new Date().toISOString().replace(/[:.]/g, '-')}`
    );

    try {
      // 检查源目录是否存在
      const sourceExists = await pathExists(this.storeDir);
      if (!sourceExists) {
        throw new AppError(
          `Source memory directory ${this.storeDir} does not exist`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      await fs.promises.cp(this.storeDir, backupPath, { recursive: true });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        `Failed to backup memory data from ${this.storeDir} to ${backupPath}: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  /**
   * 恢复记忆数据
   * @param backupDir 备份目录
   */
  async restoreMemoryData(backupDir: string): Promise<void> {
    // 检查备份目录是否存在
    if (!(await pathExists(backupDir))) {
      throw new AppError(
        `Backup directory ${backupDir} does not exist`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 清空当前记忆目录
    await fs.promises.rm(this.storeDir, { recursive: true, force: true });
    await fs.promises.mkdir(this.storeDir, { recursive: true });

    // 复制备份数据到当前记忆目录
    const files = await fs.promises.readdir(backupDir);
    for (const file of files) {
      const srcPath = join(backupDir, file);
      const destPath = join(this.storeDir, file);
      await fs.promises.cp(srcPath, destPath, { recursive: true });
    }

    // 重新构建索引
    await this.buildMemoryIndex();
  }

  /**
   * 加载关联图
   */
  async loadRelationGraph(): Promise<void> {
    try {
      await fs.promises.access(this.relationGraphPath);
      const content = await fs.promises.readFile(
        this.relationGraphPath,
        'utf8'
      );
      const result = decodePayload(content);
      if (result.status === 'corrupt') {
        logger.warn('记忆关系图文件校验失败（checksum 不匹配），已忽略', {
          path: this.relationGraphPath,
        });
        return;
      }
      const relations = JSON.parse(result.payload);
      memoryRelationGraph.deserialize(relations);
    } catch (err) {
      // 文件不存在或解析失败时使用空关联图
    }
  }

  /**
   * 保存关联图
   *
   * 2026-10-31（真机 `app.log` 实证 `[save_relation_graph] ENOENT … rename`）：
   * 旧实现用**固定**临时名 `memory-relation-graph.json.tmp` 做「写→rename」，并发保存时
   * 后到者 rename 的 tmp 已被先到者消费 ⇒ ENOENT（关系图保存失败）。现改为：
   * ① 落盘走共享原语 `writeFileAtomic`（唯一临时名 + Windows rename 瞬时错误重试）；
   * ② 实例内排队写，避免并发整份快照互相覆盖。
   */
  async saveRelationGraph(): Promise<void> {
    const run = this.relationGraphSaveChain.then(() =>
      this.writeRelationGraphFile()
    );
    this.relationGraphSaveChain = run.catch(() => undefined);
    await run;
  }

  /** `saveRelationGraph` 的实际落盘体（串行执行，独占临时名） */
  private async writeRelationGraphFile(): Promise<void> {
    try {
      const relations = memoryRelationGraph.serialize();
      await writeFileAtomic(
        this.relationGraphPath,
        encodePayload(JSON.stringify(relations))
      );
    } catch (error) {
      await handleError(error, {
        module: 'memory:manager',
        action: 'save_relation_graph',
      });
    }
  }

  /**
   * 初始化Liri.md集成
   */
  async initializePYAppIntegration(): Promise<void> {
    await this.pyAppIntegrationService.initialize();
  }

  /**
   * 获取Liri配置
   */
  getPYAppConfig(): PYAppConfig | null {
    return this.pyAppIntegrationService.getConfig();
  }

  /**
   * 获取所有Liri规则
   */
  getPYAppRules(): Rule[] {
    return this.pyAppIntegrationService.getRules();
  }

  /**
   * 获取指定类别的Liri规则
   */
  getPYAppRulesByCategory(category: string): Rule[] {
    return this.pyAppIntegrationService.getRulesByCategory(category);
  }

  /**
   * 获取指定优先级的Liri规则
   */
  getPYAppRulesByPriority(priority: 'high' | 'medium' | 'low'): Rule[] {
    return this.pyAppIntegrationService.getRulesByPriority(priority);
  }

  /**
   * 获取所有Liri偏好设置
   */
  getPYAppPreferences(): Preference[] {
    return this.pyAppIntegrationService.getPreferences();
  }

  /**
   * 获取指定键的Liri偏好设置
   */
  getPYAppPreference(key: string): Preference | undefined {
    return this.pyAppIntegrationService.getPreference(key);
  }

  /**
   * 获取Liri偏好设置值
   */
  getPYAppPreferenceValue(key: string, defaultValue?: unknown): unknown {
    return this.pyAppIntegrationService.getPreferenceValue(key, defaultValue);
  }

  /**
   * 获取Liri规则文本（用于AI模块）
   */
  getPYAppRulesText(): string {
    return this.pyAppIntegrationService.getRulesText();
  }

  /**
   * 检查Liri是否有变化
   */
  async checkPYAppChanges(): Promise<boolean> {
    return this.pyAppIntegrationService.checkForChanges();
  }

  /**
   * 添加Liri变化监听器
   */
  addPYAppChangeListener(listener: (config: PYAppConfig) => void): void {
    this.pyAppIntegrationService.addChangeListener(listener);
  }

  /**
   * 移除Liri变化监听器
   */
  removePYAppChangeListener(listener: (config: PYAppConfig) => void): void {
    this.pyAppIntegrationService.removeChangeListener(listener);
  }
}

// ============================================================================
// 共享单例工厂（T-①07 T1-5 · D4 工厂收口）
// ============================================================================

/**
 * 进程内共享的 `MemoryManagerImpl` 单例（懒初始化）。
 *
 * 背景：此前全仓有 ≥9 处各自 `new MemoryManagerImpl()`（其中 4 处还各造了局部惰性单例），
 * 多实例各自持有独立的内存 retriever 索引与关系图 ⇒ 召回不一致、索引重复预热，并在
 * 异步 `saveIndex`/`saveRelationGraph` 下互相覆写（`tasks/LongRunningTaskOrchestrator`
 * 已因此吃过一次亏）。本工厂是全仓**唯一共享入口**。
 *
 * 需要**惰性加载**的调用方（避免静态引用连带加载 memory 运行时链）可经
 * `await import('@modules/memory')` 后调用本函数 —— 模块缓存保证仍返回同一实例。
 *
 * 显式隔离场景（如 `memory/cli/MemoryCLI` 可传自定义 `memoryDir`）仍可直接构造，
 * 不纳入共享单例。
 */
let sharedMemoryManager: MemoryManagerImpl | null = null;

export function getMemoryManager(): MemoryManagerImpl {
  if (!sharedMemoryManager) {
    sharedMemoryManager = new MemoryManagerImpl();
  }
  return sharedMemoryManager;
}
