/**
 * BUG-13 回归：`KnowledgeBaseRegistry.deleteBase()` 必须连目录一起处置
 *
 * 缺陷现场（2026-10-22 L3 写入校验）：`DELETE /v1/knowledge/bases/:name` 返回 200，
 * 但 `GET /v1/knowledge/bases` 里仍在。根因是删除只摘注册表条目、目录留在
 * `knowledgeRoot/<name>`，而 `listBases()` 每次都会 `scanAndRegister()` 把未注册目录
 * 重新登记（`label` 退化成目录名、`createdAt` 重置）⇒ 知识库"复活"。
 *
 * 本用例锁三件事：
 *  ① 删除后 `listBases()` 不再包含该知识库；
 *  ② 目录被移入 `.trash-bases/<name>-<ts>`（文档保留、可人工恢复），
 *     且 `.trash-bases` 自身不会被 `scanAndRegister()` 登记成知识库；
 *  ③ 删除不存在的知识库抛错，且注册表不变。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { KnowledgeBaseRegistry } from '../../src/knowledge/KnowledgeBaseRegistry';

let root: string;
let registry: KnowledgeBaseRegistry;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-kb-delete-'));
  registry = new KnowledgeBaseRegistry();
  registry.setKnowledgeRoot(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('KnowledgeBaseRegistry.deleteBase（BUG-13）', () => {
  it('删除后不再出现在列表里，目录移入 .trash-bases 且文档保留', async () => {
    await registry.listBases(); // 首次加载会播种 default 知识库
    await registry.createBase('notes', '笔记');
    writeFileSync(join(root, 'notes', 'a.md'), '# a\n', 'utf-8');

    await registry.deleteBase('notes');

    const bases = await registry.listBases();
    expect(bases.map((b) => b.name)).not.toContain('notes');
    // `.trash-bases` 以 `.` 开头 ⇒ 不被 scanAndRegister 登记
    expect(bases.map((b) => b.name)).not.toContain('.trash-bases');

    // 目录已离开扫描范围，但文档仍在（可恢复）
    expect(existsSync(join(root, 'notes'))).toBe(false);
    const trashEntries = readdirSync(join(root, '.trash-bases'));
    const moved = trashEntries.find((d) => d.startsWith('notes-'));
    expect(moved).toBeDefined();
    expect(existsSync(join(root, '.trash-bases', moved!, 'a.md'))).toBe(true);
  });

  it('删除不存在的知识库 ⇒ 抛错，且不产生 .trash-bases', async () => {
    await registry.listBases();

    await expect(registry.deleteBase('__nope__')).rejects.toThrow();
    expect(existsSync(join(root, '.trash-bases'))).toBe(false);
    expect((await registry.listBases()).map((b) => b.name)).toContain(
      'default'
    );
  });
});
