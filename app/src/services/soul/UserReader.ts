/**
 * USER.md 读取器
 * 从 ~/.pyapp/USER.md 读取用户身份定义
 * 对标 OpenClaw USER.md 工作区文件
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolvePyappHome } from '@modules/config/paths';

const USER_FILE_PATH = path.join(resolvePyappHome(), 'USER.md');

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
 * 读取 USER.md 内容
 * @returns USER.md 内容字符串，文件不存在时返回默认
 */
export function readUserMd(): string {
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
 */
export function writeUserMd(content: string): void {
  const dir = path.dirname(USER_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(USER_FILE_PATH, content, 'utf-8');
  clearUserCache();
}

/**
 * 确保 USER.md 文件存在，不存在则创建默认版本
 */
export function ensureDefaultUserMd(): void {
  if (!fs.existsSync(USER_FILE_PATH)) {
    writeUserMd(DEFAULT_USER);
  }
}
