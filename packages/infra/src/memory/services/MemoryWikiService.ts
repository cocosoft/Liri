/**
 * 记忆表示层（P2-1 Represent，2026-11-25）
 *
 * 目标（对齐 Anthropic A7「表示 + 搜索优于单用」）：在记忆库之上维护一层**小**的
 * 主题索引页（按记忆类型分组，链接到原始记忆文件），供人工/后续 dreaming 浏览；
 * 并做**链接完整性**检查（目标文件不存在 ⇒ 不写该链接）与**体积上限**
 * （wiki 总量 ≤ 源记忆正文 × 1.2，超出则退化为"无钩子"形式）。
 *
 * 边界（如实）：
 * - 不是第二套检索：注入仍只读 `MEMORY.md`（P0-1）；wiki 不被系统提示直接消费；
 * - 只清理**本服务生成**的过期页面（首行标记判定），用户手写文件不触碰。
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';
import type { Memory } from '../types/Memory';

/** 生成物标记（用于安全清理旧页面：只删自己生成的） */
const GENERATED_MARKER = '<!-- generated-by: memory-wiki -->';

/** 单页条目上限（防"wiki 比源还大"） */
const MAX_ENTRIES_PER_PAGE = 50;

/** 一行钩子最大字符数 */
const MAX_HOOK_CHARS = 120;

/** wiki 体积上限 = 源记忆正文 × 该系数 */
const SIZE_RATIO_CAP = 1.2;

/** 体积上限的最低额度（wiki 有标题/索引等固定开销；极小库不应被判为"超限"） */
const MIN_WIKI_BUDGET_BYTES = 4_000;

export interface MemoryWikiReport {
  pages: number;
  entries: number;
  bytes: number;
  sourceBytes: number;
  droppedLinks: number;
  truncated: boolean;
}

function oneLine(text: string, maxChars: number): string {
  const compact = text.replace(/\s+/g, ' ').replace(/[\[\]]/g, '').trim();
  return compact.length > maxChars ? `${compact.slice(0, maxChars)}…` : compact;
}

/** 记忆文件相对 wiki 目录的链接路径（`global/wiki/` ⇒ `../`；会话记忆在 `sessions/<id>/`） */
function linkFor(memory: Memory): string {
  return memory.metadata.sessionId
    ? `../../sessions/${memory.metadata.sessionId}/${memory.id}.md`
    : `../${memory.id}.md`;
}

/** 目标文件绝对路径（用于链接完整性检查） */
function targetPath(memoryDir: string, memory: Memory): string {
  return memory.metadata.sessionId
    ? join(memoryDir, 'sessions', memory.metadata.sessionId, `${memory.id}.md`)
    : join(memoryDir, 'global', `${memory.id}.md`);
}

