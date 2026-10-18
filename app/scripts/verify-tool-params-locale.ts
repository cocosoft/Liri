#!/usr/bin/env bun
/**
 * C-3b（2026-10-18）—— **en-US 参数译文生效取证**（零模型调用、可复跑）。
 *
 * 验证链路（与生产同路径）：
 *   独立临时配置 → `language=en-US` → `resolveConfiguredLanguage()` →
 *   `ToolRegistry.getToolSchemas()` → `resolveToolParam()` → `prompts/en-US/tool-params.json`
 *
 * 为什么需要它：单测已覆盖「配置优先/缓存兜底」的判定，但未在**真实配置实例**下证明
 * 模型侧 schema 真的取到英文；本脚本用隔离配置目录（不碰 `~/.pyapp/config.json`）
 * 跑真实工具池，逐条对照 en-US / zh-CN 资源。
 *
 * 用法（app 目录下）：`bun run evidence:tool-params-locale`
 * 退出码：0 = 全部命中英文；1 = 任一 key 未生效或与资源不一致。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigManager, setConfigManagerForTest } from '@modules/config';

import { resolveConfiguredLanguage } from '../src/system/i18n/languageProfiles';
import { ToolRegistry } from '../src/tools/ToolRegistry';
import { ToolFactory } from '../src/tools/ToolFactory';
import {
  getAllBuiltinToolLoaders,
  loadTools,
} from '../src/tools/utils/ToolManagerUtils';

interface ToolParamsFile {
  params: Record<string, string>;
}

function loadParams(locale: 'zh-CN' | 'en-US'): Record<string, string> {
  const path = join(
    import.meta.dir,
    '..',
    'prompts',
    locale,
    'tool-params.json'
  );
  return (JSON.parse(readFileSync(path, 'utf-8')) as ToolParamsFile).params;
}

function main(): number {
  const dir = mkdtempSync(join(tmpdir(), 'pyapp-c3b-locale-'));
  try {
    const manager = new ConfigManager(join(dir, 'config.json'));
    manager.setConfigValue('language', 'en-US');
    setConfigManagerForTest(manager);

    const resolved = resolveConfiguredLanguage();
    console.log('=== C-3b en-US 参数译文生效取证 ===');
    console.log(
      `隔离配置 language=en-US ⇒ resolveConfiguredLanguage()=${resolved ?? '(空)'}`
    );
    if (resolved !== 'en-US') {
      console.error('语言解析未返回 en-US（配置未生效）');
      return 1;
    }

    const tools = loadTools(new ToolFactory(), getAllBuiltinToolLoaders());
    const registry = new ToolRegistry();
    for (const tool of tools) registry.registerTool(tool);
    const schemas = registry.getToolSchemas();

    const en = loadParams('en-US');
    const zh = loadParams('zh-CN');
    let checked = 0;
    const failures: string[] = [];
    const keys = Object.keys(en);

    for (const key of keys) {
      const actual = findDescriptionByKey(schemas, key);
      const expected = en[key];
      if (!expected) {
        failures.push(`${key}: en-US 资源缺值`);
        continue;
      }
      if (actual === undefined) {
        failures.push(`${key}: schema 中无对应参数（资源键失效）`);
        continue;
      }
      if (actual !== expected) {
        failures.push(
          `${key}: schema=${JSON.stringify(actual)} ≠ en-US=${JSON.stringify(expected)}`
        );
        continue;
      }
      // 抽样打印前 5 条，其余只计数（避免刷屏）
      if (checked < 5) {
        const differs = zh[key] !== expected;
        console.log(
          `  ✓ ${key}${differs ? '（与 zh-CN 不同）' : '（两种语言同值）'} ⇒ ${expected.slice(0, 70)}`
        );
      }
      checked++;
    }

    if (failures.length > 0) {
      console.error(`\n✗ ${failures.length} 项未生效：`);
      for (const failure of failures.slice(0, 20))
        console.error(`   - ${failure}`);
      return 1;
    }
    console.log(
      `\n✓ 全部 ${checked}/${keys.length} 个参数键命中 en-US 资源（含嵌套 items 字段）`
    );

    // ── 全 schema 中文残留扫描 ──
    // 两类都必须在 en-US 下为 **0**：
    // ① **参数级**（`<tool>.input_schema…description`）—— C-3b 资源（`tool-params.json`）；
    // ② **工具级**（`<tool>.description`）—— T2 资源（`tool-descriptions.json`，
    //    由 `export-tool-descriptions.ts` 维护、`getToolSchemas()` 单点替换）。
    // 判据排除 VFS/URL 标识符中的中文（挂载名是 T1，禁译）。
    const scan = scanDescriptions(schemas);
    const paramLeaks = scan.descriptions.filter(
      (item) => item.scope === 'param' && hasUntranslatedCjk(item.text)
    );
    const toolLeaks = scan.descriptions.filter(
      (item) => item.scope === 'tool' && hasUntranslatedCjk(item.text)
    );
    console.log(
      `\n=== 全 schema description 扫描：${scan.total} 处 ===` +
        `（参数级中文残留 ${paramLeaks.length} / 工具级中文 ${toolLeaks.length}）`
    );
    if (paramLeaks.length > 0) {
      console.error(
        '✗ 参数级描述未走 en-US 资源（补 app/prompts/en-US/tool-params.json）：'
      );
      for (const item of paramLeaks) {
        console.error(`   - ${item.path}: ${item.text.slice(0, 80)}`);
      }
    }
    if (toolLeaks.length > 0) {
      console.error(
        '✗ 工具级描述未走 en-US 资源（先 `bun run scripts/export-tool-descriptions.ts`，再补译文）：'
      );
      for (const item of toolLeaks) {
        console.error(`   - ${item.path}: ${item.text.slice(0, 80)}`);
      }
    }
    if (paramLeaks.length > 0 || toolLeaks.length > 0) return 1;

    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 中文字符（CJK 统一表意文字）—— 英文模式下 description 不应出现 */
