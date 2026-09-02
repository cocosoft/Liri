/**
 * GrepTool - 代码搜索工具
 */
import * as fs from 'fs';
import * as path from 'path';
import { handleError } from '@modules/error';
import { yieldToEventLoop } from '@modules/ai';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:GrepTool:grep');

// 懒初始化 Rust 原生模块，用于自动检测文件编码
let nativeReadFile: ((filePath: string) => string) | null = null;

function lazyInitNativeRead() {
  if (nativeReadFile === undefined) {
    try {
      const native = require('../../../native');
      if (native && typeof native.readFileWithEncoding === 'function') {
        nativeReadFile = (filePath) => {
          const result = native.readFileWithEncoding(filePath);
          if (result.encoding === 'error') {
            throw new Error(result.error || '编码检测失败');
          }
          return result.content;
        };
      } else {
        nativeReadFile = null;
      }
    } catch (err) {
      handleError(err, {
        module: 'tools:grep',
        action: 'initNativeReadFile',
      });
      nativeReadFile = null;
    }
  }
  return nativeReadFile;
}

export type GrepOutputMode = 'content' | 'files_with_matches' | 'count';

export interface GrepOptions {
  pattern: string;
  searchPath?: string;
  include?: string;
  outputMode?: GrepOutputMode;
  contextBefore?: number;
  contextAfter?: number;
  contextAround?: number;
  showLineNumbers?: boolean;
  caseInsensitive?: boolean;
  type?: string;
  headLimit?: number;
  offset?: number;
  multiline?: boolean;
}

export interface GrepResult {
  matches: string[];
  matchCount: number;
  fileCount: number;
  truncated: boolean;
  durationMs: number;
}

const VCS_DIRS = new Set(['.git', '.svn', '.hg', '.bzr']);
const MAX_RESULTS = 500;

/**
 * 全项目扫描时跳过的构建产物/备份/缓存目录（2026-09-01 P1）：
 * 模型常以 searchPath:"." 扫项目根，target（Rust 产物 .dll）、
 * _migration_backup（.db 备份）、dist 等目录文件多且多为二进制，
 * 此前单次 grep 可长达 17-83s，直接阻塞互斥锁与整个工具循环。
 */
const SKIP_DIRS = new Set([
  'target',
  'dist',
  'build',
  'out',
  'coverage',
  '_migration_backup',
  'backup',
  'backups',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  'cache',
  '.cache',
  'tmp',
  'temp',
  'logs',
  'node_modules',
]);

/**
 * 在指定目录中搜索匹配正则表达式的文件内容。
 * * @param options - 搜索配置选项
 * @param options.searchPath - 要搜索的根目录路径，默认为当前工作目录；若为文件路径则自动降级为单文件搜索
 * @param options.pattern - 用于匹配的正则表达式模式字符串
 * @param options.multiline - 是否启用多行匹配模式
 * @param options.outputMode - 输出模式：'files_with_matches'（仅文件名）、'count'（文件名及匹配数）、'content'（匹配的具体内容行）
 * @param options.headLimit - 最大返回结果行数限制，默认为 200
 * @param options.offset - 内容模式下的起始偏移量，用于跳过前面的匹配项
 * @returns 包含匹配结果、统计信息及执行耗时的对象
 */
