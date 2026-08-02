/**
 * SOUL.md 读取器
 * 主要从 ConfigManager (settings.soul) 读取 AI 人格定义，
 * 文件系统 (~/.pyapp/SOUL.md) 仅作为降级回退。
 * 对标 OpenClaw SOUL.md 体系
 *
 * Phase 2.2: 存储从文件系统迁移到 ConfigManager。
 *   read: ConfigManager → 文件回退
 *   write: ConfigManager（主）+ 文件（向后兼容）
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveSoulPath } from '@modules/core';
import { configManager } from '@modules/config';

const SOUL_FILE_PATH = resolveSoulPath();

let cachedContent: string | null = null;
let cachedMtime: number = 0;

const DEFAULT_SOUL = `# SOUL.md — Liri 的人格

## 核心信念

- 你是 Liri，一个有主见的 AI 私人助手
- 你有自己的观点——可以不同意、有偏好、觉得有趣或无聊
- 先尝试再问——自己读文件、查上下文、搜资料
- 凭能力赢得信任——外部操作小心，内部操作大胆
- 记住你是客人——用户给了系统访问权限，尊重隐私

## 主动性

- **有始有终** —— 任务做完后主动说一声结果,不等用户问"好了没"
- **进度感知** —— 长任务中途每 30 秒报一次进度,连续 3 次以上工具调用且无用户可见输出时主动说明当前状态

## 边界

- 用户的数据就是用户的数据。结果说清楚，但数据留在用户本地
- 涉及外部操作（发消息、发邮件、网络请求）时，先征求确认
- 不要未经用户同意修改用户的个人文件

## 语气

简洁、准确、友好。
- 日常对话：轻松但专业
- 代码任务：直接，用代码说话
- 分析任务：结构化，有证据
- 出错时：诚实，不推诿，给解决方案
`;

/**
 * 从 ConfigManager 读取 SOUL 内容
 * @returns 内容字符串，无数据时返回 undefined
 */
function readSoulFromConfig(): string | undefined {
  try {
    const settings = configManager.getConfigValue('settings.soul') as
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
 * 读取 SOUL.md 内容
 * 优先级: ConfigManager > 文件缓存 > 文件系统 > 默认值
 * @returns SOUL.md 内容字符串
 */
export function readSoulMd(): string {
  // 优先从 ConfigManager 读取
  const configContent = readSoulFromConfig();
  if (configContent !== undefined) return configContent;

  // 降级到文件系统
  try {
    const stat = fs.statSync(SOUL_FILE_PATH);
    if (stat.mtimeMs !== cachedMtime) {
      cachedContent = fs.readFileSync(SOUL_FILE_PATH, 'utf-8');
      cachedMtime = stat.mtimeMs;
    }
    return cachedContent ?? DEFAULT_SOUL;
  } catch {
    return DEFAULT_SOUL;
  }
}

/**
 * 读取 SOUL.md 的核心信念段落
 */
export function readCoreTruths(): string {
  const content = readSoulMd();
  const match = content.match(/## 核心信念\n\n([\s\S]*?)(?=\n## |\n$)/);
  return match ? match[1].trim() : '';
}

/**
 * 读取 SOUL.md 的边界段落
 */
export function readBoundaries(): string {
  const content = readSoulMd();
  const match = content.match(/## 边界\n\n([\s\S]*?)(?=\n## |\n$)/);
  return match ? match[1].trim() : '';
}

/**
 * 读取 SOUL.md 的语气段落
 */
export function readVibe(): string {
  const content = readSoulMd();
  const match = content.match(/## 语气\n\n([\s\S]*?)(?=\n## |\n$)/);
  return match ? match[1].trim() : '';
}

/**
 * 读取完整 SOUL.md 并格式化为 system prompt 段落
 */
export function buildSoulSection(): string {
  const content = readSoulMd();

  if (content === DEFAULT_SOUL) {
    const truths = readCoreTruths();
    const boundaries = readBoundaries();
    const vibe = readVibe();
    const parts: string[] = ['## Personality'];

    if (truths) {
      parts.push('');
      parts.push('### Core Beliefs');
      parts.push(truths);
    }
    if (boundaries) {
      parts.push('');
      parts.push('### Boundaries');
      parts.push(boundaries);
    }
    if (vibe) {
      parts.push('');
      parts.push('### Tone & Style');
      parts.push(vibe);
    }

    return parts.join('\n');
  }

  return `## Personality\n\n${content}`;
}

/**
 * 清除 SOUL.md 缓存
 */
export function clearSoulCache(): void {
  cachedContent = null;
  cachedMtime = 0;
}

/**
 * 写入 SOUL.md 内容
 * 主存储: ConfigManager (settings.soul.content)
 * 向后兼容: 同时写入文件系统 (~/.pyapp/SOUL.md)
 */
export function writeSoulMd(content: string): void {
  // 主存储: ConfigManager
  try {
    configManager.setConfigValue('settings.soul', { content });
  } catch {
    // ConfigManager 写入失败不阻塞（文件系统兜底）
  }

  // 向后兼容: 文件系统
  const dir = path.dirname(SOUL_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(SOUL_FILE_PATH, content, 'utf-8');
  clearSoulCache();
}

/**
 * 确保 SOUL.md 默认内容存在
 * 检查 ConfigManager 和文件系统，都不存在时创建默认版本
 */
export function ensureDefaultSoulMd(): void {
  // 先检查 ConfigManager
  const configContent = readSoulFromConfig();
  if (configContent !== undefined) return;

  // 文件系统兜底
  if (!fs.existsSync(SOUL_FILE_PATH)) {
    writeSoulMd(DEFAULT_SOUL);
  }
}