const CJK_RE = /[\u4e00-\u9fff]/;

/**
 * VFS / URL 形态的**标识符**（如 `dev_docs://配置与安全/sandbox.md`）。
 *
 * 其 authority 是**运行时挂载名**（T1 标识，禁译），可能本身含中文 ⇒ 判中文残留前先剔除，
 * 避免把「合法的资源路径」误判成「未翻译文案」。
 */
const VFS_PATH_RE = /[a-zA-Z][\w+.-]*:\/\/\S*/g;

/** 是否残留**未翻译的中文文案**（已排除 VFS/URL 标识符中的中文） */
function hasUntranslatedCjk(text: string): boolean {
  return CJK_RE.test(text.replace(VFS_PATH_RE, ''));
}

interface DescriptionHit {
  /** `<tool>.<path>`；工具级为 `<tool>.description` */
  path: string;
  /** `tool` = 工具级描述（T2）；`param` = 参数级描述（C-3b） */
  scope: 'tool' | 'param';
  text: string;
}

/**
 * 递归收集 schema 中**所有** `description`（任意深度），用于发现解析链未接管的位置。
 * 只收集字符串值；`description` 之外的同名字段（如用户给的 enum）不误判。
 */
function scanDescriptions(
  schemas: ReturnType<ToolRegistry['getToolSchemas']>
): { total: number; descriptions: DescriptionHit[] } {
  const descriptions: DescriptionHit[] = [];
  let total = 0;

  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(
      node as Record<string, unknown>
    )) {
      if (key === 'description' && typeof value === 'string') {
        total++;
        const fullPath = `${path}.${key}`;
        descriptions.push({
          path: fullPath,
          scope: /^[^.]+\.description$/.test(fullPath) ? 'tool' : 'param',
          text: value,
        });
        continue;
      }
      walk(value, `${path}.${key}`);
    }
  };

  for (const schema of schemas) walk(schema, schema.name);
  return { total, descriptions };
}

/** 按 `<tool>.<path>` 从 schema 里取描述（独立实现，避免依赖被测函数） */
function findDescriptionByKey(
  schemas: ReturnType<ToolRegistry['getToolSchemas']>,
  key: string
): string | undefined {
  const [toolName, ...segments] = key.split('.');
  const schema = schemas.find((s) => s.name === toolName);
  if (!schema) return undefined;

  const props = schema.input_schema.properties as Record<
    string,
    Record<string, unknown>
  >;
  const [paramName, ...rest] = segments;
  const param = props?.[paramName];
  if (!param) return undefined;
  if (rest.length === 0) return param.description as string | undefined;

  const items = param.items as Record<string, unknown> | undefined;
  if (rest[0] === 'items' && rest.length === 1) {
    return items?.description as string | undefined;
  }
  if (rest[0] === 'items' && rest.length === 2) {
    const itemProps = items?.properties as
      | Record<string, Record<string, unknown>>
      | undefined;
    return itemProps?.[rest[1]]?.description as string | undefined;
  }
  return undefined;
}

process.exit(main());
