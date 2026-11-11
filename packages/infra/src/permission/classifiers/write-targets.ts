// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 写目标识别（P3，2026-11-12）—— L5 数据流的最小实现。
 *
 * ## 为什么需要
 * `iwr -Uri .\local -OutFile out.txt` 此前被 `-outfile` 令牌一律转审批：**工作区内**的
 * 正常落盘也要用户点一次，而真正需要确认的是"写到工作区外"。本模块负责从命令里
 * 抽出**写目标**，交给工作区边界判据（`isWithinWorkingDirectory`）分级。
 *
 * ## 覆盖范围（刻意保守）
 * - 只识别 PowerShell 下载器族的具名参数与 shell 重定向：
 *   `-OutFile` / `-Destination` / `-DestinationPath` / `>` / `>>`；
 * - **不**把 `-Path` 纳入：它同时用于读与写，语义不唯一（`Get-Item -Path`）；
 * - 解析失败（拿不到目标）⇒ 返回空数组，调用方保持原档位（fail-closed）。
 *
 * 纯函数、零 IO。
 */

/** 写目标参数（下载器 / 归档 cmdlet） */
const PARAM_TARGET_PATTERN =
  /-(?:outfile|destination|destinationpath)\s+["']?([^"'\s|;&<>]+)/gi;

/** 重定向目标（排除 `2>&1` / `>&` 这类句柄重定向） */
const REDIRECT_TARGET_PATTERN = /(?:>>?)\s*["']?([^"'\s|;&<>]+)/g;

/** 句柄重定向 / 纯数字等非文件目标 */
function isRealTarget(candidate: string): boolean {
  if (!candidate) return false;
  if (/^[&\d]+$/.test(candidate)) return false;
  if (candidate.startsWith('/dev/') || candidate.startsWith('NUL')) return false;
  return true;
}

/**
 * 抽出命令里的写目标（去重、保序）。
 *
 * 例：`iwr -Uri .\a -OutFile .\out.txt` ⇒ `["./out.txt"]`；
 *     `echo hi > log.txt` ⇒ `["log.txt"]`。
 */
export function extractWriteTargets(surface: string): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  const push = (candidate: string): void => {
    if (!isRealTarget(candidate) || seen.has(candidate)) return;
    seen.add(candidate);
    targets.push(candidate);
  };

  for (const match of surface.matchAll(PARAM_TARGET_PATTERN)) {
    push(match[1]!);
  }
  for (const match of surface.matchAll(REDIRECT_TARGET_PATTERN)) {
    push(match[1]!);
  }
  return targets;
}
