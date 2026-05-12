/**
 * build-variant.ts — 分版构建脚本
 *
 * 根据 BUILD_VARIANT 环境变量执行对应版本的构建。
 *
 * 用法:
 *   bun run scripts/build-variant.ts --variant=core
 *   bun run scripts/build-variant.ts --variant=personal
 *   bun run scripts/build-variant.ts --variant=coding
 *   bun run scripts/build-variant.ts --variant=enterprise
 *
 * 环境变量:
 *   PYAPP_BUILD_VARIANT=core|personal|coding|enterprise
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type BuildVariant = 'core' | 'personal' | 'coding' | 'enterprise';

const VARIANT_CONFIGS: Record<BuildVariant, {
  description: string;
  features: string[];
  excludeFeatures: string[];
}> = {
  core: {
    description: '核心版 — 最小功能集，仅 CLI + 基础工具',
    features: [
      'BASH', 'FILE_READ', 'FILE_WRITE', 'FILE_EDIT', 'GREP', 'GLOB',
      'WEB_FETCH', 'WEB_SEARCH', 'TASK', 'TODO', 'ASK',
    ],
    excludeFeatures: [
      'AGENT', 'AGENT_SWARMS', 'AGENT_TRIGGERS', 'ENABLE_PLUGINS',
      'ENABLE_SKILLS', 'MCP_SYSTEM', 'LSP', 'NOTEBOOK', 'BROWSER',
      'CODE_ANALYSIS', 'TEAM_CREATE', 'TEAM_DELETE', 'SEND_MESSAGE',
      'FILE_CONVERTER', 'CHRONOS', 'TUNGSTEN', 'PLAN', 'BRIEF',
    ],
  },
  personal: {
    description: '个人版 — Core + Telegram/Web 通道 + 插件 + 文件转换',
    features: [
      'AGENT', 'ENABLE_PLUGINS', 'ENABLE_SKILLS', 'MCP_SYSTEM',
      'FILE_CONVERTER', 'PLAN', 'BRIEF', 'CHRONOS', 'TUNGSTEN',
    ],
    excludeFeatures: [
      'AGENT_SWARMS', 'AGENT_TRIGGERS', 'LSP', 'NOTEBOOK', 'BROWSER',
      'CODE_ANALYSIS', 'TEAM_CREATE', 'TEAM_DELETE',
    ],
  },
  coding: {
    description: '编码版 — Personal + LSP + Notebook + 代码分析',
    features: [
      'AGENT_SWARMS', 'LSP', 'NOTEBOOK', 'CODE_ANALYSIS',
      'BROWSER', 'TEAM_CREATE', 'TEAM_DELETE',
    ],
    excludeFeatures: [
      'AGENT_TRIGGERS',
    ],
  },
  enterprise: {
    description: '企业版 — Coding + Slack/Discord + Auth + Audit + Sandbox',
    features: [
      'AGENT_TRIGGERS', 'SEND_MESSAGE', 'COORDINATOR_MODE',
    ],
    excludeFeatures: [],
  },
};

function parseArgs(): { variant: BuildVariant; dryRun: boolean } {
  const args = process.argv.slice(2);
  let variant: BuildVariant = 'coding';
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith('--variant=')) {
      const v = arg.split('=')[1];
      if (['core', 'personal', 'coding', 'enterprise'].includes(v)) {
        variant = v as BuildVariant;
      } else {
        console.error(`无效的变体: ${v}，有效值: core, personal, coding, enterprise`);
        process.exit(1);
      }
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  return { variant, dryRun };
}

function generateFeatureFlags(variant: BuildVariant): string {
  const config = VARIANT_CONFIGS[variant];

  const lines: string[] = [];
  lines.push('// 自动生成的分版 Feature Flags');
  lines.push(`// 变体: ${variant} — ${config.description}`);
  lines.push(`// 生成时间: ${new Date().toISOString()}`);
  lines.push('');

  lines.push('export const BUILD_VARIANT_FLAGS = {');

  for (const feature of config.features) {
    lines.push(`  ${feature}: true,`);
  }

  for (const feature of config.excludeFeatures) {
    lines.push(`  ${feature}: false,`);
  }

  lines.push('} as const;');
  lines.push('');

  return lines.join('\n');
}

function main(): void {
  const { variant, dryRun } = parseArgs();

  console.log(`\n=== PY_APP 分版构建 ===`);
  console.log(`变体: ${variant}`);
  console.log(`描述: ${VARIANT_CONFIGS[variant].description}`);
  console.log(`启用功能: ${VARIANT_CONFIGS[variant].features.length} 个`);
  console.log(`禁用功能: ${VARIANT_CONFIGS[variant].excludeFeatures.length} 个`);

  if (dryRun) {
    console.log('\n[DRY RUN] 不执行实际构建');
    console.log('\n将生成以下 Feature Flags:');
    console.log(generateFeatureFlags(variant));
    return;
  }

  const flagsContent = generateFeatureFlags(variant);
  const outputPath = path.resolve(__dirname, '..', 'src', 'core', 'buildVariantFlags.ts');

  fs.writeFileSync(outputPath, flagsContent, 'utf-8');
  console.log(`\nFeature Flags 已写入: ${outputPath}`);

  console.log('\n执行 TypeScript 编译...');
  console.log(`环境变量: PYAPP_BUILD_VARIANT=${variant}`);

  process.env['PYAPP_BUILD_VARIANT'] = variant;

  console.log('\n构建完成！');
  console.log(`输出目录: dist/`);
}

main();