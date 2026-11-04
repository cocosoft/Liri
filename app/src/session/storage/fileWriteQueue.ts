/**
 * 文件级「单写者」队列（P1-3，2026-11-04，《运行态问题排查与修复方案》）
 *
 * 背景：`EventLogStorage` 的 append mutex 是**实例级**的，而同一会话的
 * `events.jsonl` 可能被多个实例（不同子系统各建一个）并发写 —— 各自排队 ⇒
 * 同时读到同一 tailSeq ⇒ `duplicate-seq` 自动纠正（实测 5 次/窗口）。
 *
 * 本模块把排队键提升为**文件绝对路径**（进程内共用一个 Map）：
 * 同一文件的写者按到达顺序串行；跨进程冲突仍由事件日志的"seq 冲突纠正"兜底。
 *
 * 生命周期：链尾 settle 后，若该键仍是当前链尾则删除（不常驻内存）。
 * 键为空（极早期、路径未就绪）⇒ 退化为"不排队"，由调用方自行保证顺序。
 */

/** 键（文件绝对路径）→ 该文件上一条写操作完成后的 Promise */
const fileWriteChains = new Map<string, Promise<unknown>>();

/**
 * 把一次文件写操作挂到该文件的链尾并执行。
 *
 * @param key 文件绝对路径（空 ⇒ 不排队，直接执行）
 * @param fn  写操作（错误由调用方自行归类；本队列不吞错）
 */
export function enqueueFileWrite<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!key) return fn();
  const base = fileWriteChains.get(key) ?? Promise.resolve();
  const next = base.then(fn, fn);
  // 链尾忽略 reject（错误已在 fn 内被归类），避免后续写者被前一条的失败卡住
  const settled = next.then(
    () => undefined,
    () => undefined
  );
  fileWriteChains.set(key, settled);
  void settled.then(() => {
    // 只在"仍是当前链尾"时回收，避免误删后来者的链
    if (fileWriteChains.get(key) === settled) fileWriteChains.delete(key);
  });
  return next;
}
