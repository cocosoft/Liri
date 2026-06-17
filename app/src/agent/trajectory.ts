/**
 * 对话轨迹记录器
 * 对标 Hermes agent/trajectory.py
 * 以 JSONL 格式保存完整对话轨迹
 */

import { appendFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { resolvePyappHome } from '@modules/core/paths';
import { configManager } from '@modules/config';

const logger = new Logger({ level: LogLevel.INFO });

const DEFAULT_TRAJECTORY_DIR = join(resolvePyappHome(), 'trajectories');

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  timestamp?: number;
}

export interface TrajectoryEntry {
  conversations: ConversationMessage[];
  timestamp: string;
  model: string;
  completed: boolean;
  sessionId?: string;
  turnCount?: number;
  totalTokens?: number;
  durationMs?: number;
}

/**
 * 将 <REASONING_SCRATCHPAD> 标签转换 <think> 标签
 * 对标 Hermes convert_scratchpad_to_think()
 * @param content 原始内容
 * @returns 转换后的内容
 */
export function convertScratchpadToThink(content: string): string {
  if (!content || !content.includes('<REASONING_SCRATCHPAD>')) {
    return content;
  }
  return content
    .replace(/<REASONING_SCRATCHPAD>/g, '<think>')
    .replace(/<\/REASONING_SCRATCHPAD>/g, '</think>');
}

/**
 * 检查是否有未闭合的 scratchpad 标签
 * 对标 Hermes has_incomplete_scratchpad()
 * @param content 内容
 * @returns 是否存在未闭合标签
 */
export function hasIncompleteScratchpad(content: string): boolean {
  if (!content) return false;
  const opens = (content.match(/<REASONING_SCRATCHPAD>/g) || []).length;
  const closes = (content.match(/<\/REASONING_SCRATCHPAD>/g) || []).length;
  return opens > closes;
}

/**
 * 获取默认轨迹目录
 */
function getTrajectoryDir(): string {
  const dir =
    configManager.env('Liri_TRAJECTORY_DIR') || DEFAULT_TRAJECTORY_DIR;
  if (!existsSync(dir)) {
    try {
      const { mkdirSync } = require('fs');
      mkdirSync(dir, { recursive: true });
    } catch {
      // 目录创建失败时使用临时目录
      return join(resolvePyappHome());
    }
  }
  return dir;
}

/**
 * 保存完整对话轨迹到 JSONL 文件
 * @param trajectory 轨迹条目
 * @param filename 文件名（可选，默认根据完成状态命名）
 */
export async function saveTrajectory(
  trajectory: TrajectoryEntry,
  filename?: string
): Promise<void> {
  const dir = getTrajectoryDir();

  if (!filename) {
    filename = trajectory.completed
      ? 'trajectory_samples.jsonl'
      : 'failed_trajectories.jsonl';
  }

  const filepath = join(dir, filename);

  try {
    const entry = {
      conversations: trajectory.conversations,
      timestamp: trajectory.timestamp || new Date().toISOString(),
      model: trajectory.model,
      completed: trajectory.completed,
      ...(trajectory.sessionId && { session_id: trajectory.sessionId }),
      ...(trajectory.turnCount && { turn_count: trajectory.turnCount }),
      ...(trajectory.totalTokens && { total_tokens: trajectory.totalTokens }),
      ...(trajectory.durationMs && { duration_ms: trajectory.durationMs }),
    };

    const line = JSON.stringify(entry) + '\n';
    await appendFile(filepath, line, 'utf-8');

    logger.info('Trajectory saved', {
      file: filename,
      completed: trajectory.completed,
      messages: trajectory.conversations.length,
    });
  } catch (error) {
    logger.error('Failed to save trajectory', {
      error: error instanceof Error ? error : new Error(String(error)),
      file: filename,
    });
  }
}

/**
 * 将对话消息列表转换为轨迹格式
 * @param messages 消息列表
 * @param model 模型名
 * @param completed 是否完成
 * @param metadata 附加元数据
 * @returns 轨迹条目
 */
export function messagesToTrajectory(
  messages: ConversationMessage[],
  model: string,
  completed: boolean,
  metadata?: {
    sessionId?: string;
    turnCount?: number;
    totalTokens?: number;
    durationMs?: number;
  }
): TrajectoryEntry {
  return {
    conversations: messages.map((m) => ({
      role: m.role,
      content: convertScratchpadToThink(m.content),
      ...(m.name && { name: m.name }),
      ...(m.toolCallId && { tool_call_id: m.toolCallId }),
    })),
    timestamp: new Date().toISOString(),
    model,
    completed,
    ...(metadata?.sessionId && { sessionId: metadata.sessionId }),
    ...(metadata?.turnCount && { turnCount: metadata.turnCount }),
    ...(metadata?.totalTokens && { totalTokens: metadata.totalTokens }),
    ...(metadata?.durationMs && { durationMs: metadata.durationMs }),
  };
}
