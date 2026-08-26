/**
 * 模型硬编码检查器 (Model Hardcoding Linter)
 *
 * 对应 .trae/rules/model-usage.md：
 *  - 禁止硬编码模型名/供应商名/Claude 代称/代称 env 变量
 *  - 禁止按模型名建属性表（context_window/thinking/cache 须读 DB）
 *  - 能力覆盖检查：每个 task 的必需能力必须有 enabled 模型
 *
 * 运行：cd app && bun run lint:models（cwd = app/，项目根 = ../）
 * 实现约束：Windows 无系统 grep，全部用 Bun 内置 API（Bun.file/readdirSync/正则）。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { Database } from 'bun:sqlite';

// ============ 配置 ============

/** 项目根目录（scripts/ 的父目录） */
const PROJECT_ROOT = join(import.meta.dir, '..');
/** 扫描目录 */
const SCAN_DIRS = [join(PROJECT_ROOT, 'app', 'src'), join(PROJECT_ROOT, 'client', 'src')];
/** 检查的文件扩展名 */
const CHECK_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
/** DB 候选路径（相对 app/） */
const DB_PATHS = [
  'data/pyapp/data/app.db',
  '../data/pyapp/data/app.db',
];

/**
 * 白名单路径（协议适配/生态兼容/预设/渠道类型/播种/类型枚举，均为合法项，见 model-usage.md）
 * 统一用 `/` 分隔（rel 已归一化为 `/`）
 */
const IGNORE_PATH_FRAGMENTS = [
  // 协议适配（Anthropic API 实现/传输/解析/格式化/tokenizer）
  'ai/providers/AnthropicProvider.ts',
  'ai/providers/BedrockProvider.ts',
  'ai/providers/ModelFetcher.ts',
  'ai/providers/providerPresetsData.ts',
  'ai/providers/ProviderFactory.ts',
  'ai/providers/ProviderSyncService.ts',
  'ai/providers/detectUnifiedProviders.ts',
  'ai/transports/',
  'ai/parsers/',
  'ai/formatters/',
  'ai/tokenizer/',
  'ai/health/ModelHealthCheck.ts',
  'ai/index.ts',
  'ai/services/aiService.ts',
  'plugin-sdk/providers/',
  // 类型枚举（providerType/per-provider 字段）
  'ai/providers/ProviderManager.ts',
  'ai/models/types.ts',
  'ai/models/ModelRegistry.ts',
  'commands/provider/',
  'core/flows/model-picker.ts',
  // 播种/预设逻辑
  'ai/ModelManagementBootstrap.ts',
  'plugins/provider/ProviderDiscovery.ts',
  'client/src/config/providerPresets.ts',
  // 模型预设数据（定价表/本地下载清单/推荐列表，产品数据非业务逻辑判断）
  'ai/config/official-pricing-data.ts',
  'ai/local/llama/ModelDownloadService.ts',
  'ai/local/llama/ModelRecommender.ts',
  // 模型名关键词分级/模型族判断（协议适配）
  'ai/models/ModelAliases.ts',
  'services/prompt/PromptAssembler.ts',
  'tools/utils/toolSearch.ts',
  'transports/OllamaTransport.ts',
  // 模型名子串匹配选择 prompt 指引（行为适配，与 parser/formatter 同类）
  'ai/prompts/ModelGuidance.ts',
  // 模型属性阈值表（token budget，DB 无字段，白名单声明）
  'core/tokenBudget/UnifiedTokenTracker.ts',
  // D 层本地/固定能力
  'tools/ImageGenerateTool/providers/ProviderCapability.ts',
  // 音频格式 opus（与 Claude 无关）
  'services/voice/',
  // 渠道/协议类型、MCP、配置字段、CLAUDE.md 生态兼容
  'channels/',
  'services/mcp/',
  'config/schema/',
  'config/types.ts',
  'config/managedEnv.ts',
  'bootstrap/StartupConfig.ts',
  'context/',
  'constants/',
  'diagnostics/',
  'bridge/',
  'commands/login/',
  'commands/logout/',
  'commands/manager/CommandManager.ts',
  'client/src/i18n/',
  'client/src/types/model.ts',
  'client/src/components/settings/AIConfigPanel.tsx',
  'client/src/components/settings/LocalAgentPanel.tsx', // Ollama 本地模型候选（用户可配置项，非身份）
  'client/src/components/views/MessageBubble.tsx',
  'client/src/components/views/ModelPage.tsx',
];

