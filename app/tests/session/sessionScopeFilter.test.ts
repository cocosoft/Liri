/**
 * 2026-10-31（隔离缺陷 P2）：会话列表作用域过滤的**单一实现** + `lite` 投影补字段。
 *
 * 锁定的两个既有缺陷：
 *  ① `GET /v1/sessions?lite=true` 曾**完全忽略** `moduleType` / `projectId`；
 *  ② 非 lite 分支用 `md?.moduleType || legacy(...)` 比较 ⇒ 缺 `moduleType` 的会话
 *     与 `moduleType=chat` 永不相等（传 chat 反而返回空）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { applySessionScopeFilter } from '../../src/infrastructure/http/handlers/session-handlers';
import { readLiteSessionMeta } from '../../src/session/storage/LiteSessionReader';

type Row = { id: string; metadata?: Record<string, unknown> };
const readMd = (r: Row) => r.metadata;

const SESSIONS: Row[] = [
  { id: 'chat-1' }, // 无 moduleType ⇒ 视为 chat
  { id: 'chat-2', metadata: { moduleType: 'chat' } },
  { id: 'proj-1', metadata: { moduleType: 'project', projectId: 'proj_1_aa' } },
  { id: 'proj-2', metadata: { projectId: 'proj_2_bb' } }, // 无 moduleType 但有归属
  { id: 'legacy-1', metadata: { workspaceId: 'project-proj_3_cc' } },
];

describe('applySessionScopeFilter（唯一实现）', () => {
  it('不传作用域 ⇒ 原样返回（全量语义，统计/项目计数不受影响）', () => {
    expect(applySessionScopeFilter(SESSIONS, {}, readMd)).toBe(SESSIONS);
    expect(
      applySessionScopeFilter(SESSIONS, { moduleType: '  ' }, readMd)
    ).toBe(SESSIONS);
  });

  it('moduleType=chat：缺 moduleType 的会话**算 chat**（原实现会漏掉它们）', () => {
    const ids = applySessionScopeFilter(
      SESSIONS,
      { moduleType: 'chat' },
      readMd
    ).map((s) => s.id);
    // 与前端 `resolveSessionModuleType` 同口径：`moduleType` 缺省 ⇒ chat
    // （`proj-2` 只有 projectId、没有 moduleType/legacy 前缀 ⇒ 此口径下仍算 chat；
    //  这类行属 P3 修数据范围，新写入已由 handleCreateSession 补 moduleType）
    expect(ids).toEqual(['chat-1', 'chat-2', 'proj-2']);
  });

  it('moduleType=project：显式 moduleType 与 legacy `project-` 前缀都算项目会话', () => {
    const ids = applySessionScopeFilter(
      SESSIONS,
      { moduleType: 'project' },
      readMd
    ).map((s) => s.id);
    // proj-2 没有 moduleType（且 workspaceId 为空）⇒ 不属 project（数据侧由 P3 补齐）
    expect(ids).toEqual(['proj-1', 'legacy-1']);
  });

  it('projectId：metadata.projectId 优先，legacy `project-<id>` 兜底', () => {
    expect(
      applySessionScopeFilter(SESSIONS, { projectId: 'proj_1_aa' }, readMd).map(
        (s) => s.id
      )
    ).toEqual(['proj-1']);
    expect(
      applySessionScopeFilter(SESSIONS, { projectId: 'proj_3_cc' }, readMd).map(
        (s) => s.id
      )
    ).toEqual(['legacy-1']);
  });

  it('moduleType + projectId 同时传 ⇒ 需同时满足', () => {
    expect(
      applySessionScopeFilter(
        SESSIONS,
        { moduleType: 'project', projectId: 'proj_2_bb' },
        readMd
      )
    ).toEqual([]);
    expect(
      applySessionScopeFilter(
        SESSIONS,
        { moduleType: 'project', projectId: 'proj_1_aa' },
        readMd
      ).map((s) => s.id)
    ).toEqual(['proj-1']);
  });

  it('lite 形态（扁平 moduleType/projectId）用同一实现过滤', () => {
    const lite = [
      { id: 'a', moduleType: 'chat' },
      { id: 'b', moduleType: 'project', projectId: 'proj_9_zz' },
      { id: 'c' },
    ];
    const filtered = applySessionScopeFilter(
      lite,
      { moduleType: 'chat' },
      (s) => ({ moduleType: s.moduleType, projectId: s.projectId })
    );
    expect(filtered.map((s) => s.id)).toEqual(['a', 'c']);
  });
});

describe('readLiteSessionMeta：lite 投影补上作用域字段', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'liri-lite-scope-'));
  });
  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Windows 偶发 EBUSY
    }
  });

  it('头部可解析路径：带出 moduleType / projectId', () => {
    const file = join(root, 'session.json');
    writeFileSync(
      file,
      JSON.stringify({
        id: 's1',
        title: 'T',
        status: 'paused',
        updatedAt: 1793407479778,
        metadata: { moduleType: 'project', projectId: 'proj_1792_aa' },
      }),
      'utf-8'
    );
    const meta = readLiteSessionMeta(file);
    expect(meta?.moduleType).toBe('project');
    expect(meta?.projectId).toBe('proj_1792_aa');
  });

  it('头部缺基础字段 ⇒ 回退全量解析，作用域字段仍不丢', () => {
    const file = join(root, 'session2.json');
    // 无 title/status ⇒ 走 JSON.parse 兜底分支
    writeFileSync(
      file,
      JSON.stringify({
        id: 's2',
        metadata: { moduleType: 'chat', projectId: 'proj_5_bb' },
      }),
      'utf-8'
    );
    const meta = readLiteSessionMeta(file);
    expect(meta?.moduleType).toBe('chat');
    expect(meta?.projectId).toBe('proj_5_bb');
  });
});
