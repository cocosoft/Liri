/**
 * 旧 messages.jsonl → events.jsonl 转换器
 *
 * 设计参考：deepseek-harness packages/core/session/src/types.ts
 * 父方案：dev_docs/20260821/M1-事件溯源迁移-详细技术方案.md §3
 *
 * 触发时机：会话首次被打开时，EventLogStorage.exists() 返回 false
 *          且 messages.jsonl 存在
 *
 * 转换规则：详见父方案 §6.1
 *   - role: user + content        → user/message
 *   - assistant.content 含 thinking 段 → 拆为 assistant/thinking + assistant/text
 *   - assistant.tool_calls        → 每个拆为 assistant/tool_call
 *   - role: tool + toolCallId     → tool/result（callSeq 主流程回填）
 *   - blocks[] 中 status 块      → context/compaction
 *   - timestamp                   → time
 *
 * seq 分配：按旧 messages.jsonl 的文件顺序，从 1 开始递增
 *
 * 回滚：转换后原 messages.jsonl 重命名为 messages.jsonl.bak，保留 30 天
 *      转换失败不备份原文件，保留原 messages.jsonl
 */

import { promises as fs, existsSync, createReadStream } from 'fs';
import { join, dirname } from 'path';
import * as readline from 'readline';
import { resolveSessionsDir } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring/logs/Logger.js';
import { handleError } from '@modules/error';
import type { LiriEvent } from '@modules/chat/types/events';
import type { Message } from '@modules/chat/types/message';
import { MessageStatus } from '@modules/chat/types/message';
import { EventLogStorage } from './EventLogStorage';

const logger = getLogger('session:migrator');

// ─── 类型定义 ───────────────────────────────────────────────────────────────

/** 迁移结果 */
export interface MigrationResult {
  /** 会话 ID */
  sessionId: string;
  /** 处理的消息条数 */
  migrated: number;
  /** 生成的事件数 */
  generated: number;
  /** 原文件备份路径（无备份时为空字符串） */
  backupPath: string;
  /** 单条消息转换错误（不阻断整体迁移） */
  errors: Array<{ messageIndex: number; messageId?: string; reason: string }>;
}

/** 单条消息转换结果（内部用） */
interface ConvertResult {
  events: LiriEvent[];
  /** 下一可用 seq */
  nextSeq: number;
}

// ─── 常量 ───────────────────────────────────────────────────────────────────

/**
 * thinking 段匹配正则
 *
 * 兼容两种标签：
 *   - <RichMediaReference>...</RichMediaReference>（旧版）
 *   - <thinking>...</thinking>（新版）
 *
 * 兼容未闭合的半截（流式中断场景）：
 *   - 开头未闭合：<thinking>...（直到字符串末尾）
 *   - 结尾未闭合：...</thinking>（从字符串开头匹配）
 */
const THINKING_PATTERN =
  /<RichMediaReference>([\s\S]*?)<\/RichMediaReference>|<thinking>([\s\S]*?)<\/thinking>/gi;

/** 未闭合的 thinking 开头（流式中断） */
const UNCLOSED_THINKING_START = /<RichMediaReference>[\s\S]*$/gi;

/** 未闭合的 thinking 结尾（流式中断） */
const UNCLOSED_THINKING_END = /^[\s\S]*?<\/(?:RichMediaReference|thinking)>/gi;

// ─── MessageToEventMigrator ─────────────────────────────────────────────────

/**
 * 旧数据迁移转换器
 *
 * 一个实例对应一个会话的迁移任务。
 */
export class MessageToEventMigrator {
  private readonly sessionDir: string;
  private readonly messagesFilePath: string;
  private readonly messagesBackupPath: string;

  constructor(
    private readonly eventLog: EventLogStorage,
    private readonly sessionId: string,
    private readonly worktreeHash: string = 'default'
  ) {
    this.sessionDir = this.buildSessionDir();
    this.messagesFilePath = join(this.sessionDir, 'messages.jsonl');
    this.messagesBackupPath = join(this.sessionDir, 'messages.jsonl.bak');
  }

