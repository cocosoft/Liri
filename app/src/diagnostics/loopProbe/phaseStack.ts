// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 事件循环阻塞探针 · 协作式阶段标签（P2，2026-09-22）
 *
 * 用途：把"事件循环被阻塞 N 秒"映射到**正在执行的业务阶段**。
 * 为什么必须有（见取证方案 §3-P2）：CPU profile 只给"函数级"答案；当阻塞来自 native
 * （SQLite / fs / GC）时，JS 栈只会显示"调用方帧在等待"⇒ 需要阶段标签做交叉印证，
 * 否则会得出误导性结论。
 *
 * 设计约束（探针不得自身成为阻塞源）：
 *  - `enterPhase` / `exitPhase` 必须 **O(1)、不分配、不抛**（固定容量、越界即放弃记录）；
 *  - 快照只在**阻塞事件**发生时读取一次（正常路径零日志、零 I/O）；
 *  - `exitPhase` 对**不配对的调用**静默忽略（不抛），保证插入 try/finally 时安全。
 *
 * 归因原理（自校验）：阶段自身记 `durationMs`，心跳记 `lagMs`。若某阶段 duration ≈ lag，
 * 该阶段即阻塞源；若**没有任何**阶段与之匹配 ⇒ 阻塞来自未插桩路径或 GC/native。
 * 两把尺子互相印证，避免单点证据下结论。
 */

/** 活跃栈上限：超过即放弃记录（宁可不采样，也不让探针自己成为内存增长点） */
const MAX_DEPTH = 64;
/** 已完成阶段环形缓冲容量（够覆盖 burst 期连续多轮） */
const RING_CAPACITY = 32;
/** 归因判据下界：小于 1s 的阶段不可能是"阻塞源"，避免抖动噪声干扰 */
const MIN_SUSPECT_MS = 1000;

export interface PhaseEntry {
  /** 阶段名（约定 `<子系统>:<动作>`，如 `compaction:fold`、`fts:saveToDisk`） */
  name: string;
  /** 该阶段自身的执行时长（ms） */
  durationMs: number;
  /** 结束时刻（epoch ms） */
  endedAt: number;
}

export interface PhaseSnapshot {
  /** 当前仍活跃的**最内层**阶段（阻塞仍在进行时非空） */
  current: string | null;
  /** 当前活跃栈（由外到内，便于看嵌套关系） */
  activeStack: string[];
  /**
   * 与 lag 匹配的疑似阻塞阶段（`durationMs >= max(1s, lagMs/2)`，按 duration 降序）。
   * 空数组表示"阻塞不在任何已插桩阶段内"—— 本身就是一条关键结论。
   */
  suspects: PhaseEntry[];
  /** 最近完成阶段（新→旧，供人工判读上下文） */
  recent: PhaseEntry[];
}

const activeNames: string[] = [];
const activeStartedAt: number[] = [];
const ring: PhaseEntry[] = [];
let ringNext = 0;
let ringFilled = 0;

/** 开关：`LOOP_PROBE=off` 时整体降为零开销（P2 插桩点无需改动） */
let enabled = true;

/** 由 `loopProbe` 按 env 设置；测试可显式切换 */
export function setPhaseStackEnabled(next: boolean): void {
  enabled = next;
  if (!next) resetPhaseStack();
}

export function isPhaseStackEnabled(): boolean {
  return enabled;
}

/** 进入阶段（务必在 try/finally 中与 `exitPhase` 配对） */
export function enterPhase(name: string): void {
  if (!enabled) return;
  if (activeNames.length >= MAX_DEPTH) return;
  const now = Date.now();
  activeNames.push(name);
  activeStartedAt.push(now);
}

/** 退出阶段；**不配对时静默忽略**（不抛 —— 探针不得影响主流程） */
export function exitPhase(name: string): void {
  if (!enabled) return;
  const top = activeNames.length - 1;
  if (top < 0 || activeNames[top] !== name) return;
  const endedAt = Date.now();
  const durationMs = endedAt - activeStartedAt[top];
  activeNames.pop();
  activeStartedAt.pop();

  ring[ringNext] = { name, durationMs, endedAt };
  ringNext = (ringNext + 1) % RING_CAPACITY;
  if (ringFilled < RING_CAPACITY) ringFilled++;
}

/** 最近完成阶段（新→旧） */
export function recentPhases(): PhaseEntry[] {
  const out: PhaseEntry[] = [];
  for (let i = 0; i < ringFilled; i++) {
    const idx = (ringNext - 1 - i + RING_CAPACITY) % RING_CAPACITY;
    const entry = ring[idx];
    if (entry) out.push({ ...entry });
  }
  return out;
}

/** 当前仍活跃的最内层阶段名 */
export function currentPhase(): string | null {
  return activeNames.length > 0 ? activeNames[activeNames.length - 1] : null;
}

/**
 * 取阻塞归因快照（仅在检测到阻塞时调用）。
 * @param lagMs 心跳测得的事件循环滞后（ms）—— 与阶段自记时长互相印证
 */
export function snapshotPhases(lagMs: number): PhaseSnapshot {
  const recent = recentPhases();
  const floor = Math.max(MIN_SUSPECT_MS, lagMs / 2);
  const suspects = recent
    .filter((e) => e.durationMs >= floor)
    .sort((a, b) => b.durationMs - a.durationMs);
  return {
    current: currentPhase(),
    activeStack: [...activeNames],
    suspects,
    recent: recent.slice(0, 12),
  };
}

/** 复位（测试与 `run` 生命周期用） */
export function resetPhaseStack(): void {
  activeNames.length = 0;
  activeStartedAt.length = 0;
  ring.length = 0;
  ringNext = 0;
  ringFilled = 0;
}

/**
 * 包裹一段异步/同步工作并自动配对 `enterPhase` / `exitPhase`。
 *
 * 存在意义：把插桩成本压到**一行**，从而无需重排既有大函数体的缩进
 * （外科手术式修改）。异常路径同样退出阶段（`finally` 语义），不会污染栈。
 *
 * ⚠ 时长口径：包含 `await` 等待 ⇒ I/O 型阶段的**墙钟**可能远大于它造成的事件循环阻塞。
 * 判读时必须与 CPU 热点（P1）交叉验证，不可仅凭"阶段时长 ≈ lag"下结论。
 */
export function withPhase<T>(
  name: string,
  fn: () => Promise<T> | T
): Promise<T> {
  enterPhase(name);
  let result: Promise<T> | T;
  try {
    result = fn();
  } catch (err) {
    exitPhase(name);
    throw err;
  }
  return Promise.resolve(result).finally(() => exitPhase(name));
}

/**
 * 同步版包裹（2026-09-22 补，用于**定时器回调**这类纯同步入口）。
 *
 * 与 `withPhase` 的差别：不做 Promise 包装 ⇒ 阶段在**返回前**退出，
 * 时长即为同步执行时间，不存在 microtask 延迟。
 */
export function withPhaseSync<T>(name: string, fn: () => T): T {
  enterPhase(name);
  try {
    return fn();
  } finally {
    exitPhase(name);
  }
}
