/**
 * 模型硬编码检查器 (Model Hardcoding Linter)
 *
 * 对应 .trae/rules/model-usage.md：
 *  - 禁止硬编码模型名/供应商名/Claude 代称/代称 env 变量
 *  - 禁止按模型名建属性表（context_window/thinking/cache 须读 DB）
 *  - 能力覆盖检查：每个 task 的必需能力必须有 enabled 模型
 *    ⚠️ 例外：**已登记「故意无模型」的 (task:capability)** 从告警中摘出并如实打印（见
 *    `INTENTIONALLY_MODEL_LESS`）—— 用于"该能力由**独立子系统**提供、不经模型路由"的场景。
 *
 * 运行：cd app && bun run lint:models（cwd = app/，项目根 = ../）
 * 实现约束：Windows 无系统 grep，全部用 Bun 内置 API（Bun.file/readdirSync/正则）。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, sep } from 'node:path';
import { homedir } from 'node:os';
import { Database } from 'bun:sqlite';

// ============ 配置 ============

/** 项目根目录（scripts/ 的父目录） */
const PROJECT_ROOT = join(import.meta.dir, '..');
/** 扫描目录 */
const SCAN_DIRS = [
  join(PROJECT_ROOT, 'app', 'src'),
  // 内核自 P4 起物理独立于 `app/src`（方案 §4-P4）⇒ 硬编码模型名同样适用
  join(PROJECT_ROOT, 'packages', 'kernel', 'src'),
  join(PROJECT_ROOT, 'client', 'src'),
];
/** 检查的文件扩展名 */
const CHECK_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
/**
 * DB 候选路径（**含运行时真实数据目录**）。
 *
 * 2026-10-16（台账 `LINTMODELS-CAPABILITY-WARN`，用户裁定「修路径 + 降为告警」）：加入
 * `~/.pyapp/data/app.db`。此前两条候选都落在**仓库内** `<root>/data/pyapp/data/app.db`，
 * 而运行时真实数据目录是 `~/.pyapp/data/`（见 `core/paths.ts` 的 `resolveDataDir()`）
 * ⇒ 本机标准布局下**恒查不到**，该子检查形同不存在。
 *
 * ⚠️ 绝对路径必须用 `isAbsolute` 直取：`join(cwd, abs)` 在 Windows 下会拼坏（实测）。
 *
 * 该子检查的**输入是用户启用的模型**（`model_registry where enabled = 1`）⇒ 语义上**本地专属**：
 * CI / 干净环境无此库 ⇒ 走「未执行」分支；且它的发现是**配置告警、不阻断**（见 `main()` 汇总）。
 */
const DB_PATHS = [
  join(homedir(), '.pyapp', 'data', 'app.db'), // 运行时真实数据目录（首选）
  'data/pyapp/data/app.db', // 兼容「数据目录随仓库布局」的部署
  '../data/pyapp/data/app.db',
];

/**
 * 已登记「**故意无模型**」的 `(task:capability)` ⇒ 从能力覆盖告警中摘出（**仍如实打印**，不静默）。
 *
 * 用途：某 task 的必需能力由**独立子系统**提供、**不经模型路由**时，模型表里当然不会有对应模型 ——
 * 这不是配置缺口，而是设计如此（见台账 `VOICE-TTS-STT-NO-MODEL-NEEDED` 的排查证据链）。
 *
 * 硬约束：**理由必须非空**（"显式且附理由"，对齐 `tests/tools/toolDataSourcesNotNewTools.test.ts`
 * 的 `NEW_TOOL_REGISTRY` 口径）—— 空理由即 `exit 1`（fail-loud，防止登记退化成万能免死金牌）；
 * 键必须是 `task:capability` 的**精确组合**，别只写 task（否则该 task 日后新增的其它要求会被**过宽豁免**）。
 *
 * ⚠️ 别用它掩盖真实配置缺口：调用方若真要某个 TTS/STT **模型**（走模型路由），必须删掉这里的登记。
 */