  /**
   * 构建会话目录路径
   *
   * 复用 EventLogStorage 的路径解析逻辑，保证迁移器与存储器定位同一目录。
   */
  private buildSessionDir(): string {
    const env: NodeJS.ProcessEnv = { PYAPP_PROJECT_DIR: '' };
    const sessionsRoot = dirname(resolveSessionsDir(env));
    return join(sessionsRoot, this.worktreeHash, this.sessionId);
  }

  /**
   * 检测是否需要迁移
   *
   * 条件：messages.jsonl 存在 且 events.jsonl 不存在
   * 若 events.jsonl 已存在（已迁移过），即使 messages.jsonl 存在也不迁移
   */
  needsMigration(): boolean {
    // 主判定：messages.jsonl 存在且 events.jsonl 不存在 → 全新迁移
    if (existsSync(this.messagesFilePath) && !this.eventLog.exists()) {
      return true;
    }
    // KB-MIG-REENTER（2026-08-29）：迁移中途崩溃（appendBatch 逐条 appendFile
    // 写一半进程被杀）→ events.jsonl 半成品存在但 messages.jsonl.bak 未备份
    // （备份 = 迁移成功标记）→ 判定为"未完成迁移"，migrate() 先清理半成品再重来，
    // 杜绝该会话后段消息永久停留在未迁移状态（事件流不完整、数据语义断裂）。
    if (
      existsSync(this.messagesFilePath) &&
      this.eventLog.exists() &&
      !existsSync(this.messagesBackupPath)
    ) {
      return true;
    }
    return false;
  }

  /**
   * 执行迁移
   *
   * 流程：
   *   1. 读取 messages.jsonl（流式逐行）
   *   2. 第一遍：建立 toolCallId → seq 映射（用于 tool/result 回填）
   *   3. 第二遍：转换每条消息并 appendBatch 写入 events.jsonl
   *   4. 备份原 messages.jsonl
   *
   * 失败处理：
   *   - 单条转换失败：记录到 errors，跳过，继续下一条
   *   - 整体写入失败：删除半成品 events.jsonl，不备份原文件
   */
  async migrate(): Promise<MigrationResult> {
    const result: MigrationResult = {
      sessionId: this.sessionId,
      migrated: 0,
      generated: 0,
      backupPath: '',
      errors: [],
    };

    if (!this.needsMigration()) {
      logger.info('migrator: 无需迁移', {
        sessionId: this.sessionId,
        messagesExists: existsSync(this.messagesFilePath),
        eventsExists: this.eventLog.exists(),
      });
      return result;
    }

    logger.info('migrator: 开始迁移', {
      sessionId: this.sessionId,
      messagesFilePath: this.messagesFilePath,
    });

    // KB-MIG-REENTER（2026-08-29）：续迁场景（半成品 events.jsonl 存在且
    // messages.jsonl.bak 未备份）——先清理半成品，避免 appendBatch 追加时
    // seq 与半成品冲突（重复 seq/乱序）。
    if (this.eventLog.exists() && !existsSync(this.messagesBackupPath)) {
      await this.cleanupFailedMigration();
    }

    // Step 1: 读取全部消息（按文件顺序）
    const messages = await this.readAllMessages();
    if (messages.length === 0) {
      logger.warn('migrator: messages.jsonl 为空或读取失败', {
        sessionId: this.sessionId,
      });
      return result;
    }

    // Step 2: 第一遍扫描 —— 转换并生成事件（含 callSeq 占位）
    const allEvents: LiriEvent[] = [];
    let nextSeq = 1;
    const toolCallSeqMap = new Map<string, number>();

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      try {
        const convertResult = this.convertMessage(message, nextSeq, Date.now());
        // 建立 toolCallId → seq 映射
        for (const event of convertResult.events) {
          if (event.type === 'assistant/tool_call') {
            const data = event.data as { toolCallId: string };
            toolCallSeqMap.set(data.toolCallId, event.seq);
          }
        }
        allEvents.push(...convertResult.events);
        nextSeq = convertResult.nextSeq;
        result.migrated++;
      } catch (e) {
        result.errors.push({
          messageIndex: i,
          messageId: message.id,
          reason: String(e),
        });
        logger.warn('migrator: 单条消息转换失败，跳过', {
          sessionId: this.sessionId,
          messageIndex: i,
          messageId: message.id,
          error: String(e),
        });
      }
    }

