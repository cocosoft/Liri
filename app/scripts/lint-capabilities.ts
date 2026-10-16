/**
 * lint-capabilities.ts — **能力声明静态一致性门禁**
 * （`app/src/ai/config/capabilities.default.yaml` ↔ 代码 `TaskType`）
 *
 * **由来**：台账 `LINTMODELS-CAPABILITY-SCOPE` 的 reopenWhen ② ——「若仍要覆盖这一潜在问题，
 * 应另立一个**按 tracked 事实源（`capabilities.default.yaml`）做静态一致性检查**的门禁，
 * 而不是复活 `lint:models` 的能力覆盖子检查」。
 *
 * **为什么它能进 CI**（与 `lint:models` 的「能力覆盖」子检查相反，见台账
 * `LINTMODELS-CAPABILITY-WARN`）：其输入**全部落在 tracked 域**（YAML + 代码常量），
 * 不读 `~/.pyapp` 的用户数据 ⇒ 不存在「CI 里只得到假红、除非伪造数据（违 CS04）」的问题，
 * 故本地与 CI 给出**同一结论**。
 *
 * **校验的七条关系（全部 ERROR，必须为 0）**：
 *   C1 `taskMappings[].taskType`        ⊆ 代码 `ALL_TASK_TYPES`（运行时权威）
 *   C2 `taskMappings[]` required ∪ optional ⊆ `capabilities[].key`
 *   C3 `capabilities[].taskTypes[]`     ⊆ 代码 `ALL_TASK_TYPES`
 *   C4 `capabilities[].dependencies[]`  ⊆ `capabilities[].key`
 *   C5 `capabilities[].category`        ∈ `categories[].key`
 *   C6 唯一性：能力 key · 任务 taskType · 分类内 sortOrder · 任务 sortOrder
 *   C7 代码 `ALL_TASK_TYPES` 的**每个**任务类型都有 `taskMappings` 行（≠ 漏登记）
 *
 * C7 的由来：缺映射时 `CapabilityService.validateTaskAssignment()` 直接返回
 * `mapping_not_found`（「未找到任务类型 X 的能力映射」）⇒ 用户在"任务分工"里看到**告警但功能仍可用**
 * 的**静默半失效**（与 `capability-task-mapping-unify.md` 的「taskMappings 覆盖全部 19 个 task」同源）。
 * C1 与 C7 合起来即两个集合**相等**：代码侧新增任务类型而未登记 ⇒ 立即变红，而不是等到用户看到告警。
 *
 * **有意不校验**（如实边界）：`capabilities[].taskTypes` 与 `taskMappings[]` 的
 * `required/optionalCapabilities` 之间的**双向包含**关系。两者**粒度不同**：
 *   · `taskMappings[]` = **路由必需集**（`CapabilityService.checkTaskCapability` 的硬门槛，最小集）；
 *   · `capabilities[].taskTypes` = **能力适用面描述**（该能力可用于哪些任务，描述性、UI 展示）。
 * 实测（2026-10-16 度量探针）按「双向相等」校验会产出 **12 条**所谓"违规"，但它们**不是缺陷**
 * —— 例：`chat` 的必需集只有 `streaming/function_calling/tool_use`（+可选 `vision`），
 * 而 **15 个**能力都声明"可用于 chat"。收进本门禁只会制造噪声，并诱使真实判据被削弱。
 *
 * **已知边界（不隐瞒）**：本门禁只校验 **YAML（播种源）**。
 * `CapabilityService.mergeYamlToDatabase()` 的播种是**一次性**的（行已存在即 `continue`，
 * 保留用户覆盖）⇒ 存量 DB 的 `model_capabilities.task_types` 列**不会**因本文件被改写而回溯更新。
 * 该列**无路由消费者**（路由读 `task_capability_mappings`），仅经 API/UI 展示。
 *
 * 运行：cd app && bun run lint:capabilities（cwd = app/）
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { ALL_TASK_TYPES } from '../src/ai/modelRouter';

const HERE = dirname(fileURLToPath(import.meta.url)); // app/scripts
const APP_DIR = resolve(HERE, '..'); // app
const YAML_PATH = join(
  APP_DIR,
  'src',
  'ai',
  'config',
  'capabilities.default.yaml'
);

/** YAML 形态（只声明本门禁读到的字段） */
export interface CapabilityDoc {
  categories?: Array<{ key: string; sortOrder?: number }>;
  capabilities?: Array<{
    key: string;
    category?: string;
    taskTypes?: string[];
    dependencies?: string[];
    sortOrder?: number;
  }>;
  taskMappings?: Array<{
    taskType: string;
    requiredCapabilities?: string[];
    optionalCapabilities?: string[];
    sortOrder?: number;
  }>;
}

/** 一条不一致（`rule` 为规则号，`detail` 为可读定位） */
export interface CapabilityIssue {
  rule: 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7';
  detail: string;
}

/** 重复项（保留第 2 次及以后的出现，便于定位） */
function duplicates(values: string[]): string[] {
  return values.filter((v, i) => values.indexOf(v) !== i);
}

/**
 * 纯函数判据（供门禁自证 / 负向夹具复用）：返回全部不一致项。
 *
 * @param doc       已解析的 `capabilities.default.yaml`
 * @param taskTypes 运行时权威任务类型（`ALL_TASK_TYPES`）
 */