export function grep(options: GrepOptions): GrepResult {
  const startTime = Date.now();
  const searchPath = options.searchPath || process.cwd();
  const outputMode = options.outputMode || 'files_with_matches';
  const headLimit = options.headLimit ?? 200;

  let regex: RegExp;
  // 尝试构建正则表达式，如果失败则对模式进行转义后重试
  try {
    const flags = options.multiline ? 'gims' : 'gim';
    regex = new RegExp(options.pattern, flags);
  } catch (err) {
    handleError(err, {
      module: 'tools:grep',
      action: 'buildRegex',
    });
    regex = new RegExp(escapeRegex(options.pattern), 'gim');
  }

  const fileMatches: Map<string, string[]> = new Map();
  let totalMatches = 0;

  // 判断 searchPath 是文件还是目录，自动降级为单文件搜索
  try {
    const stat = fs.statSync(searchPath);
    if (stat.isFile()) {
      // 单文件搜索：直接搜索该文件，跳过 include/type 过滤
      searchFile(searchPath, regex, options, fileMatches, MAX_RESULTS);
    } else {
      searchDir(searchPath, regex, options, fileMatches, MAX_RESULTS);
    }
  } catch (err) {
    handleError(err, {
      module: 'tools:grep',
      action: 'statSearchPath',
    });
  }

  let outputLines: string[] = [];
  const matchedFiles = [...fileMatches.keys()];

  // 计算总的匹配次数
  for (const file of fileMatches.keys()) {
    totalMatches += fileMatches.get(file)!.length;
  }

  // 根据指定的输出模式格式化结果
  switch (outputMode) {
    case 'files_with_matches':
      outputLines = matchedFiles.map((f) => path.relative(searchPath, f));
      break;
    case 'count':
      for (const file of matchedFiles) {
        outputLines.push(
          `${path.relative(searchPath, file)}: ${fileMatches.get(file)!.length}`
        );
      }
      break;
    case 'content':
      for (const file of matchedFiles) {
        for (const line of fileMatches.get(file)!) {
          if (outputLines.length >= headLimit) break;
          if (options.offset && outputLines.length < options.offset) continue;
          outputLines.push(line);
        }
      }
      break;
  }

  // 确保最终输出不超过设定的行数限制
  if (outputLines.length > headLimit) {
    outputLines = outputLines.slice(0, headLimit);
  }

  return {
    matches: outputLines,
    matchCount: totalMatches,
    fileCount: matchedFiles.length,
    truncated: outputLines.length >= headLimit || totalMatches >= MAX_RESULTS,
    durationMs: Date.now() - startTime,
  };
}

/**
 * 协作式异步搜索（与 grep() 结果语义完全一致）。
 *
 * 根因修复（2026-08-31）：grep() 为纯同步递归（readdirSync/statSync/readFileSync），
 * 对大型目录（如项目根，6.5 万+ 文件）全量扫描时同步阻塞事件循环数分钟——
 * SSE 心跳/HTTP 请求全停，前端 60s/120s 无数据误判"流式响应超时"。
 * 本版本每处理 GREP_YIELD_BATCH_SIZE 个条目让出一次事件循环（对齐 TokenEstimator
 * yieldToEventLoop 协作式策略），扫描期间心跳保持，不再误判。
 */
const GREP_YIELD_BATCH_SIZE = 50;

export async function grepAsync(options: GrepOptions): Promise<GrepResult> {
  const startTime = Date.now();
  const searchPath = options.searchPath || process.cwd();
  const outputMode = options.outputMode || 'files_with_matches';
  const headLimit = options.headLimit ?? 200;

  let regex: RegExp;
  try {
    const flags = options.multiline ? 'gims' : 'gim';
    regex = new RegExp(options.pattern, flags);
  } catch (err) {
    handleError(err, {
      module: 'tools:grep',
      action: 'buildRegex',
    });
    regex = new RegExp(escapeRegex(options.pattern), 'gim');
  }

  const fileMatches: Map<string, string[]> = new Map();
  let totalMatches = 0;

  try {
    const stat = fs.statSync(searchPath);
    if (stat.isFile()) {
      searchFile(searchPath, regex, options, fileMatches, MAX_RESULTS);
    } else {
      await searchDirAsync(
        searchPath,
        regex,
        options,
        fileMatches,
        MAX_RESULTS
      );
    }
  } catch (err) {
    handleError(err, {
      module: 'tools:grep',
      action: 'statSearchPath',
    });
  }

  let outputLines: string[] = [];
  const matchedFiles = [...fileMatches.keys()];

  for (const file of fileMatches.keys()) {
    totalMatches += fileMatches.get(file)!.length;
  }

  switch (outputMode) {
    case 'files_with_matches':
      outputLines = matchedFiles.map((f) => path.relative(searchPath, f));
      break;
    case 'count':
      for (const file of matchedFiles) {
        outputLines.push(
          `${path.relative(searchPath, file)}: ${fileMatches.get(file)!.length}`
        );
      }
      break;
    case 'content':
      for (const file of matchedFiles) {
        for (const line of fileMatches.get(file)!) {
          if (outputLines.length >= headLimit) break;
          if (options.offset && outputLines.length < options.offset) continue;
          outputLines.push(line);
        }
      }
      break;
  }

  if (outputLines.length > headLimit) {
    outputLines = outputLines.slice(0, headLimit);
  }

  return {
    matches: outputLines,
    matchCount: totalMatches,
    fileCount: matchedFiles.length,
    truncated: outputLines.length >= headLimit || totalMatches >= MAX_RESULTS,
    durationMs: Date.now() - startTime,
  };
}

