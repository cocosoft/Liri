// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * isolationPathMap — 宿主路径 ↔ 隔离环境内路径的映射（方案 A，2026-10-23）
 *
 * 只有拿到**显式挂载映射**（宿主工作区根 ↔ 容器 / 远端根），才能把工具解析出的
 * 宿主绝对路径翻译成隔离环境内的路径；否则"在隔离环境里写文件"无处落地
 * （会写进容器临时层或远端家目录，而用户在外层看不到该文件）。
 *
 * 纯函数、零依赖：`WorkspaceBase` 适配器（`DockerWorkspace`）与
 * `workspaceIsolation` 共用同一实现（CS01 归一化，避免两套路径算法）。
 */

/** 宿主根 ↔ 隔离环境内根 的映射 */
export interface WorkspacePathMap {
  /** 宿主侧工作区根（绝对路径） */
  hostRoot: string;
  /** 隔离环境（容器 / 远端）内与该根对应的**绝对**路径 */
  isolatedRoot: string;
}

/** 统一分隔符并去掉尾部斜杠（空串 / 根路径保持原样） */
function normalizeForFs(p: string): string {
  const unified = p.replace(/\\/g, '/');
  if (unified === '/') return '/';
  return unified.replace(/\/+$/, '');
}

/** 宿主侧比较口径：Windows 大小写不敏感（与 `PathRestrictions.normalizePath` 同口径） */
function comparable(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

/** 两个**宿主侧**路径是否指向同一位置 */
export function isSameWorkspacePath(a: string, b: string): boolean {
  return comparable(normalizeForFs(a)) === comparable(normalizeForFs(b));
}

/**
 * 从**多个**挂载中挑出覆盖该宿主路径的那一个（**最长前缀**优先）。
 *
 * 用途：一个隔离环境可能挂载多个根（会话工作区 + 项目 sandbox）；路径可能同时落在
 * 两个根之下（如项目在会话工作区内），必须选**更具体**的挂载，否则会把路径翻译到
 * 较浅的容器路径上（写错位置）。
 *
 * @returns 覆盖该路径的挂载；都不覆盖 ⇒ `null`
 */
export function findMountForPath(
  maps: readonly WorkspacePathMap[],
  hostAbsPath: string
): WorkspacePathMap | null {
  const target = comparable(normalizeForFs(hostAbsPath));
  let best: WorkspacePathMap | null = null;
  let bestLen = -1;
  for (const map of maps) {
    const root = comparable(normalizeForFs(map.hostRoot));
    if (root === '') continue;
    const covered =
      target === root || target.startsWith(root === '/' ? '/' : `${root}/`);
    if (!covered) continue;
    if (root.length > bestLen) {
      best = map;
      bestLen = root.length;
    }
  }
  return best;
}

/**
 * 宿主绝对路径 → 隔离环境内绝对路径（按**单条**挂载换算）。
 *
 * @returns `null` = 不在该挂载的 `hostRoot` 之下（**不得**据此声称隔离；调用方保持宿主直写）
 */
export function toIsolatedPath(
  map: WorkspacePathMap,
  hostAbsPath: string
): string | null {
  const hostRoot = normalizeForFs(map.hostRoot);
  const target = normalizeForFs(hostAbsPath);
  const isolatedRoot = normalizeForFs(map.isolatedRoot) || '/';

  if (comparable(target) === comparable(hostRoot)) return isolatedRoot;

  // 用原始大小写切片：Windows 比较不敏感，但**路径大小写要原样保留**
  const prefix = `${hostRoot}/`;
  if (!comparable(target).startsWith(comparable(prefix))) return null;

  const rest = target.slice(prefix.length);
  return isolatedRoot === '/' ? `/${rest}` : `${isolatedRoot}/${rest}`;
}
