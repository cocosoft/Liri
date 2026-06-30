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

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO, module: 'session:memory' });

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
  tokenThreshold: 20_000,
  toolCallThreshold: 10,
};

const MEMORY_FILE = 'memory.md';

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

  /**
   * @param sessionsBaseDir 会话存储根目录（如 ~/.pyapp/data/sessions）
   * @param config 阈值配置
   */
  constructor(
    sessionsBaseDir: string,
    config?: Partial<MemoryThresholdConfig>
  ) {
    this.memoryDir = sessionsBaseDir;
    this.config = { ...DEFAULT_CONFIG, ...config };

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
    const sessionDir = `${this.memoryDir}/${sessionId}`;
    return `${sessionDir}/${MEMORY_FILE}`;
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

    // 追加新记忆项
    for (const item of newItems) {
      memory.items.push(item);
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
   * 读取原始 Markdown 记忆内容（用于 LLM 提炼时的全文输入）
   */
  readRawMemory(sessionId: string): string | null {
    const path = this.getMemoryPath(sessionId);
    try {
      return existsSync(path) ? readFileSync(path, 'utf-8') : null;
    } catch {
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
  }

  // ── 内部方法 ──

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
