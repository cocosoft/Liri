// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// win-sandbox helper 的路径解析（2026-10-26，方案 .trae/specs/windows-sandbox.md §3.4）
//
// 解析顺序（与 `landlock/helperPaths.ts` 同一口径）：
//  ① `WIN_SANDBOX_HELPER`（显式；即便不存在也原样返回 —— 让配置错误直接可见）；
//  ② `<PROJECT_DIR>/bin/win-sandbox-run.exe`（`bun run build:win-sandbox` 的默认输出）；
//  ③ `win-sandbox-run.exe`（PATH 兜底）。
//
// 非 Windows 返回裸名（平台门控在探测器/调度处，不会真正使用）。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveProjectRoot } from '@openliri/kernel/paths';
import { SANDBOX_HELPER_BIN_DIR } from '../helperBinDir';

/** helper 可执行文件名（C 编译产物，不入库） */
export const WIN_SANDBOX_HELPER_BIN_NAME = 'win-sandbox-run.exe';

/** 显式覆盖的环境变量名 */
export const WIN_SANDBOX_HELPER_ENV = 'WIN_SANDBOX_HELPER';

/** 随包分发目录（`<PROJECT_DIR>/bin/`；定义见 `../helperBinDir`） */

/** 候选路径（按优先级，去重去空；非 Windows ⇒ 空数组）。纯函数，供单测与排障日志。 */
export function resolveWinSandboxHelperCandidates(input: {
  platform: NodeJS.Platform;
  projectDir: string;
  env?: NodeJS.ProcessEnv;
}): string[] {
  if (input.platform !== 'win32') return [];
  const explicit = input.env?.[WIN_SANDBOX_HELPER_ENV]?.trim();
  const list = [
    explicit,
    join(input.projectDir, SANDBOX_HELPER_BIN_DIR, WIN_SANDBOX_HELPER_BIN_NAME),
    WIN_SANDBOX_HELPER_BIN_NAME,
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
export function resolveWinSandboxHelperPath(
  input: {
    platform?: NodeJS.Platform;
    projectDir?: string;
    env?: NodeJS.ProcessEnv;
    exists?: (path: string) => boolean;
  } = {}
): string {
  const platform = input.platform ?? process.platform;
  if (platform !== 'win32') return WIN_SANDBOX_HELPER_BIN_NAME;

  const env = input.env ?? process.env;
  const explicit = env[WIN_SANDBOX_HELPER_ENV]?.trim();
  if (explicit) return explicit;

  const projectDir = input.projectDir ?? resolveProjectRoot();
  const exists = input.exists ?? existsSync;
  const shipped = join(
    projectDir,
    SANDBOX_HELPER_BIN_DIR,
    WIN_SANDBOX_HELPER_BIN_NAME
  );
  return exists(shipped) ? shipped : WIN_SANDBOX_HELPER_BIN_NAME;
}
