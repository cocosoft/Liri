/**
 * 门禁路径归一：统一为「以 `src/` 开头的 POSIX 相对路径」（2026-11-12）
 *
 * **修的是什么**：`lint-architecture.ts` 的 barrel（R05-005）与薄桶（R07-003）两处，原实现是
 * `relative(cwd, file)` 后 `indexOf('src\\')` + `startsWith('src\\…')` —— **分隔符写死 Windows**。
 * POSIX 上 `relative()` 返回 `/`，`indexOf('src\\')` 恒为 `-1` ⇒ 归一失效 ⇒ 模块入口豁免**全部失配**，
 * Linux 上会把这些合法 barrel 全报出来（R05-005 是 warning，所以 CI 一直绿，属**静默失焦**，AR-3 同类）。
 *
 * **口径**：取**首个** `src/` 起的部分 —— `app/src/ai/index.ts` → `src/ai/index.ts`；
 * `packages/sandbox/src/sandbox/index.ts` → `src/sandbox/index.ts`；不含 `src/` ⇒ 原样返回（POSIX 化后）。
 */

/** 任意路径 ⇒ 以 `src/` 开头的 POSIX 相对路径 */
export function toSrcRelativePosix(relPath: string): string {
  const posix = relPath.replace(/\\/g, '/');
  const idx = posix.indexOf('src/');
  return idx >= 0 ? posix.slice(idx) : posix;
}

/** 模块入口目录匹配：清单两侧统一按 POSIX 比较（清单仍可用 `src\\…` 写法） */
export function matchesModuleEntryDir(
  relFile: string,
  dirs: readonly string[]
): boolean {
  return dirs.some((dir) => relFile.startsWith(dir.replace(/\\/g, '/')));
}
