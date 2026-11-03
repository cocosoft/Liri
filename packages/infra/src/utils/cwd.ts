/**
 * 当前工作目录工具
 */

import { existsSync, statSync } from 'fs';

/**
 * 获取当前工作目录
 */
export function getCwd(): string {
  return process.cwd();
}

/**
 * G1（2026-11-03）：**spawn 前 cwd 判定**（"存在 + 是目录"双判定）。
 *
 * 长程任务（`LocalBashTask`）、子 agent CLI（`CliRunner`）、`LSPClient`、`REPLToolImpl`
 * 都会把显式目录交给 `spawn(…, { cwd })`；目录无效时 libuv 在 `chdir` 阶段失败，却把错误
 * 包装成 `ENOENT … uv_spawn '<shell>'` ⇒ 读成"可执行文件缺失"（导出记录里连续误判 12+ 次）。
 *
 * 放在 **infra** 而非 `tools/utils`：`lsp` 归属 infra 层，不能反向依赖 app 的 tools
 *（`lint:arch` R00-001）。工具侧（Bash/PowerShell）仍用 `checkPathAccessibility` 的
 * 更丰富诊断（盘符不一致 / 同级候选），本函数只回答"能不能当 cwd"。
 *
 * @param cwd 显式工作目录（`undefined`/空 ⇒ 由平台默认（进程 cwd）接管，本函数不判）
 * @param label 报错里的名词（如「任务工作目录」）
 * @returns `null` = 可用；否则为**可操作的中文错误**（调用方据此拒绝 spawn）
 */
export function describeUnusableSpawnCwd(
  cwd: string | null | undefined,
  label = '工作目录'
): string | null {
  if (!cwd) return null;
  if (!existsSync(cwd)) {
    return `${label}不存在: ${cwd}（这不是可执行文件缺失：子进程在 chdir 阶段就失败了）`;
  }
  let isDirectory = false;
  try {
    isDirectory = statSync(cwd).isDirectory();
  } catch {
    // 存在但 stat 失败（权限/被占用）⇒ 按不可用处理（fail-closed）
    isDirectory = false;
  }
  if (!isDirectory) {
    return `${label}不是目录: ${cwd}（不能作为子进程的工作目录）`;
  }
  return null;
}