const INTENTIONALLY_MODEL_LESS: Readonly<Record<string, string>> = {
  'tts:text_to_speech':
    '语音合成走**独立语音子系统**（EdgeTTS 默认且免费 / OpenAI TTS / Piper / Command），' +
    '不读 model_registry ⇒ 该 task 无需模型（台账 VOICE-TTS-STT-NO-MODEL-NEEDED）',
  'stt:speech_recognition':
    '语音识别走**独立语音子系统**（SenseVoice 本地 / faster-whisper 本地 / cloudSTT），' +
    '不读 model_registry ⇒ 该 task 无需模型（台账 VOICE-TTS-STT-NO-MODEL-NEEDED）',
};

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
  // 2026-10-02 D-224 补录（**预存缺口**）：D-212 把 tiktoken 实现自 `ai/tokenizer/` 下沉到
  // `utils/TiktokenEstimator.ts`（`ai/tokenizer/TiktokenEstimator.ts` 仅剩转出）⇒ 原 `ai/tokenizer/`
  // 白名单不再覆盖实现体，`encodingForModel('gpt-4o')`（tiktoken **库 API 限制**，model-usage.md 明列为合法项）被误报。
  'utils/TiktokenEstimator.ts',
  'ai/health/ModelHealthCheck.ts',
  'ai/index.ts',
  'ai/services/aiService.ts',
  'plugin-sdk/providers/',
  // 类型枚举（providerType/per-provider 字段）
  'ai/providers/ProviderManager.ts',
  'ai/models/types.ts',
  'ai/models/ModelRegistry.ts',
  'commands/provider/',
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
  'tokenBudget/UnifiedTokenTracker.ts',
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
    pattern:
      /LIRI_DEFAULT_(?:HAIKU|OPUS|SONNET)_MODEL|ANTHROPIC_DEFAULT_(?:HAIKU|OPUS|SONNET)_MODEL|VERTEX_REGION_CLAUDE/i,
    message: 'Claude 代称环境变量名',
  },
  // 5. 模型属性硬编码表
  {
    pattern:
      /KNOWN_CONTEXT_WINDOWS|MODEL_CONTEXT_WINDOWS|CACHE_SUPPORTED_MODELS|MODEL_BUDGET_MULTIPLIERS/,
    message: '模型属性硬编码表（须读 DB context_window/capabilities）',
  },
  // 6. 业务层已知默认模型（gpt-4/deepseek-v4/dall-e/gemini 系列字面量）
  {
    pattern:
      /['"`](?:gpt-[34]|gpt-4o|deepseek-[a-z0-9.]+|dall-e-[23]|gemini-[0-9][a-z0-9.-]*|kimi|moonshot|qwen[0-9.-]*)[a-z0-9:.-]*['"`]/i,
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
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === 'dist' ||
      entry.name === '__tests__'
    )
      continue;
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
  return (
    t.startsWith('//') ||
    t.startsWith('*') ||
    t.startsWith('/*') ||
    t.startsWith('<!--')
  );
}

// ============ 能力覆盖检查 ============

interface CapabilityCheckResult {
  taskKey: string;
  capability: string;
  modelCount: number;
}

