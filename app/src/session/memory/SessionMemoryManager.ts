// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Session Memory Manager
 *
 * 自动维护会话的 Markdown 记忆文件（memory.md），对标 BA_REF sessionMemory.ts。
 * 核心功能：
 * 1. 阈值检测 — 达到 Token 或工具调用阈值后触发提炼
 * 2. LLM 提炼 — 调用轻量模型从对话中提取关键信息
 * 3. 文件持久化 — 写入 Markdown 文件，会话重启时自动加载
 * 4. 上下文注入 — 将记忆内容注入系统提示词
 *
 * 设计原则：
 * - 纯函数式文件 I/O，不依赖数据库
 * - 异步 fire-and-forget 提炼，不阻塞主对话
 * - 可配合 Step 4 的 Session Hooks 注册到生命周期
 */

import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  statSync,
} from 'fs';
import { dirname, join } from 'path';
import { getLogger } from '@modules/monitoring';
import type { EmbeddingManager } from '@modules/ai';
import type { ChatMessage } from '@modules/ai';

const logger = getLogger('session:memory');

/**
 * 向量索引条目
 */
interface VectorEntry {
  item: MemoryItem;
  vector: number[];
}

// ============================================================================
// 类型定义
// ============================================================================

/** 记忆提炼触发配置 */
export interface MemoryThresholdConfig {
  /** Token 累计阈值（默认 20_000） */
  tokenThreshold: number;
  /** 工具调用次数阈值（默认 10） */
  toolCallThreshold: number;
}

/** 记忆项（结构化） */
export interface MemoryItem {
  type: 'discussion' | 'decision' | 'file_change' | 'code_reference' | 'todo';
  content: string;
}

/** 记忆文件内容结构 */
export interface SessionMemory {
  /** 会话 ID */
  sessionId: string;
  /** 最后更新时间 */
  updatedAt: string;
  /** 累计处理的 token 数 */
  processedTokens: number;
  /** 累计工具调用次数 */
  processedToolCalls: number;
  /** 记忆项列表 */
  items: MemoryItem[];
}

/** 提炼输入 */
export interface ExtractionInput {
  /** 用户消息内容 */
  userMessage: string;
  /** 助手回复内容 */
  assistantResponse: string;
  /** 本轮消耗的 token 数 */
  tokens: number;
  /** 本轮工具调用次数 */
  toolCalls: number;
}

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_CONFIG: MemoryThresholdConfig = {
  /**
   * 降低 token 阈值从 20K→5K，确保在首次 compact 之前就完成第一次记忆提取。
   * 避免在"压缩过的信息"上做二次摘要。
   */
  tokenThreshold: 5_000,
  /** 降低工具调用阈值从 10→5，更早捕获关键操作 */
  toolCallThreshold: 5,
};

const MEMORY_FILE = 'memory.md';

/** memory.md 大小上限（bytes），约 2.5K token，超出后触发 LLM 压缩 */
const MAX_MEMORY_FILE_SIZE = 10_000;

// ============================================================================
// Markdown 模板
// ============================================================================

const MEMORY_TEMPLATE = `# Session Memory

> 自动维护的会话记忆，记录关键讨论、决策、文件变更和代码引用。

## 关键讨论

_暂无记录_

## 决策记录

_暂无记录_

## 文件变更

_暂无记录_

## 代码引用

_暂无记录_

## 待办事项

_暂无记录_
`;

// ============================================================================
// SessionMemoryManager
// ============================================================================

export class SessionMemoryManager {
  private config: MemoryThresholdConfig;
  private memoryDir: string;
  private embeddingManager?: EmbeddingManager;
  private vectorIndex: Map<string, VectorEntry[]> = new Map();

  /**
   * @param sessionsBaseDir 会话存储根目录（如 ~/.pyapp/data/sessions）
   * @param config 阈值配置
   * @param embeddingManager 嵌入管理器（可选，用于向量搜索）
   */
  constructor(
    sessionsBaseDir: string,
    config?: Partial<MemoryThresholdConfig>,
    embeddingManager?: EmbeddingManager
  ) {
    this.memoryDir = sessionsBaseDir;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.embeddingManager = embeddingManager;

    if (!existsSync(this.memoryDir)) {
      mkdirSync(this.memoryDir, { recursive: true });
    }
  }

  // ── 公共 API ──

