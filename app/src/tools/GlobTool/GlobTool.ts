/**
 * GlobTool - glob文件模式匹配
 */
import * as fs from 'fs';
import * as path from 'path';

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { yieldToEventLoop } from '@modules/ai';
import { resolveSkipDirs } from '../utils/searchSkipDirs';
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

const GLOB_TOOL_MAX_FILES = 100;

/**
 * 不可读目录（EPERM / EACCES / ENOENT 等）属遍历用户目录时的**预期**情况。
 *
 * 根因修复（2026-09-27，实测取证）：原实现对**每个**不可读目录调用 `handleError`
 * ⇒ 一次全盘 glob 会产出数十条 `severity:medium` 的 `[readdir] EPERM…`（`AppData` /
 * `$Recycle.Bin` 等系统保护目录在多轮遍历中反复出现）⇒ **噪音风暴**并污染告警面
 * （见 `dev_docs/debug-long-task-interrupt.md`）。
 * 现改为：计数 + 每 30s 至多一条 debug —— 保住可观测性，不再逐目录上报错误。
 */
const SKIPPED_DIR_LOG_INTERVAL_MS = 30_000;
let skippedDirCount = 0;
let skippedDirLastLogAt = 0;

function noteSkippedDir(dir: string, err: unknown): void {
  skippedDirCount++;
  const now = Date.now();
  if (now - skippedDirLastLogAt < SKIPPED_DIR_LOG_INTERVAL_MS) return;
  skippedDirLastLogAt = now;
  logger.debug('glob: 跳过不可读目录（预期内，已聚合）', {
    skippedInWindow: skippedDirCount,
    lastDir: dir,
    reason: err instanceof Error ? err.message : String(err),
  });
  skippedDirCount = 0;
}

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
  // 2026-10-23（预存台账）：模式**只编译一次**并传入遍历（原实现每个文件编译 2 次）。
  const matcher = compileGlobMatcher(normalizedPattern);
  const invalidPattern = matcher === null ? normalizedPattern : undefined;

  // 执行目录遍历并收集匹配文件，若发生错误（如权限拒绝）则静默处理
  if (matcher) {
    try {
      walkDir(
        normalizedSearchPath,
        matcher,
        results,
        GLOB_TOOL_MAX_FILES,
        resolveSkipDirs(normalizedPattern, normalizedSearchPath)
      );
    } catch (err) {
      handleError(err, {
        module: 'tools:glob',
        action: 'walkDirGlobRoot',
      });
    }
  }

  const durationMs = Date.now() - startTime;
  const truncated = results.length >= GLOB_TOOL_MAX_FILES;

  return {
    durationMs,
    numFiles: results.length,
    filenames: results.slice(0, GLOB_TOOL_MAX_FILES),
    truncated,
    ...(invalidPattern ? { invalidPattern } : {}),
  };
}

/**
 * 协作式异步 glob（与 glob() 结果语义完全一致）。
 *
 * 根因修复（2026-09-01）：glob() 为纯同步递归遍历（readdirSync），GLOB_TOOL_MAX_FILES 上限
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

  const matcher = compileGlobMatcher(normalizedPattern);
  const invalidPattern = matcher === null ? normalizedPattern : undefined;

  if (matcher) {
    try {
      await walkDirAsync(
        normalizedSearchPath,
        matcher,
        results,
        GLOB_TOOL_MAX_FILES,
        resolveSkipDirs(normalizedPattern, normalizedSearchPath)
      );
    } catch (err) {
      handleError(err, {
        module: 'tools:glob',
        action: 'walkDirGlobRoot',
      });
    }
  }

  const durationMs = Date.now() - startTime;
  const truncated = results.length >= GLOB_TOOL_MAX_FILES;

  return {
    durationMs,
    numFiles: results.length,
    filenames: results.slice(0, GLOB_TOOL_MAX_FILES),
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
  matcher: CompiledGlobMatcher,
  results: string[],
  limit: number,
  skipDirs: ReadonlySet<string> = new Set(),
  /** 相对搜索根的目录前缀（`''` = 根层；用 `/` 连接，避免逐文件 `path.relative`） */
  relDir: string = ''
): Promise<void> {
  if (results.length >= limit) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // 权限受限目录属预期情况 ⇒ 聚合计数（不逐目录上报错误；见 noteSkippedDir 注释）
    noteSkippedDir(dir, err);
    return;
  }

  let processed = 0;
  for (const entry of entries) {
    if (results.length >= limit) break;
    if (entry.name.startsWith('.') && entry.name !== '.') continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 2026-09-22：跳过构建产物/依赖等"重目录"（与 grep 同一清单）。
      // 修复前从项目根 `**/X.ts` 会递归 `node_modules`（本仓 6.5 万+ 文件），
      // 实测单次 7960ms；模式显式点名该目录时不跳过（见 resolveSkipDirs）。
      if (skipDirs.has(entry.name)) continue;
      const childRelDir = relDir ? `${relDir}/${entry.name}` : entry.name;
      await walkDirAsync(
        fullPath,
        matcher,
        results,
        limit,
        skipDirs,
        childRelDir
      );
    } else if (entry.isFile()) {
      const relativePath = relDir ? `${relDir}/${entry.name}` : entry.name;
      // G2：仅按完整/相对路径（含分隔符）匹配，不再退化为 basename，使 `*` 不跨目录边界
      if (matcher.test(fullPath) || matcher.test(relativePath)) {
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
 * * @param dir - 需要遍历的根目录
 * @param matcher - 预编译的模式匹配器（遍历期间复用，避免逐文件编译正则）
 * @param results - 用于存储匹配到的文件路径的数组（会直接修改此数组）
 * @param limit - 限制收集的最大文件数量，达到该数量后停止遍历
 * @param skipDirs - 跳过的"重目录"集合
 * @param relDir - 相对搜索根的目录前缀（由递归逐层拼接，替代逐文件 `path.relative`）
 */
function walkDir(
  dir: string,
  matcher: CompiledGlobMatcher,
  results: string[],
  limit: number,
  skipDirs: ReadonlySet<string> = new Set(),
  /** 相对搜索根的目录前缀（`''` = 根层；见 `walkDirAsync`） */
  relDir: string = ''
): void {
  // 如果已收集的结果数量达到上限，则提前返回
  if (results.length >= limit) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // 权限受限目录属预期情况 ⇒ 聚合计数（不逐目录上报错误；见 noteSkippedDir 注释）
    noteSkippedDir(dir, err);
    return;
  }

  for (const entry of entries) {
    // 在每次迭代前检查是否已达到数量上限，以支持早期退出
    if (results.length >= limit) break;
    // 跳过隐藏文件和目录（除了当前目录 '.' 本身，但通常 '.' 不会作为条目出现，此处主要过滤如 '.git' 等）
    if (entry.name.startsWith('.') && entry.name !== '.') continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 如果是目录，则递归遍历（"重目录"跳过语义与 walkDirAsync 一致）
      if (skipDirs.has(entry.name)) continue;
      const childRelDir = relDir ? `${relDir}/${entry.name}` : entry.name;
      walkDir(fullPath, matcher, results, limit, skipDirs, childRelDir);
    } else if (entry.isFile()) {
      // G2：仅按完整/相对路径（含分隔符）匹配，不再退化为 basename，使 `*` 不跨目录边界
      const relativePath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (matcher.test(fullPath) || matcher.test(relativePath)) {
        results.push(fullPath);
      }
    }
  }
}

/**
 * G2：将 glob 模式编译为正则；模式无法解析（如未闭合的 `[`、孤立 `\`）时返回 null。
 * 供 `compileGlobMatcher` 判定匹配，也供 glob()/globAsync() 前置校验以区分「空结果」与「模式无效」。
 *
 * 2026-09-22 性能取证（**结论：此处不是瓶颈，故未做缓存**）：曾假设"逐文件重复编译正则"
 * 是主因并加过按模式缓存，实测无差异（4368ms vs 4415ms，噪声范围内）⇒ 已回退。
 * 真实构成见 `globSkipDirs.test.ts` 同批取证：裸遍历 802ms（7967 目录 / 72781 文件），
 * 同步 `glob()` 2961ms、异步 3270ms ⇒ 差额 ≈2.2s 花在**每文件的匹配回调**
 * （`path.relative` + 2 次 `matchGlob`），而非正则编译；让出开销仅 4ms/1600 次。
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
 * **预编译的 glob 匹配器**（2026-10-23 主循环优化）。
 *
 * 支持的通配符与语义与旧 `matchGlob` 完全一致：
 * - `*` 匹配任意非路径分隔符字符；`**` 跨目录；`?` 单字符；
 * - G2（2026-09-17）：匹配针对完整路径（含分隔符），`*.ts` 不跨目录；
 *   `**` 前缀额外用剥离「双星斜杠」后的模式再匹配一次（兼容根层命中）。
 *
 * 性能：正则**只编译一次**（旧实现每个文件最多编译 4 次），遍历期间复用。
 */
interface CompiledGlobMatcher {
  test(value: string): boolean;
}

function compileGlobMatcher(pattern: string): CompiledGlobMatcher | null {
  const regex = compileGlobPattern(pattern);
  if (!regex) return null;

  const stripped = pattern.startsWith('**')
    ? pattern.replace(/^\*\*\/?/, '')
    : '';
  const regex2 =
    stripped && stripped !== pattern ? compileGlobPattern(stripped) : null;

  return {
    test(value: string): boolean {
      // 路径中的反斜杠统一为斜杠，确保 Windows 路径也能正确匹配
      const normalized = value.replace(/\\/g, '/');
      if (regex.test(normalized)) return true;
      return regex2 ? regex2.test(normalized) : false;
    },
  };
}
