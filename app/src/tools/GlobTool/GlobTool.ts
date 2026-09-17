/**
 * GlobTool - glob文件模式匹配
 */
import * as fs from 'fs';
import * as path from 'path';

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { yieldToEventLoop } from '@modules/ai';
const logger = getLogger('tools:GlobTool:GlobTool');

export interface GlobResult {
  durationMs: number;
  numFiles: number;
  filenames: string[];
  truncated: boolean;
  /**
   * G2：模式无法解析为有效 glob 时携带原始模式（空结果 ≠ 模式无效。
   * 未定义表示模式有效；定义时调用方应将「无匹配文件」与「模式无效」明确区分）。
   */
  invalidPattern?: string;
}

const MAX_FILES = 100;

/**
 * 根据指定的通配符模式在目标路径下搜索匹配的文件。
 * * @param pattern - 用于匹配文件名的通配符模式字符串
 * @param searchPath - 搜索的起始目录路径，默认为当前工作目录
 * @returns 包含搜索结果统计信息和文件列表的对象
 */
export function glob(
  pattern: string,
  searchPath: string = process.cwd()
): GlobResult {
  const startTime = Date.now();
  const results: string[] = [];

  // 将模式中的反斜杠统一为斜杠，确保跨平台路径匹配一致性
  const normalizedPattern = pattern.replace(/\\/g, '/');
  const normalizedSearchPath = searchPath.replace(/\\/g, '/');

  // G2：模式无法解析为有效 glob 时，跳过遍历并返回可标识的 invalidPattern 字段，
  // 使调用方把「无匹配文件」与「模式无效」明确区分（原始实现二者同为 `[]`）。
  const invalidPattern =
    compileGlobPattern(normalizedPattern) === null
      ? normalizedPattern
      : undefined;

  // 执行目录遍历并收集匹配文件，若发生错误（如权限拒绝）则静默处理
  if (!invalidPattern) {
    try {
      walkDir(
        normalizedSearchPath,
        normalizedPattern,
        results,
        MAX_FILES,
        normalizedSearchPath
      );
    } catch (err) {
      handleError(err, {
        module: 'tools:glob',
        action: 'walkDirGlobRoot',
      });
    }
  }

  const durationMs = Date.now() - startTime;
  const truncated = results.length >= MAX_FILES;

  return {
    durationMs,
    numFiles: results.length,
    filenames: results.slice(0, MAX_FILES),
    truncated,
    ...(invalidPattern ? { invalidPattern } : {}),
  };
}

/**
 * 协作式异步 glob（与 glob() 结果语义完全一致）。
 *
 * 根因修复（2026-09-01）：glob() 为纯同步递归遍历（readdirSync），MAX_FILES 上限
 * 仅在"匹配到 100 个文件"时提前退出；当模式匹配少（如 *.txt）时会遍历整个目录树
 * （项目根 6.5 万+ 文件），同步阻塞事件循环数分钟——SSE 心跳/HTTP 请求全停，
 * 前端 60s/120s 无数据误判"流式响应超时"（与 grep() 同类问题，对称修复）。
 * 本版本每处理 GLOB_YIELD_BATCH_SIZE 个条目让出一次事件循环，扫描期间心跳保持。
 */
const GLOB_YIELD_BATCH_SIZE = 50;

export async function globAsync(
  pattern: string,
  searchPath: string = process.cwd()
): Promise<GlobResult> {
  const startTime = Date.now();
  const results: string[] = [];

  const normalizedPattern = pattern.replace(/\\/g, '/');
  const normalizedSearchPath = searchPath.replace(/\\/g, '/');

  const invalidPattern =
    compileGlobPattern(normalizedPattern) === null
      ? normalizedPattern
      : undefined;

  if (!invalidPattern) {
    try {
      await walkDirAsync(
        normalizedSearchPath,
        normalizedPattern,
        results,
        MAX_FILES,
        normalizedSearchPath
      );
    } catch (err) {
      handleError(err, {
        module: 'tools:glob',
        action: 'walkDirGlobRoot',
      });
    }
  }

  const durationMs = Date.now() - startTime;
  const truncated = results.length >= MAX_FILES;

  return {
    durationMs,
    numFiles: results.length,
    filenames: results.slice(0, MAX_FILES),
    truncated,
    ...(invalidPattern ? { invalidPattern } : {}),
  };
}

/**
 * 协作式递归目录遍历：每处理 GLOB_YIELD_BATCH_SIZE 个条目让出一次事件循环，
 * 保证 SSE 心跳 / HTTP 请求等 I/O 在遍历大型目录期间不被长时间阻塞。
 */
async function walkDirAsync(
  dir: string,
  pattern: string,
  results: string[],
  limit: number,
  rootDir?: string
): Promise<void> {
  if (results.length >= limit) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    handleError(err, {
      module: 'tools:glob',
      action: 'readdir',
    });
    return;
  }

  let processed = 0;
  for (const entry of entries) {
    if (results.length >= limit) break;
    if (entry.name.startsWith('.') && entry.name !== '.') continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDirAsync(fullPath, pattern, results, limit, rootDir);
    } else if (entry.isFile()) {
      const relativePath = rootDir
        ? path.relative(rootDir, fullPath).replace(/\\/g, '/')
        : '';
      // G2：仅按完整/相对路径（含分隔符）匹配，不再退化为 basename，使 `*` 不跨目录边界
      if (
        matchGlob(fullPath, pattern) ||
        (relativePath && matchGlob(relativePath, pattern))
      ) {
        results.push(fullPath);
      }
    }

    // 协作式让出：每处理一批条目让出事件循环，遍历期间 SSE 心跳保持
    if (++processed % GLOB_YIELD_BATCH_SIZE === 0) {
      await yieldToEventLoop();
    }
  }
}