export function checkCapabilityConsistency(
  doc: CapabilityDoc,
  taskTypes: readonly string[]
): CapabilityIssue[] {
  const issues: CapabilityIssue[] = [];
  const codeTasks = new Set<string>(taskTypes);
  const caps = doc.capabilities ?? [];
  const mappings = doc.taskMappings ?? [];
  const categories = doc.categories ?? [];

  const capKeys = new Set(caps.map((c) => c.key));
  const catKeys = new Set(categories.map((c) => c.key));

  // C1 / C2 / C6（任务映射侧）
  for (const m of mappings) {
    if (!codeTasks.has(m.taskType)) {
      issues.push({
        rule: 'C1',
        detail: `taskMappings.taskType「${m.taskType}」不在代码 ALL_TASK_TYPES 内`,
      });
    }
    for (const cap of [
      ...(m.requiredCapabilities ?? []),
      ...(m.optionalCapabilities ?? []),
    ]) {
      if (!capKeys.has(cap)) {
        issues.push({
          rule: 'C2',
          detail: `taskMappings「${m.taskType}」引用了未定义能力「${cap}」`,
        });
      }
    }
  }

  // C3 / C4 / C5 / C6（能力侧）
  for (const c of caps) {
    for (const t of c.taskTypes ?? []) {
      if (!codeTasks.has(t)) {
        issues.push({
          rule: 'C3',
          detail: `能力「${c.key}」的 taskTypes 含「${t}」，不在代码 ALL_TASK_TYPES 内`,
        });
      }
    }
    for (const d of c.dependencies ?? []) {
      if (!capKeys.has(d)) {
        issues.push({
          rule: 'C4',
          detail: `能力「${c.key}」依赖未定义能力「${d}」`,
        });
      }
    }
    if (c.category !== undefined && !catKeys.has(c.category)) {
      issues.push({
        rule: 'C5',
        detail: `能力「${c.key}」的 category「${c.category}」未在 categories 中定义`,
      });
    }
  }

  // C7：代码侧任务类型必须都有映射行（缺失 ⇒ validateTaskAssignment 报 mapping_not_found）
  const mapped = new Set(mappings.map((m) => m.taskType));
  for (const t of taskTypes) {
    if (!mapped.has(t)) {
      issues.push({
        rule: 'C7',
        detail: `代码任务类型「${t}」在 taskMappings 中**无映射行**（该 task 的能力门槛将缺失）`,
      });
    }
  }

  // C6 唯一性（DB 侧同为唯一约束：能力 key = PRIMARY KEY、task_type = UNIQUE
  // ⇒ YAML 里出现重复，播种时必有一条被静默忽略）
  for (const key of duplicates(caps.map((c) => c.key))) {
    issues.push({ rule: 'C6', detail: `能力 key「${key}」重复` });
  }
  for (const t of duplicates(mappings.map((m) => m.taskType))) {
    issues.push({ rule: 'C6', detail: `taskMappings.taskType「${t}」重复` });
  }
  for (const cat of categories) {
    const orders = caps
      .filter((c) => c.category === cat.key)
      .map((c) => String(c.sortOrder));
    for (const o of duplicates(orders)) {
      issues.push({
        rule: 'C6',
        detail: `分类「${cat.key}」内 sortOrder ${o} 重复`,
      });
    }
  }
  for (const o of duplicates(mappings.map((m) => String(m.sortOrder)))) {
    issues.push({ rule: 'C6', detail: `taskMappings.sortOrder ${o} 重复` });
  }

  return issues;
}

/** 真源 YAML 的绝对路径（`app/src/ai/config/capabilities.default.yaml`） */
export const CAPABILITIES_YAML_PATH = YAML_PATH;

/** 读取并解析真源 YAML（解析失败**抛出** —— 由调用方决定 fail-closed 行为） */
export function loadCapabilityDoc(path = YAML_PATH): CapabilityDoc {
  return yaml.load(readFileSync(path, 'utf8')) as CapabilityDoc;
}

function main(): number {
  if (!existsSync(YAML_PATH)) {
    // fail-closed：真源缺失**不得**静默当作"0 违规"（对照 architecture-compliance AR-3）
    console.error(
      `[lint:capabilities] ❌ 真源文件不存在，无法校验：${YAML_PATH}\n` +
        '  （fail-closed：不得把"没跑"当成"干净"）'
    );
    return 1;
  }

  let doc: CapabilityDoc;
  try {
    doc = loadCapabilityDoc();
  } catch (error) {
    console.error(
      `[lint:capabilities] ❌ YAML 解析失败：${YAML_PATH}\n  ${String(error)}`
    );
    return 1;
  }

  const issues = checkCapabilityConsistency(doc, ALL_TASK_TYPES);

  console.log(
    `[lint:capabilities] 能力 ${doc.capabilities?.length ?? 0} · ` +
      `分类 ${doc.categories?.length ?? 0} · ` +
      `任务映射 ${doc.taskMappings?.length ?? 0} · ` +
      `代码任务类型 ${ALL_TASK_TYPES.length}（C1–C7 静态一致性）`
  );
  // 有意不校验的关系：如实标出，避免被读成"已全覆盖"
  console.log(
    '  ℹ️ 有意不校验：capabilities[].taskTypes ↔ taskMappings.required 的**双向包含**（两者粒度不同，见脚本头注）'
  );

  if (issues.length > 0) {
    console.error(`[lint:capabilities] ❌ 不一致 ${issues.length} 处：`);
    for (const issue of issues) {
      console.error(`  [${issue.rule}] ${issue.detail}`);
    }
    console.error(
      `  → 修法：以代码 ALL_TASK_TYPES（app/src/ai/modelRouter.ts 的 TaskType）与\n` +
        `     capabilities[].key 为权威，订正 ${YAML_PATH} 的声明。`
    );
    console.log('[lint:capabilities] 结果：FAIL');
    return 1;
  }

  console.log('[lint:capabilities] ✅ C1–C7 全部一致');
  console.log('[lint:capabilities] 结果：PASS');
  return 0;
}

// 仅**直接运行**时执行（被测试 import 时不触发 ⇒ 便于复用纯判据做门禁自证）
if (import.meta.main) {
  process.exit(main());
}
