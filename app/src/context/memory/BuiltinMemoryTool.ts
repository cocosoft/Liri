/**
 * BuiltinMemoryTool — 内置文件记忆实现（Phase 5）
 * 对标 hermes-agent tools/memory_tool.py (MEMORY.md / USER.md)
 *
 * 基于文件系统的持久化记忆，存储在 ~/.pyapp/memories/ 目录下。
 * 会话结束时通过 LLM 提取关键信息并更新 MEMORY.md。
 */
import type { ChatMessage } from '../../ai/models/types';
import type { MemoryProvider, MemoryRetrieveResult } from './MemoryProvider';
import { Logger, LogLevel } from '@modules/monitoring';
import { resolvePyappHome } from '@modules/core/paths';
import { handleError } from '@modules/error';

const logger = new Logger({
  module: 'context:memory:builtin',
  level: LogLevel.INFO,
});

const MEMORY_EXTRACTION_PROMPT = `You are a memory extraction assistant. Your task is to read the conversation below and extract key facts about the USER that should be remembered for future sessions.

Extract ONLY:
1. User's personal information (name, background, preferences, tech stack)
2. Key decisions made by the user
3. Ongoing projects and their status
4. User's explicit preferences or requirements

Do NOT include:
- Transient conversation details
- Your own responses or assistant behavior
- Generic information that won't be useful in future sessions

Output format: Plain markdown bullet points. No preamble, no "Here's a summary", just the facts.
If there's nothing new worth remembering, output "NO_NEW_FACTS".`;

/** 记忆存储目录 */
function getMemoryDir(): string {
  return resolvePyappHome() + '/memories';
}

export class BuiltinMemoryTool implements MemoryProvider {
  readonly name = 'builtin';

  private initialized = false;
  private memoryContent = '';
  private userContent = '';
  private sessionId = '';

  constructor() {
    process.emitWarning(
      'context/memory/BuiltinMemoryTool 已废弃，syncTurn 已委派至 src/memory/MemoryManagerImpl.processConversation',
      'DeprecationWarning'
    );
  }

  /** Phase 0: 已处理的消息 hash 集合（幂等去重） */
  private processedHashes = new Set<string>();
  /** Phase 0: 新系统 MemoryManagerImpl 凭证引用（懒初始化） */
  private _newSystemManager: unknown = null;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async initialize(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    this.initialized = true;

    // 加载 MEMORY.md 和 USER.md
    const fs = await import('fs/promises');
    const dir = getMemoryDir();

    try {
      this.memoryContent = await fs.readFile(`${dir}/MEMORY.md`, 'utf-8');
    } catch {
      this.memoryContent = '';
    }

    try {
      this.userContent = await fs.readFile(`${dir}/USER.md`, 'utf-8');
    } catch {
      this.userContent = '';
    }
  }

  async prefetch(
    _query: string,
    _sessionId: string
  ): Promise<MemoryRetrieveResult> {
    if (!this.initialized) return { systemContext: '' };

    // 语义搜索：如果 query 非空，按关键词相关性过滤记忆
    let memoryText = this.memoryContent;
    if (_query && _query.length > 0 && this.memoryContent) {
      const sections = this.memoryContent.split('\n---\n');
      const queryLower = _query.toLowerCase();
      const keywords = queryLower.split(/\s+/).filter((k) => k.length > 1);

      if (keywords.length > 0 && sections.length > 1) {
        // 对每个 session section 打分，按相关性排序
        const scored = sections.map((section) => {
          const sectionLower = section.toLowerCase();
          let score = 0;
          for (const kw of keywords) {
            if (sectionLower.includes(kw)) score += 1;
          }
          return { section, score };
        });

        // 保留所有有匹配的 section + 最近 2 个无匹配的 section（保持上下文连贯）
        const matched = scored
          .filter((s) => s.score > 0)
          .sort((a, b) => b.score - a.score);
        const unmatched = scored.filter((s) => s.score === 0).slice(-2);

        if (matched.length > 0) {
          memoryText = [...matched, ...unmatched]
            .sort(() => 0) // 不去重排序，保持原有逻辑
            .slice(0, 10) // 最多 10 个 section
            .map((s) => s.section)
            .join('\n---\n');
        }
      }
    }

    const parts: string[] = [];
    if (memoryText) {
      parts.push(`## Memory\n\n${memoryText}`);
    }
    if (this.userContent) {
      parts.push(`## User Preferences\n\n${this.userContent}`);
    }

    return {
      systemContext: parts.join('\n\n'),
      metadata: {
        memorySize: memoryText.length,
        userSize: this.userContent.length,
      },
    };
  }

