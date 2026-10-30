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

/**
 * #22（2026-10-30）：命名清洗用常量。
 *
 * 真机遗留名（`project.json` 已存的值，前端原样显示）：
 * - `【E:\PY\Documents\CODES\PY_APP\` —— 截断在引用块中间，`【` 未闭合；
 * - `我与gemini进行了一轮沟通，见【E:\PY\Docume` —— 引用块里的路径被截断进名称。
 * 共同点：**引用块/代码块被当成标题正文**，且截断点落在括号内部。故清洗顺序为
 * 「先摘块 → 再去外层包裹 → 平衡括号 → 安全截断」。
 */
const FENCED_CODE_BLOCK = /```[\s\S]*?```/g;
/** 完整的引用块（`【…】` / `「…」` / `『…』`）—— 常是路径或文件片段，不进项目名 */
const QUOTED_BLOCKS = /【[^】]*】|「[^」]*」|『[^』]*』/g;
/** 行内代码 `` `…` `` */
const INLINE_CODE = /`[^`]*`/g;
/** 名称长度上限（按**字符**计，非字节；emoji 等代理对不会被切开） */
const MAX_NAME_CHARS = 60;
/** 括号配对表 —— 只处理"成对且方向明确"的括号（引号语义模糊，不在此列） */
const BRACKET_PAIRS: Record<string, string> = {
  '【': '】',
  '[': ']',
  '「': '」',
  '『': '』',
  '（': '）',
  '(': ')',
  '《': '》',
};
/** 截断后去掉结尾的空白与路径/列表分隔符（避免以 `\` `/` `，` 收尾） */
const TRAILING_SEPARATORS = /[\s\\/，,、;；:：\-–—]+$/;

export interface ResolvedProjectIdentity {
  /** 展示用项目名（已净化/截断） */
  name: string;
  /** 命中"名称是已存在目录"时给出，作为沙箱根 */
  sandboxPath?: string;
}

/**
 * 默认项目名（清洗后为空 / 只剩路径时使用）。
 *
 * 用**本地时间**且带日期，避免"未命名项目"这类无法区分的占位名。
 */
export function defaultProjectName(now: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `项目 ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(
    now.getDate()
  )} ${p(now.getHours())}:${p(now.getMinutes())}`;
}

/**
 * 丢弃"最外层未闭合开括号"之后的内容。
 *
 * 例：`我与gemini进行了一轮沟通，见【E:\PY\Docume` ⇒ `我与gemini进行了一轮沟通，见`。
 * 平衡的标题原样返回（普通标题不受影响）。
 */
function dropUnbalancedTail(text: string): string {
  const chars = Array.from(text);
  const stack: Array<{ ch: string; idx: number }> = [];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (BRACKET_PAIRS[ch]) {
      stack.push({ ch, idx: i });
    } else if (
      stack.length > 0 &&
      BRACKET_PAIRS[stack[stack.length - 1].ch] === ch
    ) {
      stack.pop();
    }
  }
  if (stack.length === 0) return text;
  return chars.slice(0, stack[0].idx).join('');
}

/**
 * 安全截断：按**字符**切、不切在括号内部、不以分隔符收尾。
 *
 * @returns 截断后的名称（必带 `…`）；若截断后为空返回空串（由调用方回落默认名）
 */
function truncateSafely(text: string): string {
  const chars = Array.from(text);
  if (chars.length <= MAX_NAME_CHARS) return text;
  const cut = dropUnbalancedTail(chars.slice(0, MAX_NAME_CHARS).join(''))
    .replace(TRAILING_SEPARATORS, '')
    .trim();
  return cut ? `${cut}…` : '';
}

/** 「整条就是一个引用块」⇒ 取块内文本（真机：模型把整条标题写成 `【…】`） */
const SOLE_QUOTED_BLOCK = /^(?:【([^】]*)】|「([^」]*)」|『([^』]*)』)$/;

function sanitizeTitle(raw: string, now: Date = new Date()): string {
  let text = raw
    .replace(/\u0000/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    // 先摘"整块"内容：代码块 / 行内代码（里面多是路径或文件片段）
    .replace(FENCED_CODE_BLOCK, ' ')
    .replace(INLINE_CODE, ' ')
    .trim();

  // 整条是引用块 ⇒ 用块内文本（不能当"内嵌引用"整块删掉，否则名字会丢）
  const sole = SOLE_QUOTED_BLOCK.exec(text);
  if (sole) text = sole[1] ?? sole[2] ?? sole[3] ?? '';

  const stripped = text
    // 内嵌引用块（标题里夹带的路径/文件片段）⇒ 摘掉
    .replace(QUOTED_BLOCKS, ' ')
    // 外层包裹（模型把整条标题包在括号/引号里的情况）
    .replace(LEADING_WRAPPERS, '')
    .replace(TRAILING_WRAPPERS, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // 括号未闭合（截断遗留）⇒ 丢掉未闭合部分，避免出现悬空 `【` / `\`
  const balanced = dropUnbalancedTail(stripped)
    .replace(TRAILING_SEPARATORS, '')
    .trim();
  // 只剩路径 ⇒ 不做名字（路径本身已由 resolveProjectIdentity 处理沙箱，不该当标题）
  if (!balanced || PATH_LIKE.test(balanced)) return defaultProjectName(now);
  const truncated = truncateSafely(balanced);
  return truncated || defaultProjectName(now);
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
 * @param now 注入式时钟（默认名 `项目 YYYY-MM-DD HH:mm` 用；测试注入固定时刻）
 */
export function resolveProjectIdentity(
  rawName: string,
  options: { isDirectory?: (p: string) => boolean; now?: Date } = {}
): ResolvedProjectIdentity {
  const pathLike = asPathLikeName(rawName);
  if (!pathLike) return { name: sanitizeTitle(rawName, options.now) };

  const dirName = dirNameOf(pathLike) || sanitizeTitle(rawName, options.now);
  const exists = options.isDirectory?.(pathLike) === true;
  return exists ? { name: dirName, sandboxPath: pathLike } : { name: dirName };
}