/**
 * 协作式递归目录搜索：每处理 GREP_YIELD_BATCH_SIZE 个条目让出一次事件循环，
 * 保证 SSE 心跳 / HTTP 请求等 I/O 在扫描大型目录期间不被长时间阻塞。
 */
async function searchDirAsync(
  dir: string,
  regex: RegExp,
  options: GrepOptions,
  results: Map<string, string[]>,
  maxTotal: number
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'EPERM') {
      logger.warn('[readdir] 目录不可读，跳过', { dir, error: String(err) });
    } else {
      handleError(err, {
        module: 'tools:grep',
        action: 'readdir',
      });
    }
    return;
  }

  let processed = 0;
  for (const entry of entries) {
    if (getTotalCount(results) >= maxTotal) return;
    if (VCS_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.name !== '.') continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await searchDirAsync(fullPath, regex, options, results, maxTotal);
    } else if (entry.isFile()) {
      if (options.include && !matchGlob(entry.name, options.include)) continue;
      searchFile(fullPath, regex, options, results, maxTotal);
    }

    // 协作式让出：每处理一批条目让出事件循环，扫描期间 SSE 心跳保持
    if (++processed % GREP_YIELD_BATCH_SIZE === 0) {
      await yieldToEventLoop();
    }
  }
}

/**
 * 递归搜索指定目录及其子目录，查找匹配正则表达式的文件内容。
 * * @param dir - 要搜索的起始目录路径
 * @param regex - 用于匹配文件内容的正则表达式
 * @param options - 搜索选项，包含文件过滤规则等配置
 * @param results - 用于存储搜索结果的双向映射，键为文件路径，值为匹配的行内容数组
 * @param maxTotal - 允许收集的最大匹配项总数，达到此限制后停止搜索
 */
function searchDir(
  dir: string,
  regex: RegExp,
  options: GrepOptions,
  results: Map<string, string[]>,
  maxTotal: number
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // K2 修复（日志排查 2026-08-13）：EPERM（Windows 上目录被其他进程占用/锁定）
    // 属可跳过噪音——行为正确（跳过该目录不中断整体搜索），仅日志级别偏高，降 warn；
    // 其余错误保持 error 级。
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'EPERM') {
      logger.warn('[readdir] 目录不可读，跳过', { dir, error: String(err) });
    } else {
      handleError(err, {
        module: 'tools:grep',
        action: 'readdir',
      });
    }
    return;
  }

  // 遍历目录下的所有条目，执行递归搜索或文件匹配
  for (const entry of entries) {
    if (getTotalCount(results) >= maxTotal) return;
    if (VCS_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.name !== '.') continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      searchDir(fullPath, regex, options, results, maxTotal);
    } else if (entry.isFile()) {
      if (options.include && !matchGlob(entry.name, options.include)) continue;
      searchFile(fullPath, regex, options, results, maxTotal);
    }
  }
}

/**
 * 在指定文件中搜索匹配正则表达式的行，并将结果存储到 results Map 中。
 * * @param filePath - 要搜索的文件路径
 * @param regex - 用于匹配的正则表达式对象
 * @param options - grep 搜索选项配置
 * @param results - 用于累积搜索结果的对象，键为文件路径，值为匹配的行内容数组
 * @param maxTotal - 允许收集的最大匹配总数，超过此数量将提前终止搜索
 */