  /**
   * Phase 0: 每轮对话结束后委派新系统处理记忆
   * - 幂等：基于内容 hash 去重
   * - 异步非阻塞：fire-and-forget，不阻塞用户响应
   */
  async syncTurn(
    _userContent: string,
    _assistantContent: string,
    _sessionId: string
  ): Promise<void> {
    if (!_userContent && !_assistantContent) return;

    // 幂等去重
    const hash = this.hashContent32(_userContent + _assistantContent);
    if (this.processedHashes.has(hash)) return;
    this.processedHashes.add(hash);

    // 上限保护：防止 Set 无限增长
    if (this.processedHashes.size > 10000) {
      const arr = [...this.processedHashes];
      this.processedHashes = new Set(arr.slice(-5000));
    }

    // 异步非阻塞：不等待记忆处理完成
    this._delegateToNewSystem(
      _userContent,
      _assistantContent,
      _sessionId
    ).catch((err) => {
      handleError(err, {
        module: 'context:memory:builtin',
        action: 'delegate_sync',
      });
    });
  }

  /**
   * Phase 0: 实际委派逻辑（后台执行）
   */
  private async _delegateToNewSystem(
    userContent: string,
    assistantContent: string,
    sessionId: string
  ): Promise<void> {
    // 懒初始化新系统（首次调用时创建）
    if (!this._newSystemManager) {
      const { MemoryManagerImpl } =
        await import('../../../src/memory/MemoryManager');
      this._newSystemManager = new MemoryManagerImpl();
    }

    const manager = this._newSystemManager as {
      delegateProcessConversation(
        conversationId: string,
        messages: Array<{ role: string; content: string; timestamp: Date }>
      ): Promise<unknown>;
    };

    const now = new Date();
    const messages: Array<{ role: string; content: string; timestamp: Date }> =
      [];
    if (userContent) {
      messages.push({ role: 'user', content: userContent, timestamp: now });
    }
    if (assistantContent) {
      messages.push({
        role: 'assistant',
        content: assistantContent,
        timestamp: now,
      });
    }

    await manager.delegateProcessConversation(sessionId, messages);
  }

  /**
   * Phase 0: 简单字符串 hash（djb2 变体，仅用于幂等，不要求加密强度）
   */
  private hashContent32(content: string): string {
    let hash = 5381;
    for (let i = 0; i < content.length; i++) {
      hash = ((hash << 5) + hash + content.charCodeAt(i)) | 0;
    }
    return hash.toString(36);
  }

  /**
   * Phase 0: 记忆系统诊断命令
   */
  async diag(): Promise<string> {
    const lines: string[] = ['━━━ 记忆系统诊断 ━━━━━━━━━━━━━━━━━━━━━━━'];

    // 新系统状态
    try {
      const { MemoryManagerImpl } =
        await import('../../../src/memory/MemoryManager');
      const newMgr = this._newSystemManager as {
        getAllMemories(): Promise<unknown[]>;
      } | null;
      if (newMgr) {
        const allMemories = (await newMgr.getAllMemories()) as Array<
          Record<string, unknown>
        >;
        const withVectors = allMemories.filter(
          (m) => m.metadata && (m.metadata as Record<string, unknown>).vectorId
        ).length;
        lines.push(
          `\u2705 新系统读取: OK (${allMemories.length} 条记忆, ${withVectors} 条有向量)`
        );
        lines.push(`\u2705 新系统写入: OK (syncTurn 委派中)`);
        lines.push(
          `\u2501\u2501\u2501 统计 \u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`
        );
        lines.push(`记忆总数: ${allMemories.length}`);
        lines.push(`有向量: ${withVectors}`);
        lines.push(`幂等缓存: ${this.processedHashes.size} 条`);
      } else {
        lines.push('\u26A0\uFE0F 新系统: 未初始化（等待首轮对话）');
      }
    } catch (err) {
      handleError(err, {
        module: 'context:memory:builtin',
        action: 'diag_new_system',
      });
      lines.push(`\u274C 新系统: 错误 - ${String(err)}`);
    }

    // 旧系统状态
    try {
      const fs = await import('fs/promises');
      const dir = getMemoryDir();
      const stat = await fs
        .stat(`${dir}/MEMORY.md`)
        .catch(
          () => null /* @ignore-catch: fs stat in diag, failure means no file */
        );
      const hasMigrated = await fs
        .stat(`${dir}/MEMORY.md.migrated`)
        .catch(
          () =>
            false /* @ignore-catch: fs stat in diag, failure means no file */
        );
      if (hasMigrated) {
        lines.push(`\u2705 旧系统: 已迁移`);
      } else if (stat) {
        lines.push(`\u26A0\uFE0F 旧系统: 待迁移 (${stat.size} 字节)`);
      } else {
        lines.push(`\u2705 旧系统: 无数据或已迁移`);
      }
    } catch {
      /* diag: fs stat failed */
      lines.push('\u26A0\uFE0F 旧系统: 无法检测');
    }

    lines.push(
      '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501'
    );
    return lines.join('\n');
  }

