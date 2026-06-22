/**
 * 工具结果注册表
 *
 * 本地存储所有工具执行结果，替代将全部工具调用历史提交给 LLM 的做法。
 * 工具循环每轮执行完毕后将结果存入注册表，后续轮次仅提交压缩摘要，
 * LLM 可通过 get_tool_result 工具查询完整信息。
 *
 * 架构目标：
 * 1. 消除上下文膨胀 — 工具结果摘要替代原始全文
 * 2. 消除压缩断裂 — tool_calls/tool 配对信息由本地存储保证，无需 LLM 上下文传递
 * 3. 提升可控性 — 敏感的工具结果不离开本地
 */
/** 存储的工具调用记录 */
export interface StoredToolCall {
  /** 工具调用 ID（API 分配的 call_xxx 格式） */
  toolCallId: string;
  /** 工具名称 */
  toolName: string;
  /** 工具调用参数 */
  arguments: Record<string, unknown>;
  /** 工具执行结果 */
  result: {
    result?: unknown;
    error?: string;
  };
  /** 所属轮次（从 1 开始） */
  round: number;
  /** 执行时间戳 */
  timestamp: number;
}

export class ToolResultRegistry {
  /** sessionId -> Map<toolCallId, StoredToolCall> */
  private store = new Map<string, Map<string, StoredToolCall>>();

  /** sessionId -> 当前轮次计数器（调用 nextRound 后递增） */
  private roundCounters = new Map<string, number>();

  /**
   * 进入下一轮并返回轮次号
   */
  nextRound(sessionId: string): number {
    const current = this.roundCounters.get(sessionId) ?? 0;
    const next = current + 1;
    this.roundCounters.set(sessionId, next);
    return next;
  }

  /**
   * 获取当前轮次号（未调用 nextRound 时为 0）
   */
  getCurrentRound(sessionId: string): number {
    return this.roundCounters.get(sessionId) ?? 0;
  }

  /**
   * 存储工具执行结果
   */
  storeResult(
    sessionId: string,
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
    result: { result?: unknown; error?: string },
    round: number
  ): void {
    if (!this.store.has(sessionId)) {
      this.store.set(sessionId, new Map());
    }
    const sessionStore = this.store.get(sessionId)!;

    sessionStore.set(toolCallId, {
      toolCallId,
      toolName,
      arguments: args,
      result,
      round,
      timestamp: Date.now(),
    });
  }

  /**
   * 按 tool_call_id 查询完整工具执行结果
   */
  getResult(sessionId: string, toolCallId: string): StoredToolCall | undefined {
    return this.store.get(sessionId)?.get(toolCallId);
  }

  /**
   * 跨所有会话按 tool_call_id 查找工具执行结果
   * 用于 LLM 通过 get_tool_result 查询，因 LLM 不知道 sessionId
   */
  findByCallId(toolCallId: string): StoredToolCall | undefined {
    for (const sessionStore of this.store.values()) {
      const found = sessionStore.get(toolCallId);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * 列出指定会话的所有工具调用记录
   */
  listBySession(sessionId: string): StoredToolCall[] {
    const sessionStore = this.store.get(sessionId);
    if (!sessionStore) return [];
    return [...sessionStore.values()].sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * 列出指定轮次的工具调用记录
   */
  listByRound(sessionId: string, round: number): StoredToolCall[] {
    const sessionStore = this.store.get(sessionId);
    if (!sessionStore) return [];
    return [...sessionStore.values()]
      .filter((c) => c.round === round)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * 生成压缩的历史摘要，用于替代完整消息传递给 LLM
   *
   * 输出格式示例：
   * ```
   * 第1轮: read_file(path=src/main.ts) → 成功(2.1KB), grep(pattern=function) → 成功(3条)
   * 第2轮: write_file(path=src/main.ts) → 成功(已写入)
   * ```
   */
  getCompressedHistory(sessionId: string): string {
    const sessionStore = this.store.get(sessionId);
    if (!sessionStore || sessionStore.size === 0) return '';

    // 按轮次分组
    const byRound = new Map<number, StoredToolCall[]>();
    for (const call of sessionStore.values()) {
      const calls = byRound.get(call.round) ?? [];
      calls.push(call);
      byRound.set(call.round, calls);
    }

    const parts: string[] = [];
    for (const [round, roundCalls] of [...byRound.entries()].sort(
      ([a], [b]) => a - b
    )) {
      const items = roundCalls.map((c) => {
        const args = this._summarizeArgs(c.arguments);
        const status = c.result.error ? '失败' : '成功';
        const summary = this._summarizeResult(c.result);
        return `${c.toolName}(${args}) → ${status}: ${summary}`;
      });
      parts.push(`第${round}轮: ${items.join(', ')}`);
    }

    return parts.join('\n');
  }

  /**
   * 清除指定会话的全部记录
   */
  clearSession(sessionId: string): void {
    this.store.delete(sessionId);
    this.roundCounters.delete(sessionId);
  }

  /**
   * 获取会话中记录的轮次数
   */
  getRoundCount(sessionId: string): number {
    return this.roundCounters.get(sessionId) ?? 0;
  }

  // ============ 私有辅助方法 ============

  /**
   * 将工具参数压缩为简短摘要
   * 提取关键字段（path, file, pattern, url, question 等），移除大型内容字段
   */
  private _summarizeArgs(args: Record<string, unknown>): string {
    // 定义各工具的优先显示的短字段及取值截断长度
    const shortArgKeys = [
      'path',
      'file_path',
      'file',
      'pattern',
      'query',
      'url',
      'question',
      'tool_call_id',
      'toolName',
      'name',
      'id',
    ];

    for (const key of shortArgKeys) {
      const val = args[key];
      if (val !== undefined && val !== null) {
        const strVal = String(val).slice(0, 80);
        return `${key}=${strVal}`;
      }
    }

    // 没有关键字段时取第一个参数
    const entries = Object.entries(args).filter(
      ([k, v]) => k !== '_userAnswers' && v !== undefined && v !== null
    );
    if (entries.length === 0) return '-';

    const [key, val] = entries[0];
    return `${key}=${String(val).slice(0, 60)}`;
  }

  /**
   * 将工具执行结果压缩为简短摘要
   */
  private _summarizeResult(result: {
    result?: unknown;
    error?: string;
  }): string {
    if (result.error) {
      return result.error.slice(0, 60);
    }

    const r = result.result;
    if (r === undefined || r === null) return '空';

    if (typeof r === 'string') {
      return r.length > 80 ? `${r.slice(0, 80)}...(${r.length}字符)` : r;
    }

    if (typeof r === 'object') {
      try {
        const str = JSON.stringify(r);
        const keys = Object.keys(r as Record<string, unknown>);
        if (keys.length <= 3) {
          return str.length > 80 ? `${str.slice(0, 80)}...` : str;
        }
        return `${str.slice(0, 60)}...(${keys.length}字段)`;
      } catch {
        return String(r).slice(0, 60);
      }
    }

    return String(r).slice(0, 60);
  }
}

/** 全局单例 */
export const toolResultRegistry = new ToolResultRegistry();
