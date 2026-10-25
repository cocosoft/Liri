/**
 * helperPaths — `landlock-run` helper 的**路径解析**（T25-11a，2026-10-25）
 *
 * ## 背景
 * 发布链此前**从不构建/分发** helper（CI 只在 sandbox-negative job 编到 `$RUNNER_TEMP`），
 * 而运行时只认 `LANDLOCK_RUN_HELPER` 或 PATH ⇒ Linux 用户即使打开
 * `sandbox.landlock.bashEnabled`，也会因 `capability-unavailable` 被拒（安全但功能不可用）；
 * `code_run` 则静默降级到跨平台执行器。
 *
 * ## 解析顺序
 *  ① `LANDLOCK_RUN_HELPER`（显式；**即便路径不存在也原样返回** —— 让配置错误直接可见）；
 *  ② `<PROJECT_DIR>/bin/landlock-run`（**随包分发**，`LIRI_PROJECT_DIR` 由启动脚本设置）；
 *  ③ `landlock-run`（PATH 兜底，保持旧行为）。
 *
 * 非 Linux 平台返回裸名（平台门控在 `LandlockDetector` / bash 闸门之前，不会真正使用）。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveProjectRoot } from '@openliri/kernel/paths';

/** helper 可执行文件名（与 Cargo/native 无关，纯 C 编译产物） */
export const LANDLOCK_HELPER_BIN_NAME = 'landlock-run';

/** 显式覆盖的环境变量名（与 `LinuxSandboxRunner` / `bashLandlockExec` 同一口径） */
export const LANDLOCK_HELPER_ENV = 'LANDLOCK_RUN_HELPER';

/** 随包分发目录（`<PROJECT_DIR>/bin/`） */
const SHIPPED_SUBDIR = 'bin';

/**
 * 候选路径（按优先级，去重去空；非 Linux ⇒ 空数组）。
 *
 * 纯函数（无 IO）—— 供单测与排障日志使用。
 */
export function resolveLandlockHelperCandidates(input: {
  platform: NodeJS.Platform;
  projectDir: string;
  env?: NodeJS.ProcessEnv;
}): string[] {
  if (input.platform !== 'linux') return [];
  const explicit = input.env?.[LANDLOCK_HELPER_ENV]?.trim();
  const list = [
    explicit,
    join(input.projectDir, SHIPPED_SUBDIR, LANDLOCK_HELPER_BIN_NAME),
    LANDLOCK_HELPER_BIN_NAME,
  ];
  const seen = new Set<string>();
  for (const raw of list) {
    const p = raw?.trim();
    if (p) seen.add(p);
  }
  return Array.from(seen);
}

/**
 * 实际使用的 helper 路径。
 *
 * @param input.exists 存在性判定（默认 `fs.existsSync`；测试注入）
 */
export function resolveLandlockHelperPath(
  input: {
    platform?: NodeJS.Platform;
    projectDir?: string;
    env?: NodeJS.ProcessEnv;
    exists?: (path: string) => boolean;
  } = {}
): string {
  const platform = input.platform ?? process.platform;
  if (platform !== 'linux') return LANDLOCK_HELPER_BIN_NAME;

  const env = input.env ?? process.env;
  const explicit = env[LANDLOCK_HELPER_ENV]?.trim();
  if (explicit) return explicit;

  const projectDir = input.projectDir ?? resolveProjectRoot();
  const exists = input.exists ?? existsSync;
  const shipped = join(projectDir, SHIPPED_SUBDIR, LANDLOCK_HELPER_BIN_NAME);
  return exists(shipped) ? shipped : LANDLOCK_HELPER_BIN_NAME;
}
