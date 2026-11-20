/**
 * plugin-sdk 清单契约测试（2026-11-20 补建）
 *
 * 为什么补：`packages/plugin-sdk/src/plugin-sdk/AGENTS.md` 的「版本兼容」条款要求改动 SDK 时
 * 更新 `app/src/plugin-sdk/__tests__/ManifestLoaderEntry.test.ts`，而该文件**从未存在**
 * （台账 2026-11-13 条）。此处按 AGENTS.md 描述的覆盖点（**manifest 校验 / `entry.python`**）
 * 落成一条真实契约测试，并作为「改 SDK 必跑」的执行点。
 *
 * 只覆盖公开 API（`loadPluginManifest`）的对外契约，不测内部实现细节。
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPluginManifest } from '@modules/plugin-sdk';

const dirs: string[] = [];

/** 建一个临时插件目录并写入指定清单文件 */
const makePluginDir = (fileName: string, content: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-contract-'));
  dirs.push(dir);
  writeFileSync(join(dir, fileName), content, 'utf8');
  return dir;
};

const BASE_MANIFEST = {
  id: 'demo.plugin',
  name: 'Demo',
  version: '1.0.0',
  description: 'demo plugin',
  author: 'tester',
  type: 'tool',
};

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('plugin-sdk 清单契约（loadPluginManifest）', () => {
  test('package.json 的 pyapp 字段可加载并通过校验', () => {
    const dir = makePluginDir(
      'package.json',
      JSON.stringify({
        name: 'demo',
        pyapp: { ...BASE_MANIFEST, main: 'index.js' },
      })
    );
    const r = loadPluginManifest(dir);
    expect(r.validation.valid).toBe(true);
    expect(r.manifest?.id).toBe('demo.plugin');
    expect(r.source.endsWith('package.json')).toBe(true);
  });

  test('PY-4 契约：无 main、仅有 entry.python ⇒ 合法', () => {
    const dir = makePluginDir(
      'plugin.json',
      JSON.stringify({ ...BASE_MANIFEST, entry: { python: 'main.py' } })
    );
    const r = loadPluginManifest(dir);
    expect(r.validation.valid).toBe(true);
    expect(r.manifest?.entry?.python).toBe('main.py');
  });

  test('main 与 entry.python 都缺 ⇒ MISSING_ENTRY（不静默通过）', () => {
    const dir = makePluginDir('plugin.json', JSON.stringify(BASE_MANIFEST));
    const r = loadPluginManifest(dir);
    expect(r.validation.valid).toBe(false);
    expect(r.manifest).toBeNull();
    expect(r.validation.errors.map((e) => e.code)).toContain('MISSING_ENTRY');
  });

  test('清单文件缺失 ⇒ MANIFEST_NOT_FOUND', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plugin-contract-empty-'));
    dirs.push(dir);
    const r = loadPluginManifest(dir);
    expect(r.validation.valid).toBe(false);
    expect(r.validation.errors.map((e) => e.code)).toContain(
      'MANIFEST_NOT_FOUND'
    );
  });

  test('package.json 缺 pyapp 字段 ⇒ MISSING_PYAPP_FIELD', () => {
    const dir = makePluginDir('package.json', JSON.stringify({ name: 'demo' }));
    const r = loadPluginManifest(dir);
    expect(r.validation.valid).toBe(false);
    expect(r.validation.errors.map((e) => e.code)).toContain(
      'MISSING_PYAPP_FIELD'
    );
  });

  test('非法 JSON ⇒ PARSE_ERROR（不抛）', () => {
    const dir = makePluginDir('plugin.json', '{ not json');
    const r = loadPluginManifest(dir);
    expect(r.validation.valid).toBe(false);
    expect(r.validation.errors.map((e) => e.code)).toContain('PARSE_ERROR');
  });

  test('plugin.yaml 极简结构可加载', () => {
    const yaml = [
      'id: demo.plugin',
      'name: Demo',
      'version: 1.0.0',
      'description: demo plugin',
      'author: tester',
      'type: tool',
      'main: index.js',
    ].join('\n');
    const dir = makePluginDir('plugin.yaml', yaml);
    const r = loadPluginManifest(dir);
    expect(r.validation.valid).toBe(true);
    expect(r.manifest?.id).toBe('demo.plugin');
  });
});