  buildSystemPromptBlock(): string {
    if (!this.memoryContent && !this.userContent) return '';
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return (
      '<memory-context>\n' +
      'The following context from previous sessions may be relevant:\n' +
      (this.memoryContent
        ? `\n## Memory\n${esc(this.memoryContent.slice(0, 5000))}\n`
        : '') +
      (this.userContent
        ? `\n## User Preferences\n${esc(this.userContent.slice(0, 2000))}\n`
        : '') +
      '</memory-context>'
    );
  }

  /**
   * 会话结束时提取长期记忆并更新 MEMORY.md
   *
   * TODO: Phase 4 — 迁移到新系统。当前仍直接写 MEMORY.md 文件，
   * 与 syncTurn 委派的新系统 MemoryManagerImpl.processConversation 形成双轨。
   * 迁移后应改为：LLM 提取 → MemoryManagerImpl.createMemory() → 新系统存储。
   */
  async onSessionEnd(
    messages: ChatMessage[],
    _sessionId: string
  ): Promise<void> {
    if (!this.initialized || messages.length === 0) return;

    // 构建提取用的消息列表（取最后 50 条，平衡上下文大小和覆盖范围）
    const recentMessages = messages.slice(-50);
    const conversationText = recentMessages
      .map(
        (m) =>
          `[${m.role}]: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`
      )
      .join('\n\n');

    if (conversationText.length < 100) {
      logger.debug('memory:extraction_skipped', { reason: 'too_short' });
      return;
    }

    try {
      // 动态 import aiService 避免循环依赖（context/memory 不应在模块顶层依赖 ai）
      const { default: aiService, AIMessageRole } =
        await import('../../ai/index');
      const response = await aiService.generate(
        [
          { role: AIMessageRole.SYSTEM, content: MEMORY_EXTRACTION_PROMPT },
          { role: AIMessageRole.USER, content: conversationText },
        ],
        '', // 空字符串 = 使用默认 provider
        { temperature: 0.3, max_tokens: 2048 }
      );

      const extracted = response.content?.trim();
      if (!extracted || extracted === 'NO_NEW_FACTS') {
        logger.debug('memory:extraction_no_new_facts');
        return;
      }

      // 合并到现有记忆：追加而非覆盖
      const merged = this.memoryContent
        ? `${this.memoryContent}\n\n---\n\n## Session ${new Date().toISOString().slice(0, 10)}\n${extracted}`
        : extracted;

      // 写入 MEMORY.md
      const fs = await import('fs/promises');
      const dir = getMemoryDir();
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(`${dir}/MEMORY.md`, merged, 'utf-8');

      // 更新内存缓存
      this.memoryContent = merged;

      logger.info('memory:extraction_saved', {
        extractedChars: extracted.length,
        totalChars: merged.length,
        sessionId: this.sessionId,
      });
    } catch (err) {
      handleError(err, {
        module: 'context:memory:builtin',
        action: 'extraction_save',
      });
      // 提取失败不阻塞会话关闭
    }
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }
}
