/**
 * MemoryDreamService — 梦境记忆精炼管道
 * MIT License
 *
 * 管线的职责：
 * 1. 内部 Dream：按类型分组已有记忆，调用 LLM 做同类合并精炼
 * 2. 知识回写：扫描知识库（AutoDream 输出的 .md 文件），将其回写记忆系统
 *
 * 后者是"梦境机制产生的数据进入记忆系统"的关键桥接。
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { providerRegistry, modelRouter } from '@modules/ai';
import { ToolAwareClient } from '@modules/ai';
import { resolvePyappHome } from '@modules/core';
import { join } from 'path';
import {
  readdirSync,
  readFileSync,
  existsSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from 'fs';
import { createMemoryMetadata } from '../types/MemoryMetadata';
import type { MemoryManagerImpl } from '../MemoryManager';

const logger = getLogger('memory:dream');

export interface DreamResult {
  groupsProcessed: number;
  originalCount: number;
  refinedCount: number;
  knowledgeSynced: number;
  details: Array<{
    type: string;
    original: number;
    refined: number;
    mergedPairs: number;
  }>;
}

const MAX_MEMORIES_PER_DREAM = 50;

/**
 * 从 LLM 输出中提取精炼结果 JSON 数组。
 * 优先贪婪匹配整个数组；解析失败时尝试截断修复（LLM 输出可能被截断、
 * 或在数组尾追加解释文字/标点），仍失败返回 null（调用方降级保留原记忆）。
 */
function extractRefineResult(
  content: string
): Array<{ content: string; tags?: string[] }> | null {
  const candidates: string[] = [];
  const greedy = content.match(/\[[\s\S]*\]/);
  if (greedy) candidates.push(greedy[0]);
  // 截断修复：取最后一个 } 之前的内容并补全数组闭合符
  const lastBrace = content.lastIndexOf('}');
  if (lastBrace > -1) {
    const cut = content.slice(0, lastBrace + 1);
    const openIdx = cut.indexOf('[');
    if (openIdx > -1) {
      candidates.push(`${cut.slice(openIdx)}]`);
    }
  }
  for (const cand of candidates) {
    try {
      const parsed = JSON.parse(cand);
      if (Array.isArray(parsed))
        return parsed as Array<{ content: string; tags?: string[] }>;
    } catch {
      /* 尝试下一个候选 */
    }
  }
  return null;
}

function getLastSyncFilePath(): string {
  return join(resolvePyappHome(), 'data', '.memory_dream_last_sync');
}

function getLastSyncTime(): number {
  try {
    const path = getLastSyncFilePath();
    if (existsSync(path)) {
      return parseInt(readFileSync(path, 'utf-8').trim(), 10) || 0;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

function saveLastSyncTime(): void {
  const path = getLastSyncFilePath();
  const dir = join(resolvePyappHome(), 'data');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, String(Date.now()), 'utf-8');
}

function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const fm: Record<string, unknown> = {};
  const yamlLines = match[1].split('\n');
  for (const line of yamlLines) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1];
    let value: unknown = kv[2].trim();
    if (
      typeof value === 'string' &&
      value.startsWith('"') &&
      value.endsWith('"')
    ) {
      value = value.slice(1, -1);
    }
    if (
      typeof value === 'string' &&
      value.startsWith('[') &&
      value.endsWith(']')
    ) {
      try {
        value = JSON.parse(value);
      } catch {
        /* keep as string */
      }
    }
    fm[key] = value;
  }
  return { frontmatter: fm, body: match[2].trim() };
}

function mapKnowledgeType(type?: unknown): string {
  const t = String(type || '').toLowerCase();
  const map: Record<string, string> = {
    project: 'project_knowledge',
    user: 'user_fact',
    preference: 'user_preference',
    system: 'code_pattern',
    decision: 'decision',
    knowledge: 'decision',
  };
  return map[t] || 'decision';
}

/**
 * 扫描知识库目录，回写新的 .md 文件到记忆系统
 */
async function syncKnowledgeFiles(
  memoryManager: MemoryManagerImpl
): Promise<number> {
  const knowledgeDir = join(resolvePyappHome(), 'knowledge');
  if (!existsSync(knowledgeDir)) return 0;

  const lastSync = getLastSyncTime();
  const files = readdirSync(knowledgeDir).filter(
    (f) => f.endsWith('.md') && f !== 'index.md'
  );

  let syncedCount = 0;
  for (const file of files) {
    const filePath = join(knowledgeDir, file);
    try {
      const stat = statSync(filePath);
      if (stat.mtimeMs <= lastSync) continue;

      const content = readFileSync(filePath, 'utf-8');
      const { frontmatter, body } = parseFrontmatter(content);

      const title = (frontmatter.title as string) || file.replace(/\.md$/, '');
      const tags = (frontmatter.tags as string[]) || [];
      const type = mapKnowledgeType(frontmatter.type || frontmatter.category);

      if (body.trim().length < 10) continue;

      await memoryManager.createMemory({
        content: body.trim(),
        metadata: createMemoryMetadata({
          name: `\u{1F4C4} ${title}`,
          type,
          tags: Array.isArray(tags) ? tags : [String(tags)],
          priority: 15,
        }),
      });

      syncedCount++;
      logger.info('知识文件回写记忆', { file, type, title });
    } catch (err) {
      logger.warn('知识文件回写失败', { file, error: (err as Error).message });
    }
  }

  if (syncedCount > 0) {
    saveLastSyncTime();
    await memoryManager.buildMemoryIndex();
  }

  return syncedCount;
}

