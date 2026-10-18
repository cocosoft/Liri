/**
 * C-3b / T2（2026-10-18）工具级资源**外置覆盖**列表守卫。
 *
 * 背景：解析链 ①② 支持 `tool-params.json` / `tool-descriptions.json` 的用户 / 项目覆盖，
 * 但 `listPromptOverrides()` 只扫 manifest 登记的 `.md` ⇒ `liri prompt diff` 看不到它们。
 * `listToolResourceOverrides()` 补齐这条读数路径（导出 / diff 共用）。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { listToolResourceOverrides } from '../../src/services/prompt/PromptVersionManager';

const ROOT = mkdtempSync(join(tmpdir(), 'tool-res-overrides-'));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

function makeDirs(tag: string): { userDir: string; projectDir: string } {
  const base = join(ROOT, tag);
  const userDir = join(base, 'user');
  const projectDir = join(base, 'project');
  mkdirSync(join(userDir, 'en-US'), { recursive: true });
  mkdirSync(join(projectDir, 'en-US'), { recursive: true });
  return { userDir, projectDir };
}

function writeResource(
  dir: string,
  locale: string,
  file: string,
  field: 'params' | 'descriptions',
  map: Record<string, string>
): void {
  writeFileSync(
    join(dir, locale, file),
    JSON.stringify({ schemaVersion: 1, locale, [field]: map }),
    'utf-8'
  );
}

describe('工具级资源外置覆盖', () => {
  it('用户 / 项目两侧按文件上报，count = 键数', () => {
    const { userDir, projectDir } = makeDirs('both');
    writeResource(userDir, 'en-US', 'tool-params.json', 'params', {
      'grep.pattern': 'Pattern',
      'grep.searchPath': 'Path',
    });
    writeResource(
      projectDir,
      'en-US',
      'tool-descriptions.json',
      'descriptions',
      {
        grep: 'Search files',
      }
    );

    const hits = listToolResourceOverrides('en-US', { userDir, projectDir });
    expect(hits).toHaveLength(2);

    const user = hits.find((h) => h.scope === 'user');
    expect(user?.file).toBe('tool-params.json');
    expect(user?.count).toBe(2);
    expect(user?.label).toBe('工具参数描述');

    const project = hits.find((h) => h.scope === 'project');
    expect(project?.file).toBe('tool-descriptions.json');
    expect(project?.count).toBe(1);
  });

  it('无覆盖 ⇒ 空数组（不臆造）', () => {
    const { userDir, projectDir } = makeDirs('empty');
    expect(listToolResourceOverrides('en-US', { userDir, projectDir })).toEqual(
      []
    );
  });

  it('坏 JSON ⇒ 仍上报路径，count=0（不抛错）', () => {
    const { userDir, projectDir } = makeDirs('broken');
    writeFileSync(
      join(userDir, 'en-US', 'tool-params.json'),
      '{ not json',
      'utf-8'
    );
    const hits = listToolResourceOverrides('en-US', { userDir, projectDir });
    expect(hits).toHaveLength(1);
    expect(hits[0].count).toBe(0);
  });
});