    // Step 3: 回填 tool/result 的 callSeq
    for (const event of allEvents) {
      if (event.type === 'tool/result') {
        const data = event.data as {
          callSeq: number;
          toolCallId: string;
        };
        if (data.callSeq === -1) {
          data.callSeq = toolCallSeqMap.get(data.toolCallId) ?? -1;
        }
      }
    }

    // Step 4: 批量写入 events.jsonl
    const batchResult = await this.eventLog.appendBatch(allEvents);
    result.generated = batchResult.appended;

    if (batchResult.rejected > 0) {
      logger.error('migrator: 批量写入被拒绝', {
        sessionId: this.sessionId,
        appended: batchResult.appended,
        rejected: batchResult.rejected,
        firstRejected: batchResult.firstRejected,
      });
      result.errors.push({
        messageIndex: -1,
        reason: `批量写入被拒绝：${batchResult.rejected} 条，首次拒绝 seq=${batchResult.firstRejected?.seq}`,
      });
      // 写入失败：删除半成品 events.jsonl，保留原 messages.jsonl
      await this.cleanupFailedMigration();
      return result;
    }

    // Step 5: 备份原 messages.jsonl
    await this.backupMessagesFile();
    result.backupPath = this.messagesBackupPath;

    logger.info('migrator: 迁移完成', {
      sessionId: this.sessionId,
      migrated: result.migrated,
      generated: result.generated,
      errors: result.errors.length,
      backupPath: result.backupPath,
    });

