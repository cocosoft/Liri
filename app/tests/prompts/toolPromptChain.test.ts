/**
 * C-3（2026-10-18）工具提示词 T2 接入守卫。
 *
 * 判据（对应清单 §4 C-3）：
 * - **同源**：模型侧工具描述由 `resolveToolPrompt()` 读取，资源与内置兜底同源（diff=0）；
 * - **键范围受控**：只有 manifest `layer === 'tools'` 登记的条目可被覆盖；
 * - **读取单点**：`app/src/tools/**` 不得自行拼装资源根直接读盘。
 *
 * 覆盖/回退链的行为用例（依赖全局数据目录 override）在 `resolvePromptChain.test.ts` 内
 * 与 C-2 系统段同批执行 —— 避免两个测试文件并发争用 `setUserDataDirOverride` 单例。
 *
 * T1（协议文本：工具名 / XML 标签 / `<think>`）不在本链内，不参与 localize。
 */
import { describe, it, expect } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  resolveToolPrompt,
  clearPromptCache,
} from '../../src/services/prompt/PromptVersionManager';

const PROMPTS_ROOT = join(import.meta.dir, '../../prompts/zh-CN');
const MANIFEST_PATH = join(PROMPTS_ROOT, 'manifest.json');

interface ManifestEntry {
  id: string;
  layer: string;
  kind: string;
  file?: string;
}

function toolEntries(): ManifestEntry[] {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as {
    entries: ManifestEntry[];
  };
  return manifest.entries.filter((e) => e.layer === 'tools');
}

/** `tool:<ToolDir>/<Export>` → 包内文件路径 */
function bundledPath(entry: ManifestEntry): string {
  return join(PROMPTS_ROOT, entry.file ?? '');
}

describe('C-3 工具提示词资源同源', () => {
  it('manifest 登记的每条工具提示词都能被读取，且等于包内资源（同源）', () => {
    clearPromptCache();
    const entries = toolEntries();
    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      const path = bundledPath(entry);
      expect(existsSync(path)).toBe(true);
      const expected = readFileSync(path, 'utf-8').trim();

      const [, toolDir, exportName] = entry.id.split(/[:/]/);
      const actual = resolveToolPrompt(toolDir, exportName, 'FALLBACK');
      expect(actual).toBe(expected);
    }
  });

  it('内置兜底：未登记键（不在 manifest）不进链，原样返回 fallback', () => {
    clearPromptCache();
    expect(resolveToolPrompt('NopeTool', 'NOPE_PROMPT', 'FALLBACK')).toBe(
      'FALLBACK'
    );
  });

  it('GrepTool.description 由解析链产出（当前 locale 下 === 包内资源）', async () => {
    clearPromptCache();

    const { GrepTool } = await import('../../src/tools/GrepTool/GrepTool');
    const description = new GrepTool().description;

    const entry = toolEntries().find(
      (e) => e.id === 'tool:GrepTool/getDescription'
    )!;
    expect(description).toBe(readFileSync(bundledPath(entry), 'utf-8').trim());
  });

  it('读取单点：tools 层源码不自行拼装资源根（禁两处各写一份的读盘实现）', () => {
    const toolsRoot = join(import.meta.dir, '../../src/tools');
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, name.name);
        if (name.isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.name.endsWith('.ts') || name.name.includes('.test.'))
          continue;
        const source = readFileSync(full, 'utf-8');
        if (
          source.includes('PROMPT_RESOURCE_ROOT') ||
          /readFileSync\([^)]*prompts['"`]/s.test(source)
        ) {
          offenders.push(full);
        }
      }
    };

    walk(toolsRoot);
    expect(offenders).toEqual([]);
  });
});
