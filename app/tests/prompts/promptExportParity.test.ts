/**
 * C-1（2026-10-18）提示词**冻结导出**守卫。
 *
 * 判据（对应清单 C-1 验收）：
 * - 逐段文本 **diff = 0**：磁盘内容 === 当前源文本（静态段 / 工具提示词）；
 * - **hash 与导出源一致**：manifest 的 sha256 === 重算值；
 * - 23 段**全覆盖**：静态 9 段有文件；动态 14 段只登记原因（不编造文本，CS06）；
 * - **行为零变化**：包内资源读取收敛于 PromptVersionManager 单点（C-2 六级链，
 *   见末条守卫）；框架与段落定义不直接读盘；
 * - 目录与 manifest 相互闭合（无缺失 / 无多余产物）。
 */
import { describe, it, expect } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  PROMPTS_ROOT,
  PROMPT_LOCALE,
  collectSections,
  collectToolPrompts,
  sha256,
} from '../../scripts/lib/promptExportSources';

const LOCALE_ROOT = join(PROMPTS_ROOT, PROMPT_LOCALE);
const MANIFEST_PATH = join(LOCALE_ROOT, 'manifest.json');

interface ManifestEntry {
  id: string;
  layer: 'system' | 'tools';
  kind: 'static' | 'dynamic';
  locale: string;
  source: string;
  file?: string;
  sha256?: string;
  reason?: string;
}
interface Manifest {
  schemaVersion: number;
  locale: string;
  counts: {
    sections: number;
    sectionsStatic: number;
    sectionsDynamic: number;
    toolModules: number;
    toolPrompts: number;
  };
  entries: ManifestEntry[];
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
}

function listFiles(dir: string, base: string = LOCALE_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(full.slice(base.length + 1).replaceAll('\\', '/'));
  }
  return out;
}

describe('C-1 提示词冻结导出', () => {
  it('manifest 存在且 23 段全覆盖（静态 9 / 动态 14）', () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
    const manifest = readManifest();
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.locale).toBe(PROMPT_LOCALE);
    expect(manifest.counts.sections).toBe(23);
    expect(manifest.counts.sectionsStatic).toBe(9);
    expect(manifest.counts.sectionsDynamic).toBe(14);

    const sectionEntries = manifest.entries.filter((e) => e.layer === 'system');
    expect(sectionEntries).toHaveLength(23);
    for (const entry of sectionEntries) {
      if (entry.kind === 'static') {
        expect(entry.file).toBeDefined();
        expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(entry.reason).toBeUndefined();
      } else {
        expect(entry.file).toBeUndefined();
        expect(entry.sha256).toBeUndefined();
        expect((entry.reason ?? '').length).toBeGreaterThan(0);
      }
    }
  });

  it('静态段：磁盘文本 === 源文本，且 hash 与 manifest 一致', async () => {
    const sections = await collectSections();
    const manifest = readManifest();
    let checked = 0;

    for (const section of sections) {
      if (section.kind !== 'static') continue;
      const rel = section.file!;
      const full = join(LOCALE_ROOT, rel);
      expect(existsSync(full)).toBe(true);
      const actual = readFileSync(full, 'utf8');
      expect(actual).toBe(section.text!);
      expect(sha256(actual)).toBe(section.sha256!);

      const entry = manifest.entries.find((e) => e.id === section.id);
      expect(entry).toBeDefined();
      expect(entry!.sha256).toBe(section.sha256!);
      expect(entry!.file).toBe(rel);
      checked++;
    }

    expect(checked).toBe(9);
  });

  it('工具提示词：逐文件 diff = 0，hash 与 manifest 一致', async () => {
    const tools = await collectToolPrompts();
    const manifest = readManifest();
    const modules = new Set(tools.map((t) => t.dir));

    // S-P4（2026-10-18）：31 个零消费者 `*_TOOL_PROMPT` 已删除（连同 zh/en 资源），
    // 仅保留有真实读取点的 3 个描述导出（GrepTool / FileWriteTool / FileEditTool）。
    expect(modules.size).toBe(3);
    expect(tools.length).toBe(manifest.counts.toolPrompts);
    expect(manifest.counts.toolModules).toBe(3);

    for (const tool of tools) {
      const full = join(LOCALE_ROOT, tool.file);
      expect(existsSync(full)).toBe(true);
      const actual = readFileSync(full, 'utf8');
      expect(actual).toBe(tool.text);
      expect(sha256(actual)).toBe(tool.sha256);

      const entry = manifest.entries.find((e) => e.id === tool.id);
      expect(entry).toBeDefined();
      expect(entry!.layer).toBe('tools');
      expect(entry!.sha256).toBe(tool.sha256);
    }
  });

  it('目录与 manifest 相互闭合（无缺失 / 无多余产物）', async () => {
    const sections = await collectSections();
    const tools = await collectToolPrompts();
    // C-3b：`tool-params.json` 是工具**参数**描述资源（T2 字段级），与 manifest 同级共存
    // T2：`tool-descriptions.json` 是工具**级**描述资源（模型侧 `tools[].description`）
    const expected = new Set<string>([
      'manifest.json',
      'tool-params.json',
      'tool-descriptions.json',
    ]);
    for (const s of sections) if (s.file) expected.add(s.file);
    for (const t of tools) expected.add(t.file);

    const actual = new Set(listFiles(LOCALE_ROOT));
    expect([...actual].sort()).toEqual([...expected].sort());
  });

  it('C-2：包内资源读取收敛于 PromptVersionManager 单点（框架与段落定义不直接读盘）', () => {
    // C-1 时期的断言是「生产代码零读取」；C-2 落地六级链后，读取点收敛到
    // PromptVersionManager（PROMPT_RESOURCE_ROOT），其余文件仍禁止直接读资源。
    const managerSource = readFileSync(
      new URL(
        '../../src/services/prompt/PromptVersionManager.ts',
        import.meta.url
      ),
      'utf8'
    );
    expect(managerSource).toContain('PROMPT_RESOURCE_ROOT');

    for (const rel of [
      'src/context/promptSections/builtinSections.ts',
      'src/constants/systemPromptSections.ts',
    ]) {
      const source = readFileSync(
        new URL(`../../${rel}`, import.meta.url),
        'utf8'
      );
      expect(source).not.toContain('PROMPT_RESOURCE_ROOT');
      expect(source).not.toContain('prompts/zh-CN');
    }
  });
});