function buildDreamPrompt(
  typeName: string,
  memories: Array<{ id: string; content: string; tags: string[] }>
): string {
  const memoryList = memories
    .map(
      (m, i) =>
        `[${i}] ${m.content}${m.tags.length ? ` (标签: ${m.tags.join(', ')})` : ''}`
    )
    .join('\n');

  return `你是一个记忆系统精炼器。请审视以下${typeName}类型的记忆条目，完成合并和精炼：

## 规则
1. 合并表达同一事实的重复条目
2. 对相近偏好做归纳
3. 保留重要细节，删除冗余
4. 输出 JSON 数组，每项含 content 和 tags

## 原始记忆
${memoryList}

## 输出
只输出 JSON 数组：[{"content": "精炼记忆", "tags": ["tag1"]}]`;
}

export async function runMemoryDream(
  memoryManager: MemoryManagerImpl,
  opts?: { maxMemories?: number; skipKnowledgeSync?: boolean }
): Promise<DreamResult> {
  let knowledgeSynced = 0;
  const details: DreamResult['details'] = [];

  // Phase 1: 知识文件回写（AutoDream 产物 → 记忆系统）
  if (!opts?.skipKnowledgeSync) {
    knowledgeSynced = await syncKnowledgeFiles(memoryManager);
    logger.info('知识文件同步完成', { count: knowledgeSynced });
  }

  // Phase 2: 内部 LLM 精炼
  const maxMemories = opts?.maxMemories || MAX_MEMORIES_PER_DREAM;
  const allMemories = await memoryManager.getAllMemories();

  if (allMemories.length < 2) {
    return {
      groupsProcessed: 0,
      originalCount: 0,
      refinedCount: 0,
      knowledgeSynced,
      details: [],
    };
  }

  const groups = new Map<string, typeof allMemories>();
  for (const m of allMemories) {
    const type = m.metadata?.type || 'unknown';
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type)!.push(m);
  }

  // 精炼模型显式通过模型路由解析（DB 唯一事实来源），并匹配对应 provider，
  // 避免回退默认 provider 的不可控默认模型（曾导致 Kimi-K2.6 调 SiliconFlow 端点 400）
  const refineModel = await modelRouter.resolveAsync('quick');
  const provider =
    (refineModel && providerRegistry.getByModel(refineModel)) ||
    providerRegistry.getDefaultProvider();
  if (!provider) {
    logger.warn('MemoryDream: 无可用 AI Provider');
    return {
      groupsProcessed: 0,
      originalCount: 0,
      refinedCount: 0,
      knowledgeSynced,
      details: [],
    };
  }

  const client = new ToolAwareClient(provider, null, null);
  let totalOriginal = 0;
  let totalRefined = 0;

  const typeNameMap: Record<string, string> = {
    user_fact: '用户身份',
    user_preference: '用户偏好',
    project_knowledge: '项目上下文',
    code_pattern: '系统指令',
    decision: '知识库',
  };

  for (const [type, memories] of groups) {
    if (memories.length < 2) continue;
    const batch = memories.slice(0, maxMemories);
    totalOriginal += batch.length;
    const typeName = typeNameMap[type] || type;

    try {
      const response = await client.sendMessage(
        [
          {
            role: 'user',
            content: buildDreamPrompt(
              typeName,
              batch.map((m) => ({
                id: m.id,
                content: m.content,
                tags: m.metadata?.tags || [],
              }))
            ),
          },
        ],
        { model: refineModel, temperature: 0.3, maxTokens: 4096 }
      );

      const refined = extractRefineResult(response.content);
      if (!refined) {
        // LLM 输出格式漂移/截断（历史 error「JSON Parse error: Expected '}'」根因）：
        // 降级保留原记忆，仅 warn，不再 handleError 刷屏
        logger.warn('Dream精炼: LLM 输出无法解析为 JSON 数组，保留原记忆', {
          typeName,
          contentLength: response.content.length,
        });
        details.push({
          type: typeName,
          original: batch.length,
          refined: batch.length,
          mergedPairs: 0,
        });
        totalRefined += batch.length;
        continue;
      }
      if (refined.length === 0) {
        details.push({
          type: typeName,
          original: batch.length,
          refined: batch.length,
          mergedPairs: 0,
        });
        totalRefined += batch.length;
        continue;
      }

      for (const m of batch) {
        await memoryManager.deleteMemory(m.id);
      }

      for (const item of refined) {
        if (!item.content?.trim()) continue;
        await memoryManager.createMemory({
          content: item.content.trim(),
          metadata: createMemoryMetadata({
            name: `精炼${typeName}`,
            type,
            tags: item.tags || [],
            priority: 12,
          }),
        });
      }

      const mergedPairs = batch.length - refined.length;
      details.push({
        type: typeName,
        original: batch.length,
        refined: refined.length,
        mergedPairs: Math.max(0, mergedPairs),
      });
      totalRefined += refined.length;

      logger.info(`Dream精炼: ${typeName}`, {
        original: batch.length,
        refined: refined.length,
      });
    } catch (err) {
      void handleError(err, {
        module: 'memory:dream',
        action: 'Dream 精炼失败',
        context: { typeName },
      });
      details.push({
        type: typeName,
        original: batch.length,
        refined: batch.length,
        mergedPairs: 0,
      });
      totalRefined += batch.length;
    }
  }

  await memoryManager.buildMemoryIndex();

  return {
    groupsProcessed: details.length,
    originalCount: totalOriginal,
    refinedCount: totalRefined,
    knowledgeSynced,
    details,
  };
}