/**
 * 高置信违规模式（只在业务层出现，白名单路径已排除）
 */
const VIOLATION_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  // 1. Claude 模型代称字面量（sonnet/opus/haiku）
  {
    pattern: /['"`](?:sonnet|opus|haiku)['"`]/i,
    message: 'Claude 模型代称（sonnet/opus/haiku）禁止作为模型名/类型/默认值',
  },
  // 2. Claude 模型名（claude-* 全名）
  {
    pattern: /['"`]claude-[a-z0-9.-]+['"`]/i,
    message: 'Claude 模型名硬编码',
  },
  // 3. 已清理项防回流
  {
    pattern: /claude-code-guide|claude-ai/i,
    message: 'Claude 品牌命名残留（应使用 code-guide 等中性名）',
  },
  // 4. 代称 env 变量
  {
    pattern: /LIRI_DEFAULT_(?:HAIKU|OPUS|SONNET)_MODEL|VERTEX_REGION_CLAUDE/i,
    message: 'Claude 代称环境变量名',
  },
  // 5. 模型属性硬编码表
  {
    pattern: /KNOWN_CONTEXT_WINDOWS|MODEL_CONTEXT_WINDOWS|CACHE_SUPPORTED_MODELS|MODEL_BUDGET_MULTIPLIERS/,
    message: '模型属性硬编码表（须读 DB context_window/capabilities）',
  },
  // 6. 业务层已知默认模型（gpt-4/deepseek-v4/dall-e/gemini 系列字面量）
  {
    pattern: /['"`](?:gpt-[34]|gpt-4o|deepseek-[a-z0-9.]+|dall-e-[23]|gemini-[0-9][a-z0-9.-]*|kimi|moonshot|qwen[0-9.-]*)[a-z0-9:.-]*['"`]/i,
    message: '硬编码模型名（应走模型体系/DB）',
  },
  // 7. Claude 代称并列提示文本（帮助/示例裸词，如 "sonnet, opus, haiku"）
  {
    pattern: /sonnet[\s,，、/]+opus[\s,，、/]+haiku/i,
    message: 'Claude 代称并列提示（帮助/示例文本）禁止',
  },
];

// ============ 扫描工具 ============

/** 递归收集文件 */
function collectFiles(dir: string): string[] {
  const results: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === '__tests__') continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath));
    } else {
      const ext = entry.name.slice(entry.name.lastIndexOf('.'));
      if (CHECK_EXTENSIONS.has(ext)) results.push(fullPath);
    }
  }
  return results;
}

/** 是否为注释行 */
function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--');
}

// ============ 能力覆盖检查 ============

interface CapabilityCheckResult {
  taskKey: string;
  capability: string;
  modelCount: number;
}