  /**
   * 获取会话记忆文件路径
   */
  getMemoryPath(sessionId: string): string {
    // 路径格式: <sessionsDir>/<sessionId>/memory.md
    // 安全加固：sessionId 含 ../ 等可穿越到 memoryDir 外（sessionId 多来源于
    // 用户输入/通道 ID），用 path.join 归一化并校验仍位于 memoryDir 内。
    const normalized = join(this.memoryDir, sessionId, MEMORY_FILE);
    if (!normalized.startsWith(this.memoryDir)) {
      throw new Error(`非法 sessionId，拒绝穿越路径: ${sessionId}`);
    }
    return normalized;
  }

  /**
   * 加载会话记忆
   * 若文件不存在，返回空记忆对象。
   */
  loadMemory(sessionId: string): SessionMemory {
    const path = this.getMemoryPath(sessionId);
    if (!existsSync(path)) {
      return {
        sessionId,
        updatedAt: new Date().toISOString(),
        processedTokens: 0,
        processedToolCalls: 0,
        items: [],
      };
    }

    try {
      const raw = readFileSync(path, 'utf-8');
      return this.parseMemoryMarkdown(sessionId, raw);
    } catch (err) {
      logger.warn('加载记忆文件失败，回退到空记忆', {
        sessionId,
        error: String(err),
      });
      return {
        sessionId,
        updatedAt: new Date().toISOString(),
        processedTokens: 0,
        processedToolCalls: 0,
        items: [],
      };
    }
  }

  /**
   * 检查是否达到提炼阈值
   * @returns true 表示应触发提炼
   */
  shouldExtract(memory: SessionMemory): boolean {
    const { tokenThreshold, toolCallThreshold } = this.config;
    return (
      memory.processedTokens >= tokenThreshold ||
      memory.processedToolCalls >= toolCallThreshold
    );
  }

  /**
   * 初始化记忆文件（首次创建会话时调用）
   * 写入模板并返回空记忆对象。
   */
  initMemory(sessionId: string): SessionMemory {
    const path = this.getMemoryPath(sessionId);
    const sessionDir = dirname(path);

    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }

    if (!existsSync(path)) {
      writeFileSync(path, MEMORY_TEMPLATE, 'utf-8');
    }