async function writeIfChanged(filePath: string, content: string): Promise<void> {
  try {
    const existing = await fs.readFile(filePath, 'utf-8');
    if (existing === content) return;
  } catch {
    // 不存在 ⇒ 直接写
  }
  await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * 重建表示层（幂等；内容未变则不重写）。
 *
 * @param memoryDir 记忆根目录（如 `~/.pyapp/data/memory`）
 * @param memories 当前记忆快照（已过期条目会被排除）
 */
export async function rebuildMemoryWiki(
  memoryDir: string,
  memories: Memory[]
): Promise<MemoryWikiReport> {
  const now = Date.now();
  const active = memories.filter(
    (m) => !m.metadata.expiresAt || new Date(m.metadata.expiresAt).getTime() > now
  );
  const sourceBytes = active.reduce(
    (sum, m) => sum + Buffer.byteLength(m.content ?? '', 'utf-8'),
    0
  );

  const byType = new Map<string, Memory[]>();
  for (const memory of active) {
    // 类型缺失（空串）归入 `_untyped`（避免使用状态词汇字面量）
    const type = memory.metadata.type || '_untyped';
    const list = byType.get(type) ?? [];
    list.push(memory);
    byType.set(type, list);
  }

  const wikiDir = join(memoryDir, 'global', 'wiki');
  await fs.mkdir(wikiDir, { recursive: true });

  // 先生成（带钩子），超体积上限则退化为无钩子
  const buildPages = async (
    withHook: boolean
  ): Promise<{
    pages: Map<string, string>;
    entries: number;
    droppedLinks: number;
    truncated: boolean;
  }> => {
    const pages = new Map<string, string>();
    let entries = 0;
    let droppedLinks = 0;
    let truncated = false;

    for (const [type, list] of byType) {
      list.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      const lines = [
        GENERATED_MARKER,
        `# ${oneLine(type, 60)}`,
        '',
        `> 由记忆库自动生成（${list.length} 条）；链接指向原始记忆文件。`,
        '',
      ];
      let count = 0;
      for (const memory of list) {
        if (count >= MAX_ENTRIES_PER_PAGE) {
          truncated = true;
          break;
        }
        // 链接完整性：目标文件不存在 ⇒ 不写该链接
        if (!existsSync(targetPath(memoryDir, memory))) {
          droppedLinks += 1;
          continue;
        }
        const title = oneLine(memory.metadata.name || memory.id, 80);
        const hook = withHook
          ? oneLine(memory.metadata.description || memory.content || '', MAX_HOOK_CHARS)
          : '';
        lines.push(
          `- [${title}](${linkFor(memory)})${hook ? ` — ${hook}` : ''}`
        );
        entries += 1;
        count += 1;
      }
      pages.set(`${oneLine(type, 60).replace(/[/\\:*?"<>|]/g, '_')}.md`, lines.join('\n') + '\n');
    }

    return { pages, entries, droppedLinks, truncated };
  };

  let built = await buildPages(true);
  let bytes = [...built.pages.values()].reduce(
    (sum, content) => sum + Buffer.byteLength(content, 'utf-8'),
    0
  );
  const cap = Math.max(sourceBytes * SIZE_RATIO_CAP, MIN_WIKI_BUDGET_BYTES);
  if (cap > 0 && bytes > cap) {
    built = await buildPages(false);
    bytes = [...built.pages.values()].reduce(
      (sum, content) => sum + Buffer.byteLength(content, 'utf-8'),
      0
    );
    built.truncated = true;
  }

  // INDEX 页
  const indexLines = [
    GENERATED_MARKER,
    '# 记忆表示层',
    '',
    `> 按类型分组；共 ${built.entries} 条（源记忆 ${active.length} 条）。`,
    '',
    ...[...built.pages.keys()].map((file) => {
      const title = file.replace(/\.md$/, '');
      return `- [${title}](${encodeURIComponent(file)})`;
    }),
  ];
  const indexContent = indexLines.join('\n') + '\n';
  await writeIfChanged(join(wikiDir, 'INDEX.md'), indexContent);
  bytes += Buffer.byteLength(indexContent, 'utf-8');

  // 链接完整性（二遍）：清理本服务生成的、已无对应类型的旧页面
  const generated = new Set([...built.pages.keys(), 'INDEX.md']);
  const existing = await fs.readdir(wikiDir).catch(() => [] as string[]);
  for (const file of existing) {
    if (!file.endsWith('.md') || generated.has(file)) continue;
    const fullPath = join(wikiDir, file);
    try {
      const head = await fs.readFile(fullPath, 'utf-8');
      if (head.startsWith(GENERATED_MARKER)) {
        await fs.unlink(fullPath);
      }
    } catch {
      // 读取失败 ⇒ 不动它（可能是用户文件）
    }
  }

  for (const [file, content] of built.pages) {
    await writeIfChanged(join(wikiDir, file), content);
  }

  return {
    pages: built.pages.size,
    entries: built.entries,
    bytes,
    sourceBytes,
    droppedLinks: built.droppedLinks,
    truncated: built.truncated,
  };
}
