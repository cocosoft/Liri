/**
 * C-1（2026-10-18）提示词**冻结导出**：把静态段落与工具提示词的**原文**落到
 * `app/prompts/<locale>/sections|tools/`，并生成 `manifest.json`（id / layer / locale / hash）。
 *
 * **行为零变化**：本脚本只**读**运行时文本、只**写**资源文件；生产代码不读这些文件
 * （读取路径由 C-2 的 `resolvePrompt()` 承接 —— 在 C-1 里加读盘分支会违反
 * 「不引入任何行为分支」的验收口径）。
 *
 * 用法（`app/` 目录）：
 *   bun run scripts/export-prompts.ts           # 生成 / 覆盖资源与 manifest
 *   bun run scripts/export-prompts.ts --check   # 只校验（diff ≠ 0 或 hash 不符 ⇒ exit 1）
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import {
  PROMPT_LOCALE,
  PROMPTS_ROOT,
  collectSections,
  collectToolPrompts,
  type SectionExport,
  type ToolPromptExport,
} from './lib/promptExportSources';

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
  schemaVersion: 1;
  locale: string;
  generatedBy: string;
  counts: {
    sections: number;
    sectionsStatic: number;
    sectionsDynamic: number;
    toolModules: number;
    toolPrompts: number;
  };
  entries: ManifestEntry[];
}

function buildManifest(
  sections: SectionExport[],
  tools: ToolPromptExport[],
  toolModules: number
): Manifest {
  const entries: ManifestEntry[] = [
    ...sections.map((s) => ({
      id: s.id,
      layer: 'system' as const,
      kind: s.kind,
      locale: PROMPT_LOCALE,
      source: s.source,
      ...(s.file ? { file: s.file } : {}),
      ...(s.sha256 ? { sha256: s.sha256 } : {}),
      ...(s.reason ? { reason: s.reason } : {}),
    })),
    ...tools.map((t) => ({
      id: t.id,
      layer: 'tools' as const,
      kind: 'static' as const,
      locale: PROMPT_LOCALE,
      source: t.source,
      file: t.file,
      sha256: t.sha256,
    })),
  ];

  return {
    schemaVersion: 1,
    locale: PROMPT_LOCALE,
    generatedBy: 'app/scripts/export-prompts.ts',
    counts: {
      sections: sections.length,
      sectionsStatic: sections.filter((s) => s.kind === 'static').length,
      sectionsDynamic: sections.filter((s) => s.kind === 'dynamic').length,
      toolModules,
      toolPrompts: tools.length,
    },
    entries,
  };
}

function serialize(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** 递归列出目录下全部文件（相对 LOCALE_ROOT，`/` 分隔） */
function listFiles(dir: string, base: string = LOCALE_ROOT): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full, base));
    } else {
      out.push(full.slice(base.length + 1).replaceAll('\\', '/'));
    }
  }
  return out;
}

function writeAll(
  sections: SectionExport[],
  tools: ToolPromptExport[],
  toolModules: number
): number {
  // C-3b：`tool-params.json` / `tool-descriptions.json` 由各自导出脚本维护，本脚本不得清理
  const expected = new Set<string>([
    'manifest.json',
    'tool-params.json',
    'tool-descriptions.json',
  ]);
  let written = 0;

  for (const s of sections) {
    if (!s.file || s.text === undefined) continue;
    const full = join(LOCALE_ROOT, s.file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, s.text, 'utf8');
    expected.add(s.file);
    written++;
  }

  for (const t of tools) {
    const full = join(LOCALE_ROOT, t.file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, t.text, 'utf8');
    expected.add(t.file);
    written++;
  }

  mkdirSync(LOCALE_ROOT, { recursive: true });
  writeFileSync(
    MANIFEST_PATH,
    serialize(buildManifest(sections, tools, toolModules)),
    'utf8'
  );

  // 清理陈旧产物（仅限生成本目录内；保证「目录 == manifest」可判定）
  for (const rel of listFiles(LOCALE_ROOT)) {
    if (!expected.has(rel)) {
      rmSync(join(LOCALE_ROOT, rel));
    }
  }

  return written;
}

function checkAll(
  sections: SectionExport[],
  tools: ToolPromptExport[],
  toolModules: number
): number {
  const problems: string[] = [];
  // C-3b：`tool-params.json` / `tool-descriptions.json` 由各自导出脚本维护，不计入本脚本的产物闭合
  const expected = new Set<string>([
    'manifest.json',
    'tool-params.json',
    'tool-descriptions.json',
  ]);

  for (const s of sections) {
    if (!s.file || s.text === undefined) continue;
    const full = join(LOCALE_ROOT, s.file);
    expected.add(s.file);
    if (!existsSync(full)) {
      problems.push(`缺失：${s.file}`);
      continue;
    }
    const actual = readFileSync(full, 'utf8');
    if (actual !== s.text) problems.push(`文本不一致：${s.file}`);
  }

  for (const t of tools) {
    const full = join(LOCALE_ROOT, t.file);
    expected.add(t.file);
    if (!existsSync(full)) {
      problems.push(`缺失：${t.file}`);
      continue;
    }
    if (readFileSync(full, 'utf8') !== t.text) {
      problems.push(`文本不一致：${t.file}`);
    }
  }

  if (!existsSync(MANIFEST_PATH)) {
    problems.push('缺失：manifest.json');
  } else {
    const expectedJson = serialize(buildManifest(sections, tools, toolModules));
    if (readFileSync(MANIFEST_PATH, 'utf8') !== expectedJson) {
      problems.push('manifest.json 与当前源文本不一致（hash/条目漂移）');
    }
  }

  for (const rel of listFiles(LOCALE_ROOT)) {
    if (!expected.has(rel)) problems.push(`多余产物：${rel}`);
  }

  if (problems.length > 0) {
    console.error(`✗ 提示词冻结导出校验失败（${problems.length} 项）：`);
    for (const p of problems) console.error(`   - ${p}`);
    return 1;
  }

  console.log(
    `✓ 提示词冻结导出一致：section ${sections.length}（static ${sections.filter((s) => s.kind === 'static').length} / dynamic ${sections.filter((s) => s.kind === 'dynamic').length}）· tool ${tools.length}（${toolModules} 模块）`
  );
  return 0;
}

const sections = await collectSections();
const tools = await collectToolPrompts();
const toolModules = new Set(tools.map((t) => t.dir)).size;

if (process.argv.includes('--check')) {
  process.exit(checkAll(sections, tools, toolModules));
}

const written = writeAll(sections, tools, toolModules);
console.log(
  `✓ 已导出 ${written} 个文本 + manifest（${LOCALE_ROOT}）：section ${sections.length} · tool ${tools.length}（${toolModules} 模块）`
);
