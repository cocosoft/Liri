/**
 * PY-4 测试：ManifestLoader/validatePluginManifest 的 main 与 entry.python 二选一
 * + getPythonVersion / satisfiesPythonVersion
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { validatePluginManifest } from '../core';
import { loadPluginManifest } from '../ManifestLoader';
import { generatePluginTemplate } from '../scaffold';
import { getPythonVersion, satisfiesPythonVersion } from '@modules/ai';

describe('validatePluginManifest：main 与 entry.python 二选一（PY-4）', () => {
  test('有 entry.python 无 main → 通过', () => {
    const result = validatePluginManifest({
      id: 'hello-python',
      name: 'Hello Python',
      version: '0.1.0',
      description: '',
      author: 'demo',
      type: 'python',
      main: '',
      entry: { python: 'main.py' },
    });
    expect(result.valid).toBe(true);
  });

  test('有 main 无 entry.python → 通过（TS 插件兼容）', () => {
    const result = validatePluginManifest({
      id: 'ts-plugin',
      name: 'TS Plugin',
      version: '0.1.0',
      description: '',
      author: 'demo',
      type: 'ts',
      main: 'index.js',
    });
    expect(result.valid).toBe(true);
  });

  test('无 main 且无 entry.python → 校验失败', () => {
    const result = validatePluginManifest({
      id: 'bad',
      name: 'Bad',
      version: '0.1.0',
      description: '',
      author: 'demo',
      type: 'ts',
      main: '',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_MISSING_ENTRY')).toBe(
      true
    );
  });
});

describe('loadPluginManifest：entry.python 清单（PY-4）', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'py-manifest-'));

  beforeAll(() => {
    // 生成含 entry.python 的 plugin.json（ManifestLoader json 格式为扁平 manifest）
    writeFileSync(
      join(tmpDir, 'plugin.json'),
      JSON.stringify({
        id: 'hello-python',
        name: 'Hello Python',
        version: '0.1.0',
        description: '测试插件',
        author: 'demo',
        type: 'python',
        entry: { python: 'main.py' },
      }),
      'utf-8'
    );
  });

  test('含 entry.python 的 plugin.json 加载通过（main 缺省合法）', () => {
    const { manifest, validation } = loadPluginManifest(tmpDir);
    expect(manifest).not.toBeNull();
    expect(validation.valid).toBe(true);
    expect(manifest!.entry?.python).toBe('main.py');
  });
});

describe('getPythonVersion / satisfiesPythonVersion（PY-4）', () => {
  test('getPythonVersion 返回本机 python 版本号', async () => {
    const version = await getPythonVersion('python');
    expect(version).toMatch(/^\d+\.\d+/);
  });

  test('satisfiesPythonVersion 版本比较', () => {
    expect(satisfiesPythonVersion('3.13.1', '>=3.10')).toBe(true);
    expect(satisfiesPythonVersion('3.9.5', '>=3.10')).toBe(false);
    expect(satisfiesPythonVersion('3.10.0', '>=3.10')).toBe(true);
    expect(satisfiesPythonVersion('3.11.2', '<3.11')).toBe(false);
    expect(satisfiesPythonVersion('3.11.2', '>=3.11')).toBe(true);
    expect(satisfiesPythonVersion(null, '>=3.10')).toBe(false);
  });
});

describe('generatePluginTemplate python 模板（PY-7）', () => {
  test('生成 plugin.json 桥接清单 + main.py，清单校验通过', () => {
    const files = generatePluginTemplate({
      id: 'hello-python',
      name: 'Hello Python',
      version: '0.1.0',
      description: '测试',
      author: 'demo',
      language: 'python',
      inject: ['session_manager'],
    });

    const paths = files.map((f) => f.path);
    expect(paths).toContain('plugin.json');
    expect(paths).toContain('main.py');

    const bridge = JSON.parse(
      files.find((f) => f.path === 'plugin.json')!.content
    );
    expect(bridge.type).toBe('python');
    expect(bridge.entry.python).toBe('main.py');
    expect(bridge.inject).toEqual(['session_manager']);

    // 生成的清单必须通过 validatePluginManifest（main 与 entry.python 二选一）
    const validation = validatePluginManifest(bridge as never);
    expect(validation.valid).toBe(true);

    // main.py 包含 liri SDK 插件骨架
    const mainPy = files.find((f) => f.path === 'main.py')!.content;
    expect(mainPy).toContain('from liri import Plugin, tool');
    expect(mainPy).toContain('plugin.run()');
  });
});