    return {
      sessionId,
      updatedAt: new Date().toISOString(),
      processedTokens: 0,
      processedToolCalls: 0,
      items: [],
    };
  }

  /**
   * 累计本轮数据并判断是否需要触发提炼
   * @returns { memory, shouldTrigger } 更新后的记忆 + 是否触发
   */
  accumulateTurn(
    memory: SessionMemory,
    input: ExtractionInput
  ): { memory: SessionMemory; shouldTrigger: boolean } {
    memory.processedTokens += input.tokens;
    memory.processedToolCalls += input.toolCalls;
    return {
      memory,
      shouldTrigger: this.shouldExtract(memory),
    };
  }

  /**
   * 将提炼结果追加到 Markdown 文件并重置计数器
   */
  appendToMemory(memory: SessionMemory, newItems: MemoryItem[]): SessionMemory {
    const path = this.getMemoryPath(memory.sessionId);

    // B2 修复：全量重写前先合并磁盘已有记忆（含 extractPerTurn 行级追加的
    // [timestamp] 条目），避免 buildMemoryMarkdown 把逐轮提取的行悄悄清掉
    const existing = this.loadMemory(memory.sessionId);
    const seen = new Set(memory.items.map((i) => `${i.type}:${i.content}`));
    for (const item of existing.items) {
      const key = `${item.type}:${item.content}`;
      if (!seen.has(key)) {
        memory.items.push(item);
        seen.add(key);
      }
    }

    // 追加新记忆项
    for (const item of newItems) {
      const key = `${item.type}:${item.content}`;
      if (!seen.has(key)) {
        memory.items.push(item);
        seen.add(key);
      }
    }

    // 重置计数器
    memory.processedTokens = 0;
    memory.processedToolCalls = 0;
    memory.updatedAt = new Date().toISOString();

    // 生成 Markdown 并写入文件
    const markdown = this.buildMemoryMarkdown(memory);
    const sessionDir = dirname(path);
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }
    writeFileSync(path, markdown, 'utf-8');

    // 异步触发向量化索引（不阻塞主流程）
    // @ignore-catch — 异步向量化索引fire-and-forget，不阻塞主流程
    this.indexMemoryItems(memory.sessionId, newItems).catch(() => {});

    logger.info('记忆提炼完成', {
      sessionId: memory.sessionId,
      newItems: newItems.length,
      totalItems: memory.items.length,
    });

    return memory;
  }

  /**
   * 获取记忆内容的 Markdown 文本（用于注入系统提示词）
   */
  getMemoryContext(sessionId: string): string {
    const memory = this.loadMemory(sessionId);
    if (memory.items.length === 0) return '';
    return this.buildMemoryContextText(memory);
  }

  /**
   * 语义搜索会话记忆（向量召回）
   * 若未配置 EmbeddingManager，回退到关键词匹配。
   *
   * @param sessionId 会话 ID
   * @param query 搜索查询
   * @param topK 返回结果数量
   */
  async searchMemory(
    sessionId: string,
    query: string,
    topK: number = 5
  ): Promise<MemoryItem[]> {
    const memory = this.loadMemory(sessionId);
    if (memory.items.length === 0) return [];

    // 若无 EmbeddingManager，回退到关键词匹配
    if (!this.embeddingManager) {
      return this.keywordSearch(memory.items, query, topK);
    }

    try {
      // 确保记忆项已索引
      await this.ensureIndexed(sessionId, memory.items);

      const queryVec = await this.embeddingManager.embedOne(query);
      const entries = this.vectorIndex.get(sessionId) || [];

      // 余弦相似度排序
      const scored = entries.map((entry) => ({
        item: entry.item,
        score: this.cosineSimilarity(queryVec, entry.vector),
      }));
      scored.sort((a, b) => b.score - a.score);

      return scored.slice(0, topK).map((s) => s.item);
    } catch (err) {
      logger.warn('向量搜索失败，回退到关键词搜索', {
        sessionId,
        error: String(err),
      });
      return this.keywordSearch(memory.items, query, topK);
    }
  }

  /**
   * 批量索引记忆项（在提炼后调用）
   */
  async indexMemoryItems(
    sessionId: string,
    items: MemoryItem[]
  ): Promise<void> {
    if (!this.embeddingManager || items.length === 0) return;

    try {
      const texts = items.map((i) => `[${i.type}] ${i.content}`);
      const result = await this.embeddingManager.embed(texts);

      const entries: VectorEntry[] = items.map((item, idx) => ({
        item,
        vector: result.embeddings[idx],
      }));
      // B3 修复：追加而非覆盖——原实现每次新提炼后 set 覆盖整个 session 的索引，
      // 旧条目从索引消失，语义搜索丢失历史
      const existing = this.vectorIndex.get(sessionId) || [];
      const seen = new Set(
        existing.map((e) => `${e.item.type}:${e.item.content}`)
      );
      const merged = [...existing];
      for (const entry of entries) {
        const key = `${entry.item.type}:${entry.item.content}`;
        if (!seen.has(key)) {
          merged.push(entry);
          seen.add(key);
        }
      }
      this.vectorIndex.set(sessionId, merged);
    } catch (err) {
      logger.warn('记忆向量化失败，不影响主流程', {
        sessionId,
        error: String(err),
      });
    }
  }

  /**
   * 读取原始 Markdown 记忆内容（用于 LLM 提炼时的全文输入）
   */
  readRawMemory(sessionId: string): string | null {
    const path = this.getMemoryPath(sessionId);
    try {
      return existsSync(path) ? readFileSync(path, 'utf-8') : null;
    } catch (err) {
      return null;
    }
  }

  /**
   * 写入原始 Markdown 记忆内容（LLM 提炼后覆盖写入）
   * 同时重置计数器
   */
  writeRawMemory(sessionId: string, content: string): void {
    const path = this.getMemoryPath(sessionId);
    const sessionDir = dirname(path);
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }
    writeFileSync(path, content, 'utf-8');
    // B3 修复：覆盖写入后内存向量索引已 stale，删除让下次 searchMemory 重新索引
    this.vectorIndex.delete(sessionId);
  }

  /**
   * 逐轮轻量提取：每轮结束后提取关键事实
   * 不做完整的 LLM 提炼，仅基于本轮内容做关键词+规则提取
   *
   * 这是批次 LLM 提取（accumulateTurn→shouldExtract→LLM 提炼）的补充，
   * 确保轮次间信息不裸奔——即使系统崩溃，最多丢失当前轮的信息。
   *
   * @param sessionId 会话 ID
   * @param turnMessages 本轮消息
   * @returns 提取的关键事实
   */
  extractPerTurn(sessionId: string, turnMessages: ChatMessage[]): MemoryItem[] {
    const items: MemoryItem[] = [];

    // 从工具调用参数直接提取（结构化，不依赖自然语言关键词）
    for (const msg of turnMessages) {
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch (err) {
            // KB-MEM-ARG-PARSE（2026-08-29）：工具参数解析失败 → 该工具的 file_change
            // 记忆提取静默丢失
            logger.warn('工具调用参数解析失败，跳过记忆提取', {
              sessionId,
              toolName: tc.function.name,
              error: err instanceof Error ? err.message : String(err),
            });
          }

          const filePath = (args.filePath ?? args.path ?? args.file) as
            | string
            | undefined;
          if (typeof filePath === 'string') {
            items.push({
              type: 'file_change',
              content: `工具 ${tc.function.name} → ${filePath}`,
            });
          }

          // 提取决策类工具的参数
          if (args.decision || args.choice) {
            items.push({
              type: 'decision',
              content: String(args.decision ?? args.choice),
            });
          }
        }
      }

      // 提取 user 消息中的显式路径引用（反引号包围的路径）
      if (msg.role === 'user' && typeof msg.content === 'string') {
        const refs = msg.content.match(
          /`([^`]+\.(?:ts|tsx|js|py|rs|md|yaml|yml|json))`/g
        );
        if (refs) {
          for (const ref of refs) {
            items.push({
              type: 'code_reference',
              content: ref.replace(/`/g, ''),
            });
          }
        }
      }
    }

    // 持久化追加到 memory.md（立即落盘，不等待 LLM 提炼）
    if (items.length > 0) {
      this._appendToMemoryFile(sessionId, items);
    }

    return items;
  }

  /**
   * 追加记忆项到 memory.md 文件（行级追加，不重写整个文件）
   */
  private _appendToMemoryFile(sessionId: string, items: MemoryItem[]): void {
    const path = this.getMemoryPath(sessionId);
    const sessionDir = dirname(path);

    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }

    if (!existsSync(path)) {
      // B7 修复：新文件统一写 MEMORY_TEMPLATE（Markdown 模板），
      // 与 initMemory 保持一致，消除双格式双模板
      writeFileSync(path, MEMORY_TEMPLATE, 'utf-8');
    }

    const lines = items.map(
      (item) => `[${new Date().toISOString()}] [${item.type}] ${item.content}`
    );
    appendFileSync(path, '\n' + lines.join('\n'), 'utf-8');

    // 检查是否需要压缩
    this._ensureMemoryFileSize(sessionId);
  }

  /**
   * 检查 memory.md 大小，超出上限时触发压缩
   */
  private _ensureMemoryFileSize(sessionId: string): void {
    const path = this.getMemoryPath(sessionId);
    try {
      if (!existsSync(path)) return;
      const stat = statSync(path);
      if (stat.size > MAX_MEMORY_FILE_SIZE) {
        this._compactMemoryFile(sessionId);
      }
    } catch (err) {
      // 文件操作失败，忽略
    }
  }

  /**
   * LLM 压缩 memory.md：保留最近 10 条精确记录，其余压缩为摘要
   * 降级策略：截断到最近 20 条
   */
  private _compactMemoryFile(sessionId: string): void {
    const path = this.getMemoryPath(sessionId);
    try {
      const content = readFileSync(path, 'utf-8');
      const lines = content
        .split('\n')
        .filter((l) => l.trim() && !l.startsWith('#'));
      const header = content
        .split('\n')
        .filter((l) => l.startsWith('#'))
        .join('\n');

      if (lines.length <= 20) return; // 还不够大，不需要压缩

      // 保留最近 20 条，丢弃旧记录
      const recent = lines.slice(-20);
      const truncated = header + '\n' + recent.join('\n');
      writeFileSync(path, truncated, 'utf-8');

      logger.info('memory.md 截断压缩完成', {
        sessionId,
        originalLines: lines.length,
        keptLines: 20,
      });
    } catch (err) {
      logger.warn('memory.md 压缩失败', { sessionId, error: String(err) });
    }
  }

  // ── 内部方法 ──

  /**
   * 关键词搜索（向量搜索的回退方案）
   */
  private keywordSearch(
    items: MemoryItem[],
    query: string,
    topK: number
  ): MemoryItem[] {
    const queryLower = query.toLowerCase();
    const scored = items.map((item) => {
      const contentLower = item.content.toLowerCase();
      let score = 0;
      if (contentLower.includes(queryLower)) score += 10;
      for (const word of queryLower.split(/\s+/)) {
        if (contentLower.includes(word)) score += 1;
      }
      return { item, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored
      .filter((s) => s.score > 0)
      .slice(0, topK)
      .map((s) => s.item);
  }

  /**
   * 确保指定会话的记忆项已向量化索引
   */
  private async ensureIndexed(
    sessionId: string,
    items: MemoryItem[]
  ): Promise<void> {
    if (this.vectorIndex.has(sessionId)) return;
    await this.indexMemoryItems(sessionId, items);
  }

  /**
   * 余弦相似度计算
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  /**
   * 判断字符串是否为合法的 MemoryItem 类型（B2 修复用）
   */
  private isMemoryItemType(value: string): value is MemoryItem['type'] {
    return (
      value === 'discussion' ||
      value === 'decision' ||
      value === 'file_change' ||
      value === 'code_reference' ||
      value === 'todo'
    );
  }

  /**
   * 从 Markdown 文件解析记忆结构
   */
  private parseMemoryMarkdown(sessionId: string, raw: string): SessionMemory {
    const items: MemoryItem[] = [];
    let currentType: MemoryItem['type'] | null = null;
    let processedTokens = 0;
    let processedToolCalls = 0;

    const lines = raw.split('\n');
    for (const line of lines) {
      // 提取元数据
      const tokenMatch = line.match(/processedTokens:\s*(\d+)/);
      if (tokenMatch) processedTokens = parseInt(tokenMatch[1], 10);

      const toolMatch = line.match(/processedToolCalls:\s*(\d+)/);
      if (toolMatch) processedToolCalls = parseInt(toolMatch[1], 10);

      // B2 修复：解析 extractPerTurn 行级追加格式 [ISO] [category] content，
      // 这类行不属于任何 ## 段落，原实现读不回 → 逐轮提取内容静默丢失
      const perTurnMatch = line.match(/^\s*\[[^\]]+\]\s*\[(\w+)\]\s*(.+)$/);
      if (perTurnMatch) {
        const content = perTurnMatch[2].trim();
        if (content && this.isMemoryItemType(perTurnMatch[1])) {
          items.push({ type: perTurnMatch[1] as MemoryItem['type'], content });
        }
        continue;
      }

      // 检测段落标题
      if (line.startsWith('## 关键讨论')) currentType = 'discussion';
      else if (line.startsWith('## 决策记录')) currentType = 'decision';
      else if (line.startsWith('## 文件变更')) currentType = 'file_change';
      else if (line.startsWith('## 代码引用')) currentType = 'code_reference';
      else if (line.startsWith('## 待办事项')) currentType = 'todo';
      // 非段落开头的 "## " 重置类型（文件末尾可能有多个 ##）
      else if (line.startsWith('## ')) currentType = null;

      // 提取列表项
      if (
        currentType &&
        line.trim().startsWith('- ') &&
        line.trim().length > 3
      ) {
        const content = line.trim().slice(2).trim();
        if (content && content !== '_暂无记录') {
          items.push({ type: currentType, content });
        }
      }
    }

    return {
      sessionId,
      updatedAt: new Date().toISOString(),
      processedTokens,
      processedToolCalls,
      items,
    };
  }

  /**
   * 构建 Markdown 文件内容
   */
  private buildMemoryMarkdown(memory: SessionMemory): string {
    const group = (type: MemoryItem['type'], title: string): string => {
      const filtered = memory.items.filter((i) => i.type === type);
      if (filtered.length === 0) return `## ${title}\n\n_暂无记录_\n`;
      return `## ${title}\n\n${filtered.map((i) => `- ${i.content}`).join('\n')}\n`;
    };

    return [
      '# Session Memory',
      '',
      `> 自动维护 | 更新: ${memory.updatedAt}`,
      `> processedTokens: ${memory.processedTokens} | processedToolCalls: ${memory.processedToolCalls}`,
      '',
      group('discussion', '关键讨论'),
      group('decision', '决策记录'),
      group('file_change', '文件变更'),
      group('code_reference', '代码引用'),
      group('todo', '待办事项'),
    ].join('\n');
  }

  /**
   * 构建用于注入 LLM 上下文的记忆文本
   */
  private buildMemoryContextText(memory: SessionMemory): string {
    if (memory.items.length === 0) return '';

    const group = (type: MemoryItem['type'], label: string): string => {
      const filtered = memory.items.filter((i) => i.type === type);
      if (filtered.length === 0) return '';
      return `### ${label}\n${filtered.map((i) => `- ${i.content}`).join('\n')}`;
    };

    const sections = [
      group('discussion', '历史讨论'),
      group('decision', '已做决策'),
      group('file_change', '文件变更'),
      group('code_reference', '代码参考'),
      group('todo', '当前待办'),
    ]
      .filter(Boolean)
      .join('\n\n');

    return sections
      ? `\n\n## 会话历史记忆\n\n以下是此前对话中提炼的关键信息，请在后续回复中参考：\n\n${sections}`
      : '';
  }
}
