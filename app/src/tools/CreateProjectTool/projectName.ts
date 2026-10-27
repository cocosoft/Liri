/**
 * projectName — `create_project` 的**名称/沙箱解析**（纯函数，2026-10-27，FIX-11）
 *
 * 真机证据（`~/.pyapp/data/projects/proj_1792831085133_bfc455/project.json`）：
 * `name` 与 `description` 都是 `【E:\PY\Documents\CODES\PY_APP\` —— 模型把**路径当项目名**传进来，
 * 而 `ProjectStore.create` 默认把沙箱建到 `~/Documents/LiriProjects/<id>`（空目录）。
 * 后果：always-on 会话想读仓库 ⇒ 全部被"会话工作区严格边界"拒绝（日志 6 次），任务空转。
 *
 * 口径：
 * - 仅当**名称本身**是路径形态（`E:\…`、`/…`，允许外层括号/引号）时才做特判 ——
 *   普通标题里出现路径不影响；
 * - 路径存在且是目录 ⇒ 用它作 `sandboxPath`，标题改用目录名（`PY_APP`）；
 * - 路径不存在 ⇒ 只净化标题（仍用默认沙箱），避免"指向不存在目录"的新坏状态；
 * - 其余情况：清控制字符、去外层括号/引号、截断 60 字；空 ⇒ 「未命名项目」。
 */

import { basename } from 'path';

/** 目录名（**同时识别 `\` 与 `/`**，保证 Linux/macOS 上解析 Windows 路径也正确） */
function dirNameOf(pathLike: string): string {
  const parts = pathLike.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : basename(pathLike);
}
/** 外层包裹字符（模型常把路径写在 `【】` / `「」` / 引号里，且可能只开不闭） */
const LEADING_WRAPPERS = /^[【[「『"'`]+/;
const TRAILING_WRAPPERS = /[】\]」』"'`]+$/;
/** Windows 盘符路径或 POSIX 绝对路径 */
const PATH_LIKE = /^(?:[A-Za-z]:[\\/]|\/)/;

export interface ResolvedProjectIdentity {
  /** 展示用项目名（已净化/截断） */
  name: string;
  /** 命中"名称是已存在目录"时给出，作为沙箱根 */
  sandboxPath?: string;
}

function sanitizeTitle(raw: string): string {
  const cleaned = raw
    .replace(/\u0000/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .replace(LEADING_WRAPPERS, '')
    .replace(TRAILING_WRAPPERS, '')
    .trim();
  if (!cleaned) return '未命名项目';
  return cleaned.length > 60 ? `${cleaned.slice(0, 60)}…` : cleaned;
}

/** 名称是否**整体**是路径（去外层括号后以盘符/斜杠开头） */
function asPathLikeName(rawName: string): string | null {
  const stripped = rawName
    .trim()
    .replace(LEADING_WRAPPERS, '')
    .replace(TRAILING_WRAPPERS, '')
    .trim();
  if (!PATH_LIKE.test(stripped)) return null;
  // 去掉结尾分隔符，便于 basename / existsSync
  return stripped.replace(/[\\/]+$/, '');
}

/**
 * 解析 `create_project` 的入参。
 *
 * @param isDirectory 注入式目录探测（缺省由调用方传 `existsSync+statSync` 实现）
 */
export function resolveProjectIdentity(
  rawName: string,
  options: { isDirectory?: (p: string) => boolean } = {}
): ResolvedProjectIdentity {
  const pathLike = asPathLikeName(rawName);
  if (!pathLike) return { name: sanitizeTitle(rawName) };

  const dirName = dirNameOf(pathLike) || sanitizeTitle(rawName);
  const exists = options.isDirectory?.(pathLike) === true;
  return exists ? { name: dirName, sandboxPath: pathLike } : { name: dirName };
}
