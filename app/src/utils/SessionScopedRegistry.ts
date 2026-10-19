/**
 * SessionScopedRegistry —— 会话级缓存/对象的统一 dispose 契约（源码排查报告 S1）。
 *
 * 背景：`_taorLoops` / `_planDrivenLoops` / `_pendingInteractions` 等各自为政，
 * 「创建点」分散、「回收点」也分散 ⇒ D1 类「创建有、回收无」缺陷反复出现。
 * 本类在 `Map` 之上补充「会话 → 键集合」索引，使**回收粒度天然跟随创建粒度**：
 * 只要通过 `getOrCreate()` / `set()` 写入，`dispose(sessionId)` 就能精确回收该会话
 * 的**全部**键（含 `sessionId::变体` 这类扩容键）。
 *
 * 语义：
 * - 键的归属会话 = 键中**首个** `sessionSeparator` 之前的部分（无分隔符 ⇒ 键即会话 ID）；
 * - `dispose(sessionId)`：删除该会话全部键（幂等；无键时为 no-op）；
 * - `disposeAll()`：等价于 `clear()`（同时清空会话索引）；
 * - 仍然是一个 `Map` ⇒ 既有 `.get/.set/.delete/.size/for…of` 调用点零改动。
 *
 * 纯基础设施：零依赖。
 */
export class SessionScopedRegistry<T> extends Map<string, T> {
  /** 会话 → 该会话占用的键集合（与 entries 同生命周期） */
  private readonly keysBySession = new Map<string, Set<string>>();

  /**
   * @param sessionSeparator 复合键的分隔符（如 `::turnsX`）；普通会话键无需分隔符。
   */
  constructor(private readonly sessionSeparator = '::') {
    super();
  }

  /** 由缓存键推导归属会话 */
  private sessionOf(key: string): string {
    const idx = key.indexOf(this.sessionSeparator);
    return idx === -1 ? key : key.slice(0, idx);
  }

  /** 写入并按会话归组（覆盖同一键时幂等） */
  override set(key: string, value: T): this {
    super.set(key, value);
    const sessionId = this.sessionOf(key);
    let keys = this.keysBySession.get(sessionId);
    if (!keys) {
      keys = new Set<string>();
      this.keysBySession.set(sessionId, keys);
    }
    keys.add(key);
    return this;
  }

  /** 删除单键并同步会话索引 */
  override delete(key: string): boolean {
    const removed = super.delete(key);
    if (removed) {
      const sessionId = this.sessionOf(key);
      const keys = this.keysBySession.get(sessionId);
      if (keys) {
        keys.delete(key);
        if (keys.size === 0) this.keysBySession.delete(sessionId);
      }
    }
    return removed;
  }

  /** 清空全部条目与会话索引 */
  override clear(): void {
    super.clear();
    this.keysBySession.clear();
  }

  /**
   * 取该会话的缓存（不存在则用 `factory` 创建一个并登记）。
   *
   * @param variant 可选变体后缀（如扩容轮次 `turnsX2`）——底层键为
   *                `${sessionId}${sessionSeparator}${variant}`，`dispose` 会一并回收。
   */
  getOrCreate(sessionId: string, factory: () => T, variant?: string): T {
    const key =
      variant === undefined
        ? sessionId
        : `${sessionId}${this.sessionSeparator}${variant}`;
    let value = this.get(key);
    if (value === undefined) {
      value = factory();
      this.set(key, value);
    }
    return value;
  }

  /** 该会话当前占用的全部缓存键（副本；空数组表示已无残留） */
  keysOf(sessionId: string): string[] {
    const keys = this.keysBySession.get(sessionId);
    return keys ? [...keys] : [];
  }

  /** 当前仍持有缓存的会话集合（副本） */
  sessions(): string[] {
    return [...this.keysBySession.keys()];
  }

  /** 回收该会话的全部缓存（幂等） */
  dispose(sessionId: string): void {
    const keys = this.keysBySession.get(sessionId);
    if (!keys) return;
    this.keysBySession.delete(sessionId);
    for (const key of keys) super.delete(key);
  }

  /** 全量回收（与 `clear()` 同义，命名对齐「统一 dispose 契约」） */
  disposeAll(): void {
    this.clear();
  }

  /** 按会话去重后的「每会话首个实例」（退出 flush 等场景避免同会话并发重复操作） */
  firstPerSession(): Map<string, T> {
    const first = new Map<string, T>();
    for (const [key, value] of this) {
      const sessionId = this.sessionOf(key);
      if (!first.has(sessionId)) first.set(sessionId, value);
    }
    return first;
  }
}
