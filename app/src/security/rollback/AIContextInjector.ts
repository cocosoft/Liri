// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, modify, copy, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit us to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * AI 上下文注入器
 *
 * 负责在 AI 请求上下文中注入回滚相关的信息，使 AI 能够：
 *   1. 了解当前对话中已经发生的文件变更
 *   2. 告知用户可用的撤消操作
 *   3. 在合适的时机建议用户执行撤消
 *
 * 对应方案文档 §8 的 AI 上下文注入设计。
 * InjectStrategy 类型定义见 types.ts。
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { loadSnapshot, listSessionSnapshots } from './SnapshotStorage';
import { findDependentRounds } from './UndoManager';
import type { RoundSnapshot, InjectStrategy } from './types';

const logger = new Logger({ module: 'AIContextInjector' });

/** 注入上下文的缓存（避免重复生成） */
interface InjectionCache {
  sessionId: string;
  maxRounds: number;
  lastUpdated: string;
  context: string;
}

/**
 * 生成回滚上下文信息
 *
 * 基于当前会话的快照列表生成一段结构化的上下文文本，
 * 供注入到 AI 的 system prompt 或 user message 中。
 *
 * @param sessionId 当前会话 ID
 * @param maxRounds 最多包含的轮次数（默认 3 轮）
 * @returns 上下文文本
 */
export async function generateUndoContext(
  sessionId: string,
  maxRounds: number = 3
): Promise<string> {
  const snapshots = await listSessionSnapshots(sessionId).catch((err) => {
    logger.warn('获取快照列表失败', { sessionId, error: String(err) });
    handleError(err, {
      module: 'AIContextInjector',
      action: 'generateUndoContext:listSessionSnapshots',
    }).catch(() => {});
    return [];
  });

  if (snapshots.length === 0) {
    return '';
  }

  logger.debug('生成回滚上下文', {
    sessionId,
    snapshotCount: snapshots.length,
    maxRounds,
  });

  // 只取最近的 N 轮
  const recent = snapshots.slice(0, maxRounds);

  const parts: string[] = [
    '以下是最新的文件操作记录，用户可能希望撤消其中某些操作：',
    '',
  ];

  for (const snap of recent) {
    parts.push(`  R${snap.roundId} — ${snap.userMessageSummary || '(无描述)'}`);
    parts.push(`    变更文件: ${snap.changedFiles.length} 个`);

    // 按类型分组
    const created = snap.changedFiles.filter(
      (c) => c.type === 'created'
    ).length;
    const modified = snap.changedFiles.filter(
      (c) => c.type === 'modified'
    ).length;
    const deleted = snap.changedFiles.filter(
      (c) => c.type === 'deleted'
    ).length;
    const renamed = snap.changedFiles.filter(
      (c) => c.type === 'renamed' || c.type === 'moved'
    ).length;

    const detailParts: string[] = [];
    if (created > 0) detailParts.push(`新建 ${created} 个`);
    if (modified > 0) detailParts.push(`修改 ${modified} 个`);
    if (deleted > 0) detailParts.push(`删除 ${deleted} 个`);
    if (renamed > 0) detailParts.push(`重命名/移动 ${renamed} 个`);

    parts.push(`    操作摘要: ${detailParts.join(', ')}`);

    // 检测是否有级联依赖
    const dependents = await findDependentRounds(sessionId, snap.roundId).catch(
      (err) => {
        logger.warn('检测级联依赖失败', {
          sessionId,
          roundId: snap.roundId,
          error: String(err),
        });
        return [];
      }
    );
    if (dependents.length > 0) {
      parts.push(
        `    ⚠️ 撤消此轮将同时影响后续 ${dependents.length} 轮（R${dependents.join(', R')}）`
      );
    }

    parts.push('');
  }

  logger.info('回滚上下文已生成', { sessionId, roundCount: recent.length });

  parts.push('你可以询问用户是否需要撤消以上任意一轮操作。');
  parts.push('撤消操作会还原文件到 AI 操作前的状态。');

  return parts.join('\n');
}

/**
 * 为指定轮次生成详细的撤消预览上下文
 *
 * 当用户表达撤消意图后，生成更详细的上下文让 AI 了解撤消的影响范围。
 *
 * @param sessionId 会话 ID
 * @param roundId 目标轮次
 * @returns 详细上下文文本
 */
export async function generateDetailedUndoContext(
  sessionId: string,
  roundId: number
): Promise<string> {
  const snapshot = await loadSnapshot(sessionId, roundId);

  if (!snapshot) {
    logger.warn('生成撤消预览上下文：快照不存在', { sessionId, roundId });
    return '';
  }

  logger.debug('生成撤消预览上下文', {
    sessionId,
    roundId,
    changedFiles: snapshot.changedFiles.length,
  });

  const parts: string[] = [
    `===== 撤消预览 R${roundId} =====`,
    `用户消息: ${snapshot.userMessageSummary || '(无描述)'}`,
    `变更文件总数: ${snapshot.changedFiles.length}`,
    '',
    '受影响文件列表:',
  ];

  for (const change of snapshot.changedFiles) {
    const filePath = change.path;
    switch (change.type) {
      case 'created':
        parts.push(`  [新建] ${filePath} — 撤消将删除此文件`);
        break;
      case 'deleted':
        parts.push(`  [删除] ${filePath} — 撤消将恢复此文件`);
        break;
      case 'modified':
        parts.push(`  [修改] ${filePath} — 撤消将还原到操作前版本`);
        break;
      case 'renamed':
        parts.push(
          `  [重命名] ${change.oldPath} → ${change.newPath} — 撤消将移回 ${change.oldPath}`
        );
        break;
      case 'moved':
        parts.push(
          `  [移动] ${change.oldPath} → ${change.newPath} — 撤消将移回 ${change.oldPath}`
        );
        break;
    }
  }

  // 级联撤消提示
  const dependents = await findDependentRounds(sessionId, roundId);
  if (dependents.length > 0) {
    parts.push('');
    parts.push(
      `⚠️ 撤消 R${roundId} 将级联影响后续 R${dependents.join(', R')}，因为它们操作了相同文件。`
    );
  }

  parts.push('');
  parts.push('==============================');

  return parts.join('\n');
}

/**
 * 判断是否需要注入回滚上下文
 *
 * 基于当前会话的快照状态决定是否需要在 AI 上下文中注入回滚信息。
 *
 * @param sessionId 会话 ID
 * @returns 是否需要注入
 */
export async function shouldInjectContext(sessionId: string): Promise<boolean> {
  const snapshots = await listSessionSnapshots(sessionId).catch((err) => {
    logger.warn('shouldInjectContext：获取快照列表失败', {
      sessionId,
      error: String(err),
    });
    return [];
  });

  // 有快照且最近的一轮不是 rolled_back 状态
  if (snapshots.length === 0) return false;

  const latest = snapshots[0];
  const shouldInject =
    latest.status !== 'rolled_back' && latest.changedFiles.length > 0;

  logger.debug('回滚上下文注入判断', {
    sessionId,
    shouldInject,
    latestRoundId: latest.roundId,
    latestStatus: latest.status,
  });

  return shouldInject;
}
