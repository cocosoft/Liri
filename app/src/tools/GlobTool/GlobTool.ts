/**
 * GlobTool - glob文件模式匹配
 */
import * as fs from 'fs';
import * as path from 'path';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'tools:GlobTool:GlobTool', level: LogLevel.INFO });

export interface GlobResult {
  durationMs: number;
  numFiles: number;
  filenames: string[];
  truncated: boolean;
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

  // 执行目录遍历并收集匹配文件，若发生错误（如权限拒绝）则静默处理
  try {
    walkDir(
      normalizedSearchPath,
      normalizedPattern,
      results,
      MAX_FILES,
      normalizedSearchPath
    );
  } catch (err) {

    // 权限拒绝时返回空

    logger.debug("Operation skipped", { context: "权限拒绝时返回空", error: err instanceof Error ? err.message : String(err) });

  }

  const durationMs = Date.now() - startTime;
  const truncated = results.length >= MAX_FILES;

  return {
    durationMs,
    numFiles: results.length,
    filenames: results.slice(0, MAX_FILES),
    truncated,
  };
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
  } catch {
    // 如果读取目录失败（如权限不足或目录不存在），则静默返回
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
      // 如果是文件，则依次检查：文件名、完整路径、相对路径是否匹配模式
      const relativePath = rootDir
        ? path.relative(rootDir, fullPath).replace(/\\/g, '/')
        : '';
      if (
        matchGlob(entry.name, pattern) ||
        matchGlob(fullPath, pattern) ||
        (relativePath && matchGlob(relativePath, pattern))
      ) {
        results.push(fullPath);
      }
    }
  }
}

/**
 * 检查文件名或路径是否匹配给定的 glob 模式。
 * * 支持以下通配符：
 * - `*`: 匹配任意非路径分隔符字符（不包括 `/` 和 `\`）
 * - `**`: 匹配任意字符（包括路径分隔符）
 * - `?`: 匹配单个任意字符
 *
 * 路径中的反斜杠会被自动转换为斜杠，确保 Windows 路径也能正确匹配。
 * * @param name - 要检查的文件名或路径字符串
 * @param pattern - glob 模式字符串
 * @returns 如果名称匹配模式则返回 true，否则返回 false
 */
function matchGlob(name: string, pattern: string): boolean {
  // 特殊处理：如果模式为单个星号，则匹配所有名称
  if (pattern === '*') return true;

  // 将路径中的反斜杠统一为斜杠，确保跨平台路径匹配一致性
  const normalizedName = name.replace(/\\/g, '/');

  // 将 glob 模式转换为正则表达式字符串
  // 1. 转义字面量点号
  // 2. 临时替换 ** 为占位符，避免被单星号逻辑干扰
  // 3. 将单星号 * 替换为匹配非路径分隔符的字符类
  // 4. 将占位符恢复为匹配任意字符的 .*
  // 5. 将问号 ? 替换为匹配单个字符的 .
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '@@DOUBLE_STAR@@')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(/@@DOUBLE_STAR@@/g, '.*')
    .replace(/\?/g, '.');

  try {
    // 构建不区分大小写的正则表达式，并尝试匹配完整路径或仅文件名
    const regex = new RegExp(`^${regexStr}$`, 'i');
    const basename = path.basename(normalizedName);
    return regex.test(basename) || regex.test(normalizedName);
  } catch {
    // 如果正则表达式构建失败（例如非法模式），回退到简单的包含检查
    // 移除模式中的所有星号后，检查剩余部分是否包含在名称中
    return normalizedName.includes(pattern.replace(/\*/g, ''));
  }
}
