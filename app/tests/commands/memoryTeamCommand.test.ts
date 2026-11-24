/**
 * `/memory team`（Phase 3-lite 审阅入口，2026-11-25）单测。
 *
 * 覆盖：列出冲突候选 · 人工采纳（keep-local）· 失败路径提示 · --json 输出。
 * 全部使用临时目录（通过 `dirs` 注入，不触碰真实团队目录/配置）。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import memoryCommand from '@modules/commands/builtin/memory/Memory';

const createdDirs: string[] = [];

function makeDirs(): { teamDir: string; sharedDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'memory-team-cmd-'));
  createdDirs.push(root);
  const teamDir = join(root, 'team');
  const sharedDir = join(root, 'shared');
  mkdirSync(teamDir, { recursive: true });
  mkdirSync(sharedDir, { recursive: true });
  return { teamDir, sharedDir };
}

function memFile(id: string, content: string): string {
  return ['---', `id: ${id}`, `name: ${id}`, '---', '', content, ''].join('\n');
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (!dir) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言
    }
  }
});

describe('/memory team（Phase 3-lite）', () => {
  it('列出冲突候选（含方向）', async () => {
    const dirs = makeDirs();
    writeFileSync(
      join(dirs.teamDir, 'conflicts.json'),
      JSON.stringify({
        total: 1,
        candidates: [{ id: 'c1', directions: ['pull', 'push'] }],
      }),
      'utf-8'
    );

    const result = await memoryCommand.teamCommand('', false, dirs);
    expect(result.success).toBe(true);
    expect(result.message).toContain('c1');
    expect(result.message).toContain('[pull/push]');
  });

  it('keep-local ⇒ 覆盖共享侧', async () => {
    const dirs = makeDirs();
    writeFileSync(
      join(dirs.teamDir, 'c2.md'),
      memFile('c2', '本地版本'),
      'utf-8'
    );
    writeFileSync(
      join(dirs.sharedDir, 'c2.md'),
      memFile('c2', '远端版本'),
      'utf-8'
    );

    const result = await memoryCommand.teamCommand(
      'keep-local c2',
      false,
      dirs
    );
    expect(result.success).toBe(true);
    expect(readFileSync(join(dirs.sharedDir, 'c2.md'), 'utf-8')).toContain(
      '本地版本'
    );
  });

  it('不存在的 id ⇒ 失败提示', async () => {
    const dirs = makeDirs();
    const result = await memoryCommand.teamCommand(
      'keep-shared nope',
      false,
      dirs
    );
    expect(result.success).toBe(false);
  });

  it('无冲突文件 ⇒ 明确提示，不抛', async () => {
    const dirs = makeDirs();
    const result = await memoryCommand.teamCommand('', false, dirs);
    expect(result.success).toBe(true);
    expect(result.message).toContain('无待处理冲突');
    expect(existsSync(join(dirs.teamDir, 'conflicts.json'))).toBe(false);
  });

  it('--json ⇒ 输出可解析 JSON', async () => {
    const dirs = makeDirs();
    writeFileSync(
      join(dirs.teamDir, 'conflicts.json'),
      JSON.stringify({
        total: 0,
        candidates: [],
      }),
      'utf-8'
    );

    const result = await memoryCommand.teamCommand('--json', true, dirs);
    const parsed = JSON.parse(result.message) as { total?: number };
    expect(parsed.total).toBe(0);
  });
});
