/**
 * 路径限制工具
 * 实现路径验证和访问控制
 */
import * as path from 'path';
import * as os from 'os';

/**
 * 路径类型
 */
export type PathType = 'allowed' | 'denied' | 'neutral';

/**
 * 路径检查结果
 */
export interface PathCheckResult {
  allowed: boolean;
  reason?: string;
  pathType: PathType;
  matchedPattern?: string;
}

/**
 * 规范化路径
 * @param inputPath 输入路径
 * @returns 规范化后的路径
 */
export function normalizePath(inputPath: string): string {
  let normalized = inputPath.trim();

  normalized = normalized.replace(/^~\//, os.homedir() + '/');

  normalized = path.normalize(normalized);

  if (!path.isAbsolute(normalized)) {
    normalized = path.resolve(normalized);
  }

  return normalized;
}

/**
 * 检查路径是否匹配模式
 * @param targetPath 目标路径
 * @param pattern 模式（支持*通配符）
 * @returns 是否匹配
 */
export function matchPathPattern(targetPath: string, pattern: string): boolean {
  const normalizedTarget = normalizePath(targetPath);
  const normalizedPattern = normalizePath(pattern);

  if (normalizedPattern.endsWith('*')) {
    const prefix = normalizedPattern.slice(0, -1);
    return (
      normalizedTarget.startsWith(prefix) ||
      normalizedTarget === prefix.slice(0, -1)
    );
  }

  if (normalizedPattern.includes('*')) {
    const regex = new RegExp(
      '^' + normalizedPattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return regex.test(normalizedTarget);
  }

  if (normalizedPattern === normalizedTarget) {
    return true;
  }

  const normalizedPatternDir = normalizedPattern + path.sep;
  return normalizedTarget.startsWith(normalizedPatternDir);
}

/**
 * 检查路径是否在指定目录下
 * @param targetPath 目标路径
 * @param directory 目录
 * @returns 是否在目录下
 */
export function isPathInsideDirectory(
  targetPath: string,
  directory: string
): boolean {
  const normalizedTarget = normalizePath(targetPath);
  const normalizedDir = normalizePath(directory);

  const normalizedDirWithSep = normalizedDir.endsWith(path.sep)
    ? normalizedDir
    : normalizedDir + path.sep;

  return normalizedTarget.startsWith(normalizedDirWithSep);
}

/**
 * 检查路径访问权限
 * @param targetPath 目标路径
 * @param allowedPaths 允许的路径列表
 * @param deniedPaths 拒绝的路径列表
 * @returns 检查结果
 */
export function checkPathAccess(
  targetPath: string,
  allowedPaths: string[] = [],
  deniedPaths: string[] = []
): PathCheckResult {
  const normalizedTarget = normalizePath(targetPath);

  for (const pattern of deniedPaths) {
    if (matchPathPattern(normalizedTarget, pattern)) {
      return {
        allowed: false,
        reason: `路径匹配拒绝模式: ${pattern}`,
        pathType: 'denied',
        matchedPattern: pattern,
      };
    }
  }

  if (allowedPaths.length > 0) {
    for (const pattern of allowedPaths) {
      if (matchPathPattern(normalizedTarget, pattern)) {
        return {
          allowed: true,
          reason: `路径匹配允许模式: ${pattern}`,
          pathType: 'allowed',
          matchedPattern: pattern,
        };
      }
    }

    return {
      allowed: false,
      reason: '路径不在允许列表中',
      pathType: 'neutral',
    };
  }

  return {
    allowed: true,
    reason: '无限制',
    pathType: 'neutral',
  };
}

/**
 * 检查读取路径权限
 * @param targetPath 目标路径
 * @param config 沙箱文件系统配置
 * @returns 检查结果
 */
export function checkReadPathAccess(
  targetPath: string,
  config: {
    allowRead?: string[];
    denyRead?: string[];
    allowManagedReadPathsOnly?: boolean;
  } = {}
): PathCheckResult {
  const { allowRead = [], denyRead = [], allowManagedReadPathsOnly } = config;

  const normalizedTarget = normalizePath(targetPath);

  for (const pattern of denyRead) {
    if (matchPathPattern(normalizedTarget, pattern)) {
      if (allowRead.some((p) => matchPathPattern(normalizedTarget, p))) {
        return {
          allowed: true,
          reason: `路径在拒绝列表中但匹配允许模式: ${pattern}`,
          pathType: 'allowed',
        };
      }

      return {
        allowed: false,
        reason: `路径匹配拒绝读取模式: ${pattern}`,
        pathType: 'denied',
        matchedPattern: pattern,
      };
    }
  }

  if (allowRead.length > 0) {
    for (const pattern of allowRead) {
      if (matchPathPattern(normalizedTarget, pattern)) {
        return {
          allowed: true,
          reason: `路径匹配允许读取模式: ${pattern}`,
          pathType: 'allowed',
          matchedPattern: pattern,
        };
      }
    }

    if (!allowManagedReadPathsOnly) {
      return {
        allowed: false,
        reason: '路径不在允许读取列表中',
        pathType: 'neutral',
      };
    }
  }

  return {
    allowed: true,
    reason: '无限制',
    pathType: 'neutral',
  };
}

/**
 * 检查写入路径权限
 * @param targetPath 目标路径
 * @param config 沙箱文件系统配置
 * @returns 检查结果
 */
export function checkWritePathAccess(
  targetPath: string,
  config: {
    allowWrite?: string[];
    denyWrite?: string[];
  } = {}
): PathCheckResult {
  const { allowWrite = [], denyWrite = [] } = config;

  const normalizedTarget = normalizePath(targetPath);

  for (const pattern of denyWrite) {
    if (matchPathPattern(normalizedTarget, pattern)) {
      return {
        allowed: false,
        reason: `路径匹配拒绝写入模式: ${pattern}`,
        pathType: 'denied',
        matchedPattern: pattern,
      };
    }
  }

  if (allowWrite.length > 0) {
    for (const pattern of allowWrite) {
      if (matchPathPattern(normalizedTarget, pattern)) {
        return {
          allowed: true,
          reason: `路径匹配允许写入模式: ${pattern}`,
          pathType: 'allowed',
          matchedPattern: pattern,
        };
      }
    }

    return {
      allowed: false,
      reason: '路径不在允许写入列表中',
      pathType: 'neutral',
    };
  }

  return {
    allowed: true,
    reason: '无限制',
    pathType: 'neutral',
  };
}

/**
 * 敏感系统目录列表
 */
const SENSITIVE_DIRECTORIES = [
  '/etc',
  '/sys',
  '/proc',
  '/usr/bin',
  '/usr/sbin',
  '/bin',
  '/sbin',
  '/var',
  '/boot',
  '/lib',
  '/lib64',
  '/root',
  '/home',
];

/**
 * 验证路径是否安全
 * @param targetPath 目标路径
 * @param baseDirectory 基础目录
 * @returns 是否安全
 */
export function validatePathSafety(
  targetPath: string,
  baseDirectory: string
): { safe: boolean; reason?: string } {
  const normalized = normalizePath(targetPath);

  if (normalized === '/') {
    return { safe: false, reason: '禁止访问根目录' };
  }

  if (normalized.includes('..')) {
    return { safe: false, reason: '禁止使用路径遍历' };
  }

  for (const sensitiveDir of SENSITIVE_DIRECTORIES) {
    if (normalized.startsWith(sensitiveDir)) {
      if (
        (sensitiveDir === '/etc' && 
         (normalized.startsWith('/etc/passwd') || 
          normalized.startsWith('/etc/group')))
      ) {
        continue;
      }
      return { safe: false, reason: `禁止访问系统敏感目录: ${sensitiveDir}` };
    }
  }

  const normalizedBase = normalizePath(baseDirectory);
  if (!isPathInsideDirectory(normalized, normalizedBase)) {
    return { safe: false, reason: `路径不在基础目录 ${baseDirectory} 内` };
  }

  return { safe: true };
}