function searchFile(
  filePath: string,
  regex: RegExp,
  options: GrepOptions,
  results: Map<string, string[]>,
  maxTotal: number
): void {
  // 如果已收集的匹配总数达到上限，则直接返回以停止进一步搜索
  if (getTotalCount(results) >= maxTotal) return;

  try {
    const stat = fs.statSync(filePath);
    // 跳过大小超过 1MB 的文件，避免处理过大文件导致性能问题
    if (stat.size > 1024 * 1024) return;
    // 2026-09-01 P1：跳过二进制文件（含 NUL 字节）——.db/.dll/.exe 等被
    // 当文本读取匹配既慢又产生误报（曾匹配到 _migration_backup\app.db）
    if (looksBinary(filePath)) return;

    const nativeRead = lazyInitNativeRead();
    let fileContent: string;
    if (nativeRead) {
      // 使用 Rust 原生模块自动检测编码（支持 UTF-8 / GBK / GB18030）
      fileContent = nativeRead(filePath);
    } else {
      // 原生模块不可用时回退到 UTF-8 读取
      fileContent = fs.readFileSync(filePath, 'utf-8');
    }

    const lines = fileContent.split('\n');
    const matches: string[] = [];

    // 逐行遍历文件内容，检查每行是否匹配正则表达式
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 重置正则表达式的 lastIndex，确保每次测试从字符串开头开始（针对全局标志位的正则）
      regex.lastIndex = 0;
      if (regex.test(line)) {
        // 根据配置决定是否在匹配结果中包含文件名和行号前缀
        if (options.showLineNumbers !== false) {
          matches.push(`${path.basename(filePath)}:${i + 1}:${line}`);
        } else {
          matches.push(line);
        }
      }
    }

    // 仅当存在匹配项时，才将结果写入 results 集合
    if (matches.length > 0) {
      results.set(filePath, matches);
    }
  } catch (err) {
    void handleError(err, { module: 'tools:GrepTool', action: 'catch_error' });
  }
}

/**
 * 二进制文件嗅探（2026-09-01 P1）：读取文件头 8KB，含 NUL 字节视为二进制。
 * 用于跳过 .db/.dll/.exe 等二进制文件，避免全项目搜索时无谓的文件读取与匹配。
 */
function looksBinary(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(8192);
      const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
      return buf.subarray(0, bytesRead).includes(0);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false; // 读取失败交给上层（searchFile catch）处理
  }
}

/**
 * 计算 Map 中所有字符串数组的元素总数。
 * * @param results - 键为字符串，值为字符串数组的 Map 对象
 * @returns 所有数组中字符串元素的总数量
 */
function getTotalCount(results: Map<string, string[]>): number {
  let total = 0;
  // 遍历 Map 中的所有值（字符串数组），累加每个数组的长度
  for (const v of results.values()) total += v.length; /**
   * 对字符串中的正则表达式特殊字符进行转义，使其可以安全地用于构建正则表达式。
   *   * @param str - 需要转义的原始字符串
   * @returns 转义后的字符串，其中所有正则表达式特殊字符前都添加了反斜杠
   */
  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return total;
}

/**
 * 对字符串中的特殊正则表达式字符进行转义，使其可以安全地用于构建正则表达式。
 * * @param str - 需要转义的原始字符串
 * @returns 转义后的字符串，其中所有正则表达式特殊字符都被反斜杠转义
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 检查文件名是否匹配给定的通配符模式。
 * * 该函数将简单的通配符模式（支持 '*' 和 '.'）转换为正则表达式进行匹配。
 * - '*' 被解释为任意字符序列（等价于正则中的 .*）
 * - '.' 被转义为字面量点号
 * 匹配过程不区分大小写。
 * * @param filename - 待匹配的文件名字符串
 * @param pattern - 通配符模式字符串，支持 '*' 作为通配符
 * @returns 如果文件名匹配模式则返回 true，否则返回 false；若正则表达式构建失败也返回 false
 */
function matchGlob(filename: string, pattern: string): boolean {
  // 将通配符模式转换为正则表达式字符串：转义点号，并将星号替换为 .*
  const regexStr = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
  try {
    return new RegExp(`^${regexStr}$`, 'i').test(filename);
  } catch (err) {
    handleError(err, {
      module: 'tools:grep',
      action: 'matchGlob',
    });
    return false;
  }
}