/**
 * 递归遍历指定目录，查找匹配给定模式的文件路径，并将结果存入数组中。
 * * @param dir - 需要遍历的根目录路径
 * @param pattern - 用于匹配文件名或完整路径的通配符模式
 * @param results - 用于存储匹配到的文件路径的数组（会直接修改此数组）
 * @param limit - 限制收集的最大文件数量，达到该数量后停止遍历
 * @param rootDir - 搜索根目录，用于计算相对路径（可选）
 */
function walkDir(
  dir: string,
  pattern: string,
  results: string[],
  limit: number,
  rootDir?: string
): void {
  // 如果已收集的结果数量达到上限，则提前返回
  if (results.length >= limit) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    handleError(err, {
      module: 'tools:glob',
      action: 'readdir',
    });
    return;
  }

  for (const entry of entries) {
    // 在每次迭代前检查是否已达到数量上限，以支持早期退出
    if (results.length >= limit) break;
    // 跳过隐藏文件和目录（除了当前目录 '.' 本身，但通常 '.' 不会作为条目出现，此处主要过滤如 '.git' 等）
    if (entry.name.startsWith('.') && entry.name !== '.') continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 如果是目录，则递归遍历
      walkDir(fullPath, pattern, results, limit, rootDir);
    } else if (entry.isFile()) {
      // G2：仅按完整/相对路径（含分隔符）匹配，不再退化为 basename，使 `*` 不跨目录边界
      const relativePath = rootDir
        ? path.relative(rootDir, fullPath).replace(/\\/g, '/')
        : '';
      if (
        matchGlob(fullPath, pattern) ||
        (relativePath && matchGlob(relativePath, pattern))
      ) {
        results.push(fullPath);
      }
    }
  }
}

/**
 * G2：将 glob 模式编译为正则；模式无法解析（如未闭合的 `[`、孤立 `\`）时返回 null。
 * 供 matchGlob 判定匹配，也供 glob()/globAsync() 前置校验以区分「空结果」与「模式无效」。
 */
function compileGlobPattern(pattern: string): RegExp | null {
  // G1（架构归一 B 系列同根因，2026-09-17）：花括号展开（单层 {a,b|c}）。
  // 此前 `{A,B}` 未被展开、当成字面量，被 `^...$` 锚定后永不匹配 → 静默返回 []，
  // 调用方无法区分「文件不存在」与「模式不支持」。此处扩展为 `(A|B)` 交替组，
  // 使 `*.{ts,js}`、`{*.ts,*.js}` 等真实展开匹配，不再吞掉空结果。
  const expandedPattern = pattern.replace(/\{[^{}]*\}/g, (m) => {
    const body = m.slice(1, -1);
    return `(${body.split(',').join('|')})`;
  });

  // 将 glob 模式转换为正则表达式字符串
  // 1. 转义字面量点号
  // 2. 临时替换 ** 为占位符，避免被单星号逻辑干扰
  // 3. 将单星号 * 替换为匹配非路径分隔符的字符类
  // 4. 将占位符恢复为匹配任意字符的 .*
  // 5. 将问号 ? 替换为匹配单个字符的 .
  const regexStr = expandedPattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '@@DOUBLE_STAR@@')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(/@@DOUBLE_STAR@@/g, '.*')
    .replace(/\?/g, '.');

  try {
    return new RegExp(`^${regexStr}$`, 'i');
  } catch {
    return null;
  }
}

/**
 * 检查文件名或路径是否匹配给定的 glob 模式。
 * * 支持以下通配符：
 * - `*`: 匹配任意非路径分隔符字符（不包括 `/` 和 `\`）
 * - `**`: 匹配任意字符（包括路径分隔符）
 * - `?`: 匹配单个任意字符
 *
 * G2 语义修正（2026-09-17）：匹配针对**传入的完整名称字符串**（含路径分隔符），
 * 不再退化到 basename。据此 `*` 不跨目录边界：`*.ts` 仅命中搜索目录根层，
 * 递归子目录需用「双星」前缀模式（`**` 引导）。为保持该前缀模式也能命中根层文件，
 * `**` 开头时额外用剥离「双星斜杠」前缀（`**` + 分隔符）后的模式匹配一次（兼容全局递归的既有预期）。
 *
 * 路径中的反斜杠会被自动转换为斜杠，确保 Windows 路径也能正确匹配。
 * @param name - 要检查的文件名或路径字符串
 * @param pattern - glob 模式字符串
 * @returns 如果名称匹配模式则返回 true，否则返回 false
 */
function matchGlob(name: string, pattern: string): boolean {
  const normalizedName = name.replace(/\\/g, '/');

  const regex = compileGlobPattern(pattern);
  if (regex && regex.test(normalizedName)) {
    return true;
  }

  // `**` 前缀允许命中根层（0 层路径分隔），兼容「双星」前缀模式的全局递归既有预期
  if (pattern.startsWith('**')) {
    const stripped = pattern.replace(/^\*\*\/?/, '');
    if (stripped && stripped !== pattern) {
      const regex2 = compileGlobPattern(stripped);
      if (regex2 && regex2.test(normalizedName)) {
        return true;
      }
    }
  }

  return false;
}