function checkCapabilityCoverage(): {
  violations: CapabilityCheckResult[];
  ok: boolean;
  note: string;
} {
  let dbPath = '';
  for (const p of DB_PATHS) {
    // 绝对路径直取（`join(cwd, abs)` 在 Windows 下会拼坏）；相对路径按 cwd 解析
    const full = isAbsolute(p) ? p : join(process.cwd(), p);
    // `existsSync` 而非 `readFileSync`：后者用于"是否存在"会**整读文件**（真实 DB 实测 129MB），
    // 且空文件会因"空串为假"被漏判。纯存在性判断 ⇒ 结论不变：不存在 ⇒ 换下一个；
    // 存在但不可用 ⇒ 由下方表结构/异常分支同样归为"跳过"。
    if (existsSync(full)) {
      dbPath = full;
      break;
    }
  }
  if (!dbPath) {
    return { violations: [], ok: true, note: 'DB 未找到，能力覆盖检查跳过' };
  }

  try {
    const db = new Database(dbPath, { readonly: true });
    // 读取列名（容错不同 schema）
    const tableInfo = db
      .query('PRAGMA table_info(task_capability_mappings)')
      .all() as Array<{ name: string }>;
    const cols = tableInfo.map((c) => c.name);
    const requiredCol =
      cols.find((c) => c.includes('required') && c.includes('capab')) ??
      cols.find((c) => c.includes('capab'));
    const taskCol = cols.find((c) => c.includes('task')) ?? cols[0];
    if (!requiredCol || !taskCol) {
      db.close();
      return {
        violations: [],
        ok: true,
        note: 'task_capability_mappings 列名未识别',
      };
    }

    const rows = db
      .query(
        `SELECT ${taskCol} AS taskKey, ${requiredCol} AS required FROM task_capability_mappings`
      )
      .all() as Array<{ taskKey: string; required: string }>;

    // 收集各能力下 enabled 模型数
    const modelRows = db
      .query('SELECT capabilities FROM model_registry WHERE enabled = 1')
      .all() as Array<{ capabilities: string }>;
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
        if (count === 0)
          violations.push({
            taskKey: row.taskKey,
            capability: cap,
            modelCount: 0,
          });
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
  const violations: Array<{
    file: string;
    line: number;
    message: string;
    raw: string;
  }> = [];

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
          violations.push({
            file: rel,
            line: i + 1,
            message: v.message,
            raw: line.trim().slice(0, 120),
          });
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

  // 已登记「故意无模型」的 (task:capability)：从告警摘出，但**如实打印豁免行**（可审计、不静默）。
  // 硬约束：理由必须非空 —— 空理由 = 登记无效（fail-loud，避免登记退化成"万能免死金牌"）。
  const badRegistry = Object.entries(INTENTIONALLY_MODEL_LESS).filter(
    ([, reason]) => !reason.trim()
  );
  if (badRegistry.length > 0) {
    console.error(
      `[lint:models] ❌ INTENTIONALLY_MODEL_LESS 存在**空理由**登记（须"显式且附理由"）：` +
        badRegistry.map(([k]) => k).join(', ')
    );
    process.exit(1);
  }
  const exempt: string[] = [];
  const unexpected: CapabilityCheckResult[] = [];
  for (const v of coverage.violations) {
    const key = `${v.taskKey}:${v.capability}`;
    if (Object.prototype.hasOwnProperty.call(INTENTIONALLY_MODEL_LESS, key)) {
      exempt.push(key);
    } else {
      unexpected.push(v);
    }
  }

  if (unexpected.length === 0) {
    if (coverage.note) {
      // ⚠️ 「未执行」不得说成「通过」（对照 architecture-compliance AR-3：不得把"没跑"当成"干净"）。
      // 该子检查的**输入是用户本机启用的模型**（`model_registry where enabled = 1`）⇒ 语义上
      // **本地专属**：CI / 干净环境里跑它只会得到"每个能力 0 个模型"的假红（除非伪造模型数据，违 CS04）。
      console.log(
        `[lint:models] ⏭️ 能力覆盖检查**未执行**（${coverage.note}）—— 该项依赖本机已启用模型，CI/干净环境不适用`
      );
    } else {
      console.log('[lint:models] ✅ 能力覆盖检查通过');
      for (const key of exempt) {
        console.log(`  ⚪ 豁免（已登记「故意无模型」）：${key}`);
      }
      // 防陈旧：**仅在真跑过时**提示（CI 的「未执行」分支下 exempt 恒空，不能据此判陈旧）
      if (exempt.length === 0) {
        console.log(
          `  ℹ️ INTENTIONALLY_MODEL_LESS 的 ${Object.keys(INTENTIONALLY_MODEL_LESS).length} 条登记当前**未命中**（该能力已有启用模型？）⇒ 可考虑移除登记`
        );
      }
    }
  } else {
    // ⚠️ **告警级（不阻断）** —— 2026-10-16 用户裁定（台账 `LINTMODELS-CAPABILITY-WARN`）：
    // 该检查的输入是**用户配置**（哪些模型 enabled）⇒ 「某能力没有启用模型」是**配置选择/缺口**，
    // 不是代码质量违规 ⇒ 不该让 `bun run ci` 与 CI 因此变红（曾实测：tts/stt 各 0 个启用模型）。
    // 但仍**如实打印**，不静默（否则等于把真实缺口藏起来）。
    console.log(
      `[lint:models] ⚠️ 能力断链 ${unexpected.length} 项（**告警，不阻断** —— 属本机模型配置缺口）：`
    );
    for (const v of unexpected) {
      console.log(
        `  task=${v.taskKey} 能力=${v.capability} 有 0 个 enabled 模型`
      );
    }
    for (const key of exempt) {
      console.log(`  ⚪ 已登记豁免（故意无模型，不计入上列）：${key}`);
    }
  }

  // 阻断项**只有**「硬编码违规」（代码质量）；能力断链为告警
  const failed = violations.length > 0;
  if (failed) {
    console.log('\n[lint:models] 结果：FAIL');
    process.exit(1);
  }
  // 汇总行后缀：把「未执行」「降级为告警」「已登记豁免」三种"非干净但通过"如实标出，
  // 避免被读成已检查且干净。
  const suffix = coverage.note
    ? `（⚠️ 能力覆盖检查未执行：${coverage.note}）`
    : unexpected.length > 0
      ? `（⚠️ 能力断链 ${unexpected.length} 项为告警，不阻断）`
      : exempt.length > 0
        ? `（⚪ 豁免 ${exempt.length} 项：已登记「故意无模型」）`
        : '';
  console.log(`[lint:models] 结果：PASS${suffix}`);
}

main();
