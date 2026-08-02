/**
 * USER.md 读取器
 * 主要从 ConfigManager (settings.user) 读取用户身份定义，
 * 文件系统 (~/.pyapp/USER.md) 仅作为降级回退。
 * 对标 OpenClaw USER.md 工作区文件
 *
 * Phase 2.2: 存储从文件系统迁移到 ConfigManager。
 *   read: ConfigManager → 文件回退
 *   write: ConfigManager（主）+ 文件（向后兼容）
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveUserProfilePath } from '@modules/core';
import { configManager } from '@modules/config';

const USER_FILE_PATH = resolveUserProfilePath();

let cachedContent: string | null = null;
let cachedMtime: number = 0;

const DEFAULT_USER = `# USER.md — 用户身份

## 基本信息

- 称呼：用户
- 专业领域：软件开发
- 技术栈偏好：TypeScript, Rust, Python
- 工作场景：编程开发

## 沟通偏好

- 回复语言：中文
- 详细程度：平衡
`;

/**
 * 从 ConfigManager 读取 USER 内容
 * @returns 内容字符串，无数据时返回 undefined
 */
function readUserFromConfig(): string | undefined {
  try {
    const settings = configManager.getConfigValue('settings.user') as
      | { content?: string }
      | undefined;
    if (settings?.content && typeof settings.content === 'string') {
      return settings.content;
    }
  } catch {
    // ConfigManager 不可用时返回 undefined，走文件回退
  }
  return undefined;
}

/**
 * 读取 USER.md 内容
 * 优先级: ConfigManager > 文件缓存 > 文件系统 > 默认值
 * @returns USER.md 内容字符串，文件不存在时返回默认
 */
export function readUserMd(): string {
  // 优先从 ConfigManager 读取
  const configContent = readUserFromConfig();
  if (configContent !== undefined) return configContent;

  // 降级到文件系统
  try {
    const stat = fs.statSync(USER_FILE_PATH);
    if (stat.mtimeMs !== cachedMtime) {
      cachedContent = fs.readFileSync(USER_FILE_PATH, 'utf-8');
      cachedMtime = stat.mtimeMs;
    }
    return cachedContent ?? DEFAULT_USER;
  } catch {
    return DEFAULT_USER;
  }
}

/**
 * 读取用户基本信息段落
 */
export function readUserBasicInfo(): string {
  const content = readUserMd();
  const match = content.match(/## 基本信息\n\n([\s\S]*?)(?=\n## |\n$)/);
  return match ? match[1].trim() : '';
}

/**
 * 读取用户沟通偏好段落
 */
export function readUserPreferences(): string {
  const content = readUserMd();
  const match = content.match(/## 沟通偏好\n\n([\s\S]*?)(?=\n## |\n$)/);
  return match ? match[1].trim() : '';
}

/**
 * 构建 USER.md 的 system prompt 段落
 */
export function buildUserSection(): string {
  const content = readUserMd();
  return `## User Profile\n\n${content}`;
}

/**
 * 清除 USER.md 缓存
 */
export function clearUserCache(): void {
  cachedContent = null;
  cachedMtime = 0;
}

/**
 * 写入 USER.md 内容
 * 主存储: ConfigManager (settings.user.content)
 * 向后兼容: 同时写入文件系统 (~/.pyapp/USER.md)
 */
export function writeUserMd(content: string): void {
  // 主存储: ConfigManager
  try {
    configManager.setConfigValue('settings.user', { content });
  } catch {
    // ConfigManager 写入失败不阻塞（文件系统兜底）
  }

  // 向后兼容: 文件系统
  const dir = path.dirname(USER_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(USER_FILE_PATH, content, 'utf-8');
  clearUserCache();
}

/**
 * 确保 USER.md 默认内容存在
 * 检查 ConfigManager 和文件系统，都不存在时创建默认版本
 */
export function ensureDefaultUserMd(): void {
  // 先检查 ConfigManager
  const configContent = readUserFromConfig();
  if (configContent !== undefined) return;

  // 文件系统兜底
  if (!fs.existsSync(USER_FILE_PATH)) {
    writeUserMd(DEFAULT_USER);
  }
}