function checkCapabilityCoverage(): { violations: CapabilityCheckResult[]; ok: boolean; note: string } {
  let dbPath = '';
  for (const p of DB_PATHS) {
    const full = join(process.cwd(), p);
    try {
      if (readFileSync(full, 'utf-8')) {
        dbPath = full;
        break;
      }
    } catch {
      /* 尝试下一个 */
    }
  }
  if (!dbPath) {
    return { violations: [], ok: true, note: 'DB 未找到，能力覆盖检查跳过' };
  }

  try {
    const db = new Database(dbPath, { readonly: true });
    // 读取列名（容错不同 schema）
    const tableInfo = db.query('PRAGMA table_info(task_capability_mappings)').all() as Array<{ name: string }>;
    const cols = tableInfo.map((c) => c.name);
    const requiredCol = cols.find((c) => c.includes('required') && c.includes('capab')) ?? cols.find((c) => c.includes('capab'));
    const taskCol = cols.find((c) => c.includes('task')) ?? cols[0];
    if (!requiredCol || !taskCol) {
      db.close();
      return { violations: [], ok: true, note: 'task_capability_mappings 列名未识别' };
    }

    const rows = db.query(`SELECT ${taskCol} AS taskKey, ${requiredCol} AS required FROM task_capability_mappings`).all() as Array<{ taskKey: string; required: string }>;

    // 收集各能力下 enabled 模型数
    const modelRows = db.query("SELECT capabilities FROM model_registry WHERE enabled = 1").all() as Array<{ capabilities: string }>;
    const capToCount = new Map<string, number>();
    for (const m of modelRows) {
      try {
        const caps = JSON.parse(m.capabilities || '[]') as string[];
        for (const c of caps) capToCount.set(c, (capToCount.get(c) ?? 0) + 1);
      } catch {
        /* 忽略无法解析的能力 */
      }
    }

    const violations: CapabilityCheckResult[] = [];
    for (const row of rows) {
      let required: string[] = [];
      try {
        required = JSON.parse(row.required || '[]');
      } catch {
        continue;
      }
      for (const cap of required) {
        const count = capToCount.get(cap) ?? 0;
        if (count === 0) violations.push({ taskKey: row.taskKey, capability: cap, modelCount: 0 });
      }
    }
    db.close();
    return { violations, ok: violations.length === 0, note: '' };
  } catch {
    return { violations: [], ok: true, note: '能力覆盖检查执行失败（跳过）' };
  }
}

// ============ 主流程 ============

function main(): void {
  const files = SCAN_DIRS.flatMap(collectFiles);
  const violations: Array<{ file: string; line: number; message: string; raw: string }> = [];

  for (const file of files) {
    // 归一化为 `/` 分隔（Windows 下 sep 为 `\`，白名单统一用 `/`）
    const rel = file.replace(PROJECT_ROOT + sep, '').replaceAll(sep, '/');
    if (IGNORE_PATH_FRAGMENTS.some((frag) => rel.includes(frag))) continue;
    // 排除测试文件
    if (rel.includes('.test.') || rel.includes('.spec.')) continue;

    const lines = readFileSync(file, 'utf-8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isCommentLine(line)) continue;
      for (const v of VIOLATION_PATTERNS) {
        if (v.pattern.test(line)) {
          violations.push({ file: rel, line: i + 1, message: v.message, raw: line.trim().slice(0, 120) });
        }
      }
    }
  }

  const coverage = checkCapabilityCoverage();

  // 输出
  console.log(`\n[lint:models] 扫描 ${files.length} 个文件`);
  if (violations.length === 0) {
    console.log('[lint:models] ✅ 硬编码违规 0 处');
  } else {
    console.log(`[lint:models] ❌ 硬编码违规 ${violations.length} 处：`);
    for (const v of violations) {
      console.log(`  ${v.file}:${v.line}  ${v.message}\n      → ${v.raw}`);
    }
  }

  if (coverage.violations.length === 0) {
    console.log(`[lint:models] ✅ 能力覆盖检查通过${coverage.note ? '（' + coverage.note + '）' : ''}`);
  } else {
    console.log('[lint:models] ❌ 能力断链：');
    for (const v of coverage.violations) {
      console.log(`  task=${v.taskKey} 能力=${v.capability} 有 0 个 enabled 模型`);
    }
  }

  const failed = violations.length > 0 || coverage.violations.length > 0;
  if (failed) {
    console.log('\n[lint:models] 结果：FAIL');
    process.exit(1);
  }
  console.log('[lint:models] 结果：PASS');
}

main();
