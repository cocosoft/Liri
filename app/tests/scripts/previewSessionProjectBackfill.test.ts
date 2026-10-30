/**
 * M1 前置（2026-10-30）：`preview-session-project-backfill` 的**只读**归属判定单测。
 *
 * 锁定的契约（宁可不补也不猜）：
 * - 唯一匹配 ⇒ `proposed`；多个匹配 ⇒ `ambiguous`（不自动选）；零匹配 ⇒ `unmatched`；
 * - 已有 `projectId` 且项目存在 ⇒ `already`；指向不存在的项目 ⇒ `unmatched`（悬挂引用）；
 * - 无 `workspacePath` ⇒ `no-workspace`。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  normalizePathKey,
  proposeSessionBindings,
  readProjects,
  readSessions,
  summarizeBindings,
} from '../../scripts/preview-session-project-backfill';

describe('normalizePathKey：路径归一', () => {
  it('分隔符统一为 /，去掉尾部斜杠', () => {
    expect(normalizePathKey('C:\\a\\b\\')).toBe(
      process.platform === 'win32' ? 'c:/a/b' : 'C:/a/b'
    );
  });

  it('空 / 未定义 ⇒ 空串', () => {
    expect(normalizePathKey(undefined)).toBe('');
    expect(normalizePathKey('   ')).toBe('');
  });
});

describe('proposeSessionBindings：归属结论', () => {
  const projects = [
    {
      projectId: 'proj_a',
      sandboxPath: 'C:\\Users\\me\\Documents\\LiriProjects\\proj_a',
    },
    {
      projectId: 'proj_b',
      sandboxPath: 'C:\\Users\\me\\Documents\\LiriProjects\\proj_b',
    },
    // 两个项目共用同一 sandboxPath ⇒ 歧义
    { projectId: 'proj_c1', sandboxPath: 'D:\\shared' },
    { projectId: 'proj_c2', sandboxPath: 'D:\\shared' },
  ];

  it('唯一匹配 ⇒ proposed', () => {
    const rows = proposeSessionBindings(
      [
        {
          sessionId: 's1',
          workspacePath: 'c:/users/me/documents/liriprojects/proj_a/',
        },
      ].map((s) => ({
        ...s,
        // 在非 Windows 上大小写敏感，避免测试依赖平台：直接给归一后的字面量
        workspacePath:
          process.platform === 'win32'
            ? s.workspacePath
            : 'C:/Users/me/Documents/LiriProjects/proj_a',
      })),
      projects
    );
    expect(rows[0].verdict).toEqual({ kind: 'proposed', projectId: 'proj_a' });
  });

  it('已有 projectId 且项目存在 ⇒ already', () => {
    const rows = proposeSessionBindings(
      [{ sessionId: 's2', projectId: 'proj_b' }],
      projects
    );
    expect(rows[0].verdict).toEqual({ kind: 'already', projectId: 'proj_b' });
  });

  it('projectId 指向不存在的项目 ⇒ unmatched（悬挂引用）', () => {
    const rows = proposeSessionBindings(
      [{ sessionId: 's3', projectId: 'proj_gone', workspacePath: 'X:/y' }],
      projects
    );
    expect(rows[0].verdict.kind).toBe('unmatched');
  });

  it('命中多个项目 ⇒ ambiguous 并列出候选（不自动选）', () => {
    const rows = proposeSessionBindings(
      [
        {
          sessionId: 's4',
          workspacePath:
            process.platform === 'win32' ? 'd:/shared' : 'D:/shared',
        },
      ],
      projects
    );
    expect(rows[0].verdict).toEqual({
      kind: 'ambiguous',
      workspacePath: process.platform === 'win32' ? 'd:/shared' : 'D:/shared',
      candidates: ['proj_c1', 'proj_c2'],
    });
  });

  it('无 workspacePath 且无 projectId ⇒ no-workspace', () => {
    const rows = proposeSessionBindings([{ sessionId: 's5' }], projects);
    expect(rows[0].verdict).toEqual({ kind: 'no-workspace' });
  });

  it('workspacePath 与任何项目都不等 ⇒ unmatched', () => {
    const rows = proposeSessionBindings(
      [{ sessionId: 's6', workspacePath: 'E:/elsewhere' }],
      projects
    );
    expect(rows[0].verdict.kind).toBe('unmatched');
  });

  it('summarizeBindings 计数与行数一致', () => {
    const rows = proposeSessionBindings(
      [{ sessionId: 'a', projectId: 'proj_b' }, { sessionId: 'b' }],
      projects
    );
    const summary = summarizeBindings(rows);
    expect(summary.total).toBe(2);
    expect(summary.already).toBe(1);
    expect(summary['no-workspace']).toBe(1);
  });
});

describe('readSessions / readProjects：磁盘投影', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('按 sessions/<partition>/session_*/session.json 与 projects/<id>/project.json 读取', () => {
    dir = mkdtempSync(join(tmpdir(), 'liri-backfill-'));
    const sDir = join(dir, 'sessions', 'default', 'session_x1');
    mkdirSync(sDir, { recursive: true });
    writeFileSync(
      join(sDir, 'session.json'),
      JSON.stringify({
        id: 'session_x1',
        title: '示例',
        metadata: { workspacePath: 'C:/p/proj_a' },
      })
    );
    const pDir = join(dir, 'projects', 'proj_a');
    mkdirSync(pDir, { recursive: true });
    writeFileSync(
      join(pDir, 'project.json'),
      JSON.stringify({ id: 'proj_a', name: 'A', sandboxPath: 'C:/p/proj_a' })
    );
    // 非 session_ 前缀目录应被忽略
    mkdirSync(join(dir, 'sessions', 'default', 'backups'), { recursive: true });

    expect(readSessions(dir)).toEqual([
      {
        sessionId: 'session_x1',
        title: '示例',
        projectId: undefined,
        workspacePath: 'C:/p/proj_a',
      },
    ]);
    expect(readProjects(dir)).toEqual([
      { projectId: 'proj_a', name: 'A', sandboxPath: 'C:/p/proj_a' },
    ]);
  });

  it('数据目录不存在 ⇒ 空数组（不抛错）', () => {
    expect(readSessions(join(tmpdir(), '__no_such_dir__'))).toEqual([]);
    expect(readProjects(join(tmpdir(), '__no_such_dir__'))).toEqual([]);
  });
});