    return result;
  }

  /**
   * 单条 Message → LiriEvent[] 转换
   *
   * @param message 旧消息
   * @param startSeq 起始 seq
   * @param baseTime 默认时间戳（message 缺失 timestamp 时用）
   * @returns events 数组与下一可用 seq
   *
   * 注意：tool/result 的 callSeq 此处填 -1 占位，主流程负责回填
   */
  convertMessage(
    message: Message,
    startSeq: number,
    baseTime: number
  ): ConvertResult {
    const events: LiriEvent[] = [];
    let seq = startSeq;
    const time = this.extractTime(message, baseTime);
    const sessionId = this.sessionId;

    if (message.role === 'user') {
      // P1-5 缺口修复（2026-08-23）：user 分支透传 messageId（message.id），
      // 非流式落盘/恢复重建的用户消息参与 v1 事件聚合，不再只能靠投影兜底。
      // F4（2026-08-25）+ 2026-08-30 补修：replyToId 有值才写入（undefined 键会触发
      // D1 无损 JSON 校验拒绝（event.data.replyToId: undefined）→ invalid-event → pendingRepair）。
      // 同时兼容顶层与 metadata 两处来源——session-handlers 写前落盘将 replyToId
      // 存入 metadata.replyToId（顶层无该键），仅读顶层会导致数据丢失 + undefined 键。
      const msgWithReply = message as unknown as {
        replyToId?: string;
        metadata?: { replyToId?: string };
      };
      const replyToId =
        msgWithReply.replyToId || msgWithReply.metadata?.replyToId || '';
      events.push({
        type: 'user/message',
        schemaVersion: 1,
        seq: seq++,
        time,
        sessionId,
        data: {
          content: this.extractStringContent(message.content),
          messageId: message.id,
          ...(replyToId ? { replyToId } : {}),
        },
      });
    } else if (message.role === 'assistant') {
      this.convertAssistantMessage(message, sessionId, time, seq, events);
      // 更新 seq：events 已追加，下一个 seq 是 startSeq + events.length
      seq = startSeq + events.length;
    } else if (message.role === 'tool' && message.toolCallId) {
      // P1-5（2026-08-23）：tool/result.messageId = 归属 assistant 消息 id。
      // 读取顺序：metadata.parentMessageId → metadata.parentUuid → 顶层 parentUuid（N6 回退），
      // 覆盖存量带 parentUuid 的 tool 消息；v0 无任何来源 → messageId 缺省待归组。
      const meta = (message.metadata ?? {}) as Record<string, unknown>;
      const parentMsgId =
        (meta.parentMessageId as string) ||
        (meta.parentUuid as string) ||
        (message as unknown as { parentUuid?: string }).parentUuid;
      // T2.3（2026-08-23）：callSeq 直读 —— ReActToolLoop 在 toolResultMsg.metadata 携带
      // callSeq（= tool_call 事件 seq，A1③ 闭环）；无则 -1 占位由 _toolCallSeqMap 回填兜底。
      const callSeq = typeof meta.callSeq === 'number' ? meta.callSeq : -1;
      events.push({
        type: 'tool/result',
        // KB-MIG-SCHEMA（2026-08-29）：原 `schemaVersion: parentMsgId ? 1 : undefined`
        // 在 v0 数据无 parent 来源时产生"键存在但值 undefined"→ sanitizeEvent 的
        // assertJsonValue 拒绝（undefined 不可 JSON 序列化）→ append 拒绝 → 迁移死锁
        // （反复 cleanupFailedMigration 删 events.jsonl 再重试）。条件展开仅在
        // 有 parent 时携带该键。
        ...(parentMsgId ? { schemaVersion: 1 } : {}),
        seq: seq++,
        time,
        sessionId,
        data: {
          callSeq,
          toolCallId: message.toolCallId,
          result: this.extractStringContent(message.content),
          isError: this.isToolError(message),
          // 2026-08-30：parentMsgId 可选——v0 数据无 parent 来源时 undefined 键会触发
          // D1 无损 JSON 校验拒绝（event.data.messageId: undefined → invalid-event）
          ...(parentMsgId ? { messageId: parentMsgId } : {}),
        },
      });
    }
    // system 角色消息不转换（不在事件流范围内，按需后续扩展）

    return { events, nextSeq: seq };
  }

  // ─── 内部：assistant 消息拆分 ───────────────────────────────────────────

  /**
   * 转换 assistant 消息
   *
   * 拆分顺序（按时间）：
   *   1. thinking 段（从 content 中提取）→ assistant/thinking
   *   2. 剩余正文 → assistant/text
   *   3. tool_calls → 每个一个 assistant/tool_call
   *
   * 空 content + 空 tool_calls 的 assistant 消息不产生任何事件
   * （防历史污染，对齐 ChatManager._addAndPersistMessage 的空消息拦截）
   */
  private convertAssistantMessage(
    message: Message,
    sessionId: string,
    time: number,
    startSeq: number,
    events: LiriEvent[]
  ): void {
    let seq = startSeq;
    const rawContent = this.extractStringContent(message.content);

    // Step 1: 提取 thinking 段
    const { thinkingText, remainingContent } = this.extractThinking(rawContent);

    if (thinkingText.trim()) {
      events.push({
        type: 'assistant/thinking',
        schemaVersion: 1,
        seq: seq++,
        time,
        sessionId,
        data: { content: thinkingText.trim(), messageId: message.id },
      });
    }

    // Step 2: 剩余正文（去掉 thinking 后的纯 text）
    const textContent = this.stripAllStructuralTags(remainingContent).trim();
    if (textContent) {
      events.push({
        type: 'assistant/text',
        schemaVersion: 1,
        seq: seq++,
        time,
        sessionId,
        data: { content: textContent, messageId: message.id },
      });
    }

    // Step 3: tool_calls 拆为独立事件
    // ⚠ 修复（2026-08-23，根因：ReActToolLoop 把 tool_calls 写入 metadata.tool_calls，
    // 而这里只读 message.tool_calls → assistant/tool_call 事件从未写入 events.jsonl，
    // 导致重新进入会话时工具调用过程在回放中完全丢失，对话顺序错乱）。
    // 修复：同时兼容 message.tool_calls 与 metadata.tool_calls 两个位置。
    const metaToolCalls = (
      message.metadata as Record<string, unknown> | undefined
    )?.tool_calls as Array<Record<string, unknown>> | undefined;
    const rawToolCalls = [
      ...(message.tool_calls ?? []),
      ...(metaToolCalls ?? []),
    ];
    // 按 id 去重（两个位置可能同时存在相同调用）
    const seenCallIds = new Set<string>();
    const toolCalls = rawToolCalls.filter((tc) => {
      const id = String(this.extractToolCallId(tc) ?? '');
      if (!id) return true;
      if (seenCallIds.has(id)) return false;
      seenCallIds.add(id);
      return true;
    });
    for (const tc of toolCalls) {
      const toolCallId = this.extractToolCallId(tc);
      const name = this.extractToolCallName(tc);
      const args = this.extractToolCallArgs(tc);
      events.push({
        type: 'assistant/tool_call',
        schemaVersion: 1,
        seq: seq++,
        time,
        sessionId,
        data: {
          toolCallId,
          name,
          args,
          messageId: message.id,
        },
      });
    }

    // 注：seq 已通过 events.push 隐式递增，调用方通过 events.length 计算 nextSeq
  }

  /**
   * 从 content 中提取 thinking 段
   *
   * 兼容：
   *   - <RichMediaReference>...</RichMediaReference>
   *   - <thinking>...</thinking>
   *   - 未闭合的半截（流式中断）
   *
   * 返回：{ thinkingText, remainingContent }
   *   - thinkingText: 所有匹配到的 thinking 段拼接
   *   - remainingContent: 移除 thinking 段后的剩余内容
   */
  private extractThinking(rawContent: string): {
    thinkingText: string;
    remainingContent: string;
  } {
    const thinkingParts: string[] = [];

    // 闭合标签匹配
    let remaining = rawContent.replace(
      THINKING_PATTERN,
      (_match, group1, group2) => {
        const text = group1 || group2 || '';
        if (text.trim()) thinkingParts.push(text);
        return ''; // 移除已匹配的 thinking 段
      }
    );

    // 未闭合的半截开头（流式中断：开头有 <thinking> 但没闭合）
    remaining = remaining.replace(UNCLOSED_THINKING_START, (match) => {
      // 提取 <thinking> 标签后的内容
      const tagMatch = match.match(/>([\s\S]*)$/);
      const text = tagMatch ? tagMatch[1] : '';
      if (text.trim()) thinkingParts.push(text);
      return '';
    });

    // 未闭合的半截结尾（开头是 thinking 内容，</thinking> 在前面被截断）
    remaining = remaining.replace(UNCLOSED_THINKING_END, (match) => {
      // 提取 </thinking> 标签前的内容
      const tagMatch = match.match(
        /^([\s\S]*?)<\/(?:RichMediaReference|thinking)>/i
      );
      const text = tagMatch ? tagMatch[1] : '';
      if (text.trim()) thinkingParts.push(text);
      return '';
    });

    return {
      thinkingText: thinkingParts.join('\n\n'),
      remainingContent: remaining,
    };
  }

  /**
   * 去除所有结构化标签（response/tool_call 等）
   *
   * 与前端 ensureTextBlockFromContent 的 stripStructuralTags 逻辑对齐
   */
  private stripAllStructuralTags(content: string): string {
    return content
      .replace(/<\/?response>/gi, '')
      .replace(/<\/?tool_call>/gi, '')
      .replace(/<\/?context>/gi, '')
      .trim();
  }

  // ─── 内部：消息字段提取 ──────────────────────────────────────────────────

  /**
   * 提取字符串形式的 content
   *
   * 兼容 Message.content 的两种类型：
   *   - string：直接返回
   *   - ContentBlock[]：拼接所有块的 value
   */
  private extractStringContent(content: string | unknown[]): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((block) => {
          if (typeof block === 'object' && block !== null) {
            const value = (block as { value?: unknown }).value;
            if (typeof value === 'string') return value;
          }
          return '';
        })
        .join('');
    }
    return '';
  }

  /** 提取消息时间戳（epoch ms） */
  private extractTime(message: Message, baseTime: number): number {
    const ts = message.startedAt ?? message.createdAt ?? message.updatedAt;
    if (ts instanceof Date) {
      const ms = ts.getTime();
      if (Number.isFinite(ms)) return ms;
    }
    if (typeof ts === 'string') {
      const ms = Date.parse(ts);
      if (Number.isFinite(ms)) return ms;
    }
    return baseTime;
  }

  /** 判断 tool 消息是否为错误结果 */
  private isToolError(message: Message): boolean {
    if (message.status === MessageStatus.FAILED) return true;
    // 兼容：metadata 中标记错误
    if (message.metadata?.isError === true) return true;
    // 兼容：content 中含错误标识
    const content = this.extractStringContent(message.content).toLowerCase();
    if (content.startsWith('error:') || content.startsWith('工具执行失败')) {
      return true;
    }
    return false;
  }

  // ─── 内部：tool_calls 字段提取 ────────────────────────────────────────────

  /** 提取 tool_call ID */
  private extractToolCallId(tc: Record<string, unknown>): string {
    return String(tc.id ?? tc.toolCallId ?? '');
  }

  /** 提取 tool_call 函数名 */
  private extractToolCallName(tc: Record<string, unknown>): string {
    const fn = tc.function as { name?: string } | undefined;
    return String(fn?.name ?? tc.name ?? '');
  }

  /** 提取 tool_call 参数（解析 JSON 字符串为对象） */
  private extractToolCallArgs(tc: Record<string, unknown>): unknown {
    const fn = tc.function as { arguments?: string | unknown } | undefined;
    const argsRaw = fn?.arguments ?? tc.args;
    if (typeof argsRaw === 'string') {
      try {
        return JSON.parse(argsRaw);
      } catch {
        return argsRaw; // 解析失败返回原字符串
      }
    }
    return argsRaw ?? {};
  }

  // ─── 内部：文件 IO ───────────────────────────────────────────────────────

  /**
   * 读取全部消息（按文件顺序）
   *
   * 与 FileSystemStorage.loadMessages 的反向去重不同，迁移器**保留所有行**
   * （包括重复行），因为我们需要按文件顺序分配 seq。
   * 重复行（同 ID 多次写入）会在转换后产生重复 seq，被 EventLogStorage 守卫拒绝。
   *
   * 损坏行跳过，不影响其他消息。
   */
  private async readAllMessages(): Promise<Message[]> {
    const messages: Message[] = [];

    try {
      const rl = readline.createInterface({
        input: createReadStream(this.messagesFilePath, { encoding: 'utf-8' }),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as Message;
          if (msg && typeof msg === 'object' && typeof msg.role === 'string') {
            messages.push(msg);
          }
        } catch {
          logger.warn('migrator: 跳过损坏的 messages.jsonl 行', {
            sessionId: this.sessionId,
            linePreview: line.slice(0, 100),
          });
        }
      }
    } catch (e) {
      await handleError(e, {
        module: 'session:migrator',
        action: 'readAllMessages',
        context: {
          sessionId: this.sessionId,
          messagesFilePath: this.messagesFilePath,
        },
      }).catch(() => {});
      return [];
    }

    return messages;
  }

  /**
   * 备份原 messages.jsonl
   *
   * 重命名为 messages.jsonl.bak（覆盖已有 .bak）
   * 保留 30 天，调用方负责定期清理
   */
  private async backupMessagesFile(): Promise<void> {
    try {
      // copyFile 而非 rename，保留原文件直到外部清理
      // （避免备份失败导致原文件丢失）
      await fs.copyFile(this.messagesFilePath, this.messagesBackupPath);
      logger.info('migrator: 已备份原文件', {
        sessionId: this.sessionId,
        backupPath: this.messagesBackupPath,
      });
    } catch (e) {
      await handleError(e, {
        module: 'session:migrator',
        action: 'backup',
        context: {
          sessionId: this.sessionId,
          messagesFilePath: this.messagesFilePath,
          backupPath: this.messagesBackupPath,
        },
      }).catch(() => {});
      // 备份失败不阻断主流程（已成功迁移）
    }
  }

  /**
   * 清理失败的迁移（删除半成品 events.jsonl）
   *
   * 保留原 messages.jsonl，下次打开会话时重试迁移
   */
  private async cleanupFailedMigration(): Promise<void> {
    try {
      const eventsFile = this.eventLog.getFilePath();
      if (existsSync(eventsFile)) {
        await fs.unlink(eventsFile);
        logger.warn('migrator: 已清理失败的 events.jsonl', {
          sessionId: this.sessionId,
          eventsFile,
        });
      }
    } catch (e) {
      await handleError(e, {
        module: 'session:migrator',
        action: 'cleanupFailedMigration',
        context: { sessionId: this.sessionId },
      }).catch(() => {});
    }
  }
}
