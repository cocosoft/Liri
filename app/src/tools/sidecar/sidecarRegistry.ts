// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 侧车**进程登记表**（基础设施专项 §6-#5 第二刀）。
 *
 * 背景：子进程自清（`utils/parentLiveness.ts`）只覆盖"父进程正常/异常退出时子进程还在跑"
 * 的窗口。若主进程被 `SIGKILL`、断电、或整机重启在写盘前中断，子进程可能**先于**看门狗
 * 探活失败而留下历史孤儿；重启后没人知道它们的 pid。
 *
 * 本模块只做**记名字 + 对账**：
 * - 登记：监督器 spawn 成功后写 `{pid, parentPid, script, startedAt}`；
 * - 对账：启动期把"子进程已不存在"的条目**清掉**（零风险），把"父已死、子仍活"的
 *   条目**只告警不清杀**（pid 可被复用 ⇒ 强杀有误杀风险，见 §6-#5 的处置口径）。
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { resolveDataDir } from '@modules/environment';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('tools:sidecar:registry');

/** 登记表文件名（位于第二层数据目录） */
export const SIDECAR_REGISTRY_FILE = 'sidecar-registry.json';

/** 一条侧车登记（一条 = 一个曾经由本程序拉起的侧车进程） */
export interface SidecarRegistryEntry {
  /** 侧车 pid */
  pid: number;
  /** 拉起它的宿主 pid */
  parentPid: number;
  /** 侧车脚本文件名（`lspSidecar.ts` / `mediaSidecar.ts`；便于人工辨认） */
  script: string;
  /** 登记时刻（epoch ms） */
  startedAt: number;
}

/** 登记表落盘形状（带版本号，便于以后演进） */
interface SidecarRegistryFile {
  version: 1;
  entries: SidecarRegistryEntry[];
}

/** 登记 / 注销端口（监督器注入；测试用替身，不碰磁盘） */
export interface SidecarRegistryPort {
  register(entry: SidecarRegistryEntry): void;
  unregister(pid: number): void;
}

/** 默认登记表路径（第二层数据目录，遵守 paths 规则） */
export function resolveSidecarRegistryPath(): string {
  return join(resolveDataDir(), SIDECAR_REGISTRY_FILE);
}

/** 从脚本路径取登记用文件名 */
export function scriptLabel(scriptPath: string): string {
  return basename(scriptPath);
}

function parseEntries(raw: unknown): SidecarRegistryEntry[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const entries = (raw as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return [];
  const out: SidecarRegistryEntry[] = [];
  for (const item of entries) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const e = item as Record<string, unknown>;
    const pid = e.pid;
    const parentPid = e.parentPid;
    const script = e.script;
    const startedAt = e.startedAt;
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) continue;
    if (
      typeof parentPid !== 'number' ||
      !Number.isInteger(parentPid) ||
      parentPid <= 0
    ) {
      continue;
    }
    if (typeof script !== 'string' || !script) continue;
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) continue;
    out.push({ pid, parentPid, script, startedAt });
  }
  return out;
}

/**
 * 读取登记表。**文件不存在 ⇒ 空表**；内容损坏（如写入途中断电）⇒ 记 warn 后当空表
 * —— 这是登记表本身能出现的最真实故障，不能让它阻断侧车启动。
 */
export function readSidecarRegistry(
  path: string = resolveSidecarRegistryPath()
): SidecarRegistryEntry[] {
  if (!existsSync(path)) return [];
  try {
    return parseEntries(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    logger.warn('侧车登记表读取失败 ⇒ 视为空表', {
      path,
      error: String(error),
    });
    return [];
  }
}

/** 写登记表（先写临时文件再 rename：崩溃时不会留下半份 JSON） */
export function writeSidecarRegistry(
  entries: SidecarRegistryEntry[],
  path: string = resolveSidecarRegistryPath()
): void {
  mkdirSync(dirname(path), { recursive: true });
  const body: SidecarRegistryFile = { version: 1, entries };
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(body), 'utf8');
  renameSync(tmp, path);
}

/** 文件驱动的默认端口 */
export function createSidecarRegistry(
  path: string = resolveSidecarRegistryPath()
): SidecarRegistryPort {
  return {
    register(entry: SidecarRegistryEntry): void {
      const next = readSidecarRegistry(path).filter((e) => e.pid !== entry.pid);
      next.push(entry);
      writeSidecarRegistry(next, path);
    },
    unregister(pid: number): void {
      const current = readSidecarRegistry(path);
      const next = current.filter((e) => e.pid !== pid);
      if (next.length === current.length) return; // 没登记过 ⇒ 不写盘
      writeSidecarRegistry(next, path);
    },
  };
}

/** 进程是否仍存在（`EPERM` = 存在但无权限 ⇒ 视为存活） */
function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface StaleSweepResult {
  /** 子进程已消失 ⇒ 可从表里清掉（零风险） */
  dead: SidecarRegistryEntry[];
  /** 父已退出、子仍存活 ⇒ **只告警**，不自动清杀（pid 复用有误杀风险） */
  stale: SidecarRegistryEntry[];
  /** 父子都健在 ⇒ 原样保留 */
  live: SidecarRegistryEntry[];
}

/** 纯对账：按「子存活 / 父存活」两问把条目分三类 */
export function classifyRegistryEntries(
  entries: SidecarRegistryEntry[],
  isAlive: (pid: number) => boolean = defaultIsAlive
): StaleSweepResult {
  const result: StaleSweepResult = { dead: [], stale: [], live: [] };
  for (const entry of entries) {
    if (!isAlive(entry.pid)) {
      result.dead.push(entry);
    } else if (!isAlive(entry.parentPid)) {
      result.stale.push(entry);
      result.live.push(entry);
    } else {
      result.live.push(entry);
    }
  }
  return result;
}

const sweptPaths = new Set<string>();

/**
 * 启动期对账（**每个登记表路径只跑一次**）：
 * 清掉 `dead`（进程已不在，无风险），对 `stale` **仅告警**并保留在表里
 * （下次启动会再报，直到它自己退出或被人工清理）。
 *
 * @returns 本次发现的**历史孤儿**（用于健康检查/测试断言）
 */
export function sweepStaleSidecarRegistryOnce(
  deps: { path?: string; isAlive?: (pid: number) => boolean } = {}
): SidecarRegistryEntry[] {
  const path = deps.path ?? resolveSidecarRegistryPath();
  if (sweptPaths.has(path)) return [];
  sweptPaths.add(path);

  const entries = readSidecarRegistry(path);
  if (entries.length === 0) return [];

  const { live, stale, dead } = classifyRegistryEntries(
    entries,
    deps.isAlive ?? defaultIsAlive
  );
  if (dead.length > 0) {
    writeSidecarRegistry(live, path);
    logger.info('侧车登记表已清理已退出的条目', { removed: dead.length });
  }
  if (stale.length > 0) {
    logger.warn(
      '发现历史侧车孤儿（父进程已退出、子进程仍在）⇒ 仅告警，不清杀',
      { count: stale.length, entries: stale }
    );
  }
  return stale;
}
