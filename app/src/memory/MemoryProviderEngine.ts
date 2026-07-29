/**
 * MemoryProvider — 外部 Memory Provider 标准化接口
 *
 * P1-4: 对标 hermes-agent MemoryProvider ABC + MemoryManager 10 生命周期钩子。
 * 支持扩展外部的记忆服务（Honcho/Mem0/Supermemory 等），与内置 MemoryStore 协作。
 *
 * 生命周期钩子：
 *   1. initialize     — session 开始时
 *   2. systemPrompt   — 构建 system prompt 时注入记忆块
 *   3. prefetch       — 每轮推理前预取
 *   4. syncTurn       — 每轮结束后同步
 *   5. onSessionEnd   — session 结束时
 *   6. onPreCompact   — 上下文压缩前
 *   7. onMemoryWrite  — 内置写入时镜像
 *   8. onDelegation   — 子代理工作时
 *   9. onSessionSwitch — 会话切换时
 *  10. queuePrefetch  — 异步预取（非阻塞）
 */

export interface MemoryProviderConfig {
  /** 唯一标识 */
  id: string;
  /** 显示名 */
  name: string;
  /** 是否启用 */
  enabled: boolean;
  /** 配置参数 */
  options?: Record<string, string>;
}

export interface MemoryProvider {
  readonly id: string;
  readonly name: string;

  /** 初始化 */
  initialize(sessionId: string, config?: Record<string, string>): Promise<void>;

  /** 构建 system prompt 记忆块 */
  systemPromptBlock(sessionId: string): Promise<string | null>;

  /** 查询相关记忆 */
  retrieve(query: string, recentMessages?: string[]): Promise<string | null>;

  /** 记忆一条 turn */
  captureTurn(sessionId: string, userMessage: string, assistantMessage: string): Promise<void>;

  /** 写入记忆（镜像内置 MemoryStore） */
  onMemoryWrite?(action: 'add' | 'update' | 'delete', target: string, content: string): Promise<void>;

  /** 会话结束 */
  onSessionEnd?(sessionId: string, messages?: string[]): Promise<void>;

  /** 上下文压缩前 */
  onPreCompact?(sessionId: string, messages?: string[]): Promise<void>;

  /** 子代理委派 */
  onDelegation?(sessionId: string, subAgentId: string, task: string): Promise<void>;

  /** 会话切换 */
  onSessionSwitch?(fromSessionId: string, toSessionId: string): Promise<void>;

  /** 异步预取（非阻塞） */
  queuePrefetch?(sessionId: string, query: string): Promise<void>;

  /** 销毁 */
  dispose(): Promise<void>;
}

/**
 * P1-4: MemoryProvider 注册表引擎。
 * 管理一个或多个外部 MemoryProvider 实例的生命周期。
 */
export class MemoryProviderEngine {
  private providers = new Map<string, MemoryProvider>();
  private activeSession: string | null = null;

  /** 注册一个 Provider */
  register(provider: MemoryProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`MemoryProvider '${provider.id}' already registered`);
    }
    this.providers.set(provider.id, provider);
  }

  /** 注销 */
  unregister(providerId: string): void {
    this.providers.delete(providerId);
  }

  /** 获取所有已注册的 Provider */
  getAll(): MemoryProvider[] {
    return [...this.providers.values()];
  }

  /** 初始化所有 Provider */
  async initializeAll(sessionId: string, config?: Record<string, string>): Promise<void> {
    this.activeSession = sessionId;
    const results = await Promise.allSettled(
      [...this.providers.values()].map((p) => p.initialize(sessionId, config))
    );
    for (const r of results) {
      if (r.status === 'rejected') {
        // P1-4: Memory 故障不应阻断 Agent，warn 即可
      }
    }
  }

  /** 构建 system prompt 块（聚合所有 Provider） */
  async buildSystemPrompt(): Promise<string> {
    if (!this.activeSession) return '';
    const blocks: string[] = [];
    for (const p of this.providers.values()) {
      try {
        const block = await withTimeout(p.systemPromptBlock(this.activeSession), 3_000);
        if (block) blocks.push(block);
      } catch { /* timeout or failure — skip */ }
    }
    return blocks.length > 0
      ? `<memory-context>\n${blocks.join('\n\n')}\n</memory-context>`
      : '';
  }

  /** 同步所有 Provider 的当前 turn */
  async syncTurnAll(userMessage: string, assistantMessage: string): Promise<void> {
    if (!this.activeSession) return;
    await Promise.allSettled(
      [...this.providers.values()].map((p) =>
        p.captureTurn(this.activeSession!, userMessage, assistantMessage)
      )
    );
  }

  /** 会话结束 */
  async onSessionEnd(): Promise<void> {
    if (!this.activeSession) return;
    await Promise.allSettled(
      [...this.providers.values()].map((p) =>
        p.onSessionEnd?.(this.activeSession!)
      )
    );
  }

  dispose(): void {
    for (const p of this.providers.values()) {
      p.dispose().catch(() => {});
    }
    this.providers.clear();
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  try {
    const result = await Promise.race([
      promise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
    return result;
  } catch {
    return null;
  }
}
