/**
 * 自主触发策略配置（P33-a，2026-11-02）
 *
 * 方案：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 **P33-a**。
 *
 * 三条纪律：
 * 1. **复用现有配置栈**（`config.json` + `managed-settings.json` 覆盖），不新建 DB 表；
 * 2. 缺省 `enabled=false` ⇒ 不判定、不记录、行为与改造前逐字一致；
 * 3. 非法配置 **fail-closed** 为 `enabled=false, acceptMode='off'`，不静默猜。
 *
 * 本文件只做"读取 + 校验 + 版本派生"，不做判定（判定见 `gate.ts`）。
 */
import { configManager } from '@openliri/infra/config';
import { getLogger } from '@openliri/infra/monitoring';
import {
  buildPolicyVersion,
  type AcceptMode,
  type AdmissionCell,
  type AdmissionDecision,
  type AdmissionTable,
  type AutonomyPolicyConfig,
  type AutonomyPolicyRule,
} from '@openliri/infra/permission';

const logger = getLogger('tasks:autonomy-policy');

const ACCEPT_MODES: readonly AcceptMode[] = ['off', 'observe', 'auto'];
const ADMISSION_CELLS: readonly AdmissionCell[] = [
  'listedUnaddressed',
  'unlistedAddressed',
  'unlistedUnaddressed',
];
const ADMISSION_DECISIONS: readonly AdmissionDecision[] = [
  'explicit',
  'inferred',
  'ignore',
];

/** 缺省策略：总开关关、模式 observe（开启后也只记录，不接单） */
export const DEFAULT_AUTONOMY_POLICY: AutonomyPolicyConfig = {
  enabled: false,
  acceptMode: 'observe',
  // D1（2026-11-14）：`external` = 外部系统推送（webhook / GitHub issue / 邮件轮询），
  // 默认**关** —— 开启前该来源不注册、入站端点回 503（零行为变更）。
  sources: {
    alwayson: true,
    cron: true,
    dream: false,
    fs: false,
    external: false,
  },
  admission: {},
  rules: [],
  allowlist: { senders: [], bots: [] },
  filters: { threadPrefixes: [], workspaceIds: [] },
};

/** 一份策略的来源（`policySettings` = 企业托管） */
export interface AutonomyPolicyReadResult {
  value: unknown;
  source: string;
}

/** 加载结果：配置 + 来源 + 派生版本 + 校验问题 */
export interface LoadedAutonomyPolicy {
  config: AutonomyPolicyConfig;
  source: string;
  policyId: string;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringArray(
  value: unknown,
  field: string,
  errors: string[]
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    errors.push(`${field} 必须是字符串数组`);
    return undefined;
  }
  return [...value];
}

function parseAdmission(
  value: unknown,
  errors: string[]
): AdmissionTable | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.push('admission 必须是对象');
    return undefined;
  }
  const table: AdmissionTable = {};
  for (const [source, cells] of Object.entries(value)) {
    if (!isRecord(cells)) {
      errors.push(`admission.${source} 必须是对象`);
      continue;
    }
    const parsed: Partial<Record<AdmissionCell, AdmissionDecision>> = {};
    for (const [cell, decision] of Object.entries(cells)) {
      if (!(ADMISSION_CELLS as readonly string[]).includes(cell)) {
        errors.push(`admission.${source}.${cell} 不是合法单元格`);
        continue;
      }
      if (
        typeof decision !== 'string' ||
        !(ADMISSION_DECISIONS as readonly string[]).includes(decision)
      ) {
        errors.push(
          `admission.${source}.${cell} 必须是 explicit|inferred|ignore`
        );
        continue;
      }
      parsed[cell as AdmissionCell] = decision as AdmissionDecision;
    }
    table[source] = parsed;
  }
  return table;
}

function parseRules(
  value: unknown,
  errors: string[]
): AutonomyPolicyRule[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    errors.push('rules 必须是数组');
    return undefined;
  }
  const rules: AutonomyPolicyRule[] = [];
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) {
      errors.push(`rules[${index}] 必须是对象`);
      continue;
    }
    if (typeof raw.id !== 'string' || !raw.id) {
      errors.push(`rules[${index}].id 必须是非空字符串`);
      continue;
    }
    if (typeof raw.enabled !== 'boolean') {
      errors.push(`rules[${index}].enabled 必须是布尔`);
      continue;
    }
    const sources = readStringArray(
      raw.sources,
      `rules[${index}].sources`,
      errors
    );
    rules.push({
      id: raw.id,
      text: typeof raw.text === 'string' ? raw.text : '',
      enabled: raw.enabled,
      ...(sources ? { sources } : {}),
    });
  }
  return rules;
}

/**
 * 解析并校验配置（**纯函数**；非法 ⇒ fail-closed）。
 *
 * `undefined` / `null` ⇒ 全部默认（`enabled=false`）。
 */
export function parseAutonomyPolicy(raw: unknown): {
  config: AutonomyPolicyConfig;
  errors: string[];
} {
  if (raw === undefined || raw === null) {
    return { config: { ...DEFAULT_AUTONOMY_POLICY }, errors: [] };
  }
  if (!isRecord(raw)) {
    return {
      config: { ...DEFAULT_AUTONOMY_POLICY, enabled: false, acceptMode: 'off' },
      errors: ['autonomy.policy 必须是对象'],
    };
  }

  const errors: string[] = [];
  let enabled = DEFAULT_AUTONOMY_POLICY.enabled;
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== 'boolean') errors.push('enabled 必须是布尔');
    else enabled = raw.enabled;
  }

  let acceptMode = DEFAULT_AUTONOMY_POLICY.acceptMode;
  if (raw.acceptMode !== undefined) {
    if (
      typeof raw.acceptMode !== 'string' ||
      !(ACCEPT_MODES as readonly string[]).includes(raw.acceptMode)
    ) {
      errors.push('acceptMode 必须是 off|observe|auto');
    } else {
      acceptMode = raw.acceptMode as AcceptMode;
    }
  }

  let sources = { ...DEFAULT_AUTONOMY_POLICY.sources };
  if (raw.sources !== undefined) {
    if (!isRecord(raw.sources)) {
      errors.push('sources 必须是对象');
    } else {
      // 与缺省合并：只覆盖显式列出的来源，未列出的保持默认（避免"少写一项即静默关闭"）
      for (const [source, value] of Object.entries(raw.sources)) {
        if (typeof value !== 'boolean') {
          errors.push(`sources.${source} 必须是布尔`);
          continue;
        }
        sources[source] = value;
      }
    }
  }

  const admission = parseAdmission(raw.admission, errors) ?? {};
  const rules = parseRules(raw.rules, errors) ?? [];

  const allowlistRaw = raw.allowlist;
  let allowlist = DEFAULT_AUTONOMY_POLICY.allowlist;
  if (allowlistRaw !== undefined) {
    if (!isRecord(allowlistRaw)) {
      errors.push('allowlist 必须是对象');
    } else {
      allowlist = {
        senders:
          readStringArray(allowlistRaw.senders, 'allowlist.senders', errors) ??
          [],
        bots:
          readStringArray(allowlistRaw.bots, 'allowlist.bots', errors) ?? [],
      };
    }
  }

  const filtersRaw = raw.filters;
  let filters = DEFAULT_AUTONOMY_POLICY.filters;
  if (filtersRaw !== undefined) {
    if (!isRecord(filtersRaw)) {
      errors.push('filters 必须是对象');
    } else {
      filters = {
        threadPrefixes:
          readStringArray(
            filtersRaw.threadPrefixes,
            'filters.threadPrefixes',
            errors
          ) ?? [],
        workspaceIds:
          readStringArray(
            filtersRaw.workspaceIds,
            'filters.workspaceIds',
            errors
          ) ?? [],
      };
    }
  }

  const budget = parseBudget(raw.budget, errors);

  if (errors.length > 0) {
    return {
      config: { ...DEFAULT_AUTONOMY_POLICY, enabled: false, acceptMode: 'off' },
      errors,
    };
  }

  return {
    config: {
      enabled,
      acceptMode,
      sources,
      admission,
      rules,
      ...(allowlist ? { allowlist } : {}),
      ...(filters ? { filters } : {}),
      ...(budget ? { budget } : {}),
    },
    errors: [],
  };
}

/**
 * 解析单个 Ticket 的预算上限（P34 收尾）。
 *
 * 只接受**正有限数**；非法 ⇒ 记错误（整份配置 fail-closed）。缺省 ⇒ 不设上限。
 */
function parseBudget(
  value: unknown,
  errors: string[]
): AutonomyPolicyConfig['budget'] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.push('budget 必须是对象');
    return undefined;
  }
  const read = (field: string): number | undefined => {
    const raw = value[field];
    if (raw === undefined) return undefined;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
      errors.push(`budget.${field} 必须是正数`);
      return undefined;
    }
    return raw;
  };
  const maxTokensPerTicket = read('maxTokensPerTicket');
  const maxUsdPerTicket = read('maxUsdPerTicket');
  return {
    ...(maxTokensPerTicket !== undefined ? { maxTokensPerTicket } : {}),
    ...(maxUsdPerTicket !== undefined ? { maxUsdPerTicket } : {}),
  };
}

/**
 * 由策略配置解析 Ticket 的预算上限（唯一映射点；`undefined` = 该维度不设上限）。
 *
 * 供 Ticket sink 建单时写入 `budget_max_*`；**不做闸门判定**（见 `AutonomyPolicyConfig.budget`）。
 */
export function resolveTicketBudgetLimits(config: AutonomyPolicyConfig): {
  maxTokens?: number;
  maxUsd?: number;
} {
  const budget = config.budget;
  if (!budget) return {};
  return {
    ...(budget.maxTokensPerTicket !== undefined
      ? { maxTokens: budget.maxTokensPerTicket }
      : {}),
    ...(budget.maxUsdPerTicket !== undefined
      ? { maxUsd: budget.maxUsdPerTicket }
      : {}),
  };
}

/** 由配置派生 Policy 版本（唯一算法；不允许手填） */
export function computeAutonomyPolicyId(config: AutonomyPolicyConfig): string {
  return buildPolicyVersion([
    `enabled:${config.enabled}`,
    `mode:${config.acceptMode}`,
    ...Object.keys(config.sources)
      .sort()
      .map((key) => `src:${key}:${config.sources[key]}`),
    ...Object.keys(config.admission)
      .sort()
      .map((key) => `adm:${key}:${JSON.stringify(config.admission[key])}`),
    ...config.rules.map(
      (rule) =>
        `rule:${rule.id}:${rule.enabled}:${rule.text}:${(rule.sources ?? []).join(',')}`
    ),
    `senders:${(config.allowlist?.senders ?? []).join(',')}`,
    `bots:${(config.allowlist?.bots ?? []).join(',')}`,
    `threads:${(config.filters?.threadPrefixes ?? []).join(',')}`,
    `workspaces:${(config.filters?.workspaceIds ?? []).join(',')}`,
    `budgetTokens:${config.budget?.maxTokensPerTicket ?? ''}`,
    `budgetUsd:${config.budget?.maxUsdPerTicket ?? ''}`,
  ]);
}

/**
 * 读默认配置源：**托管优先**（`getSettingWithSource` 已按优先级返回最高来源），
 * 未加载多源时回退到 `config.json` 的 `autonomy.policy`。
 */
function defaultReadAutonomyPolicy(): AutonomyPolicyReadResult | undefined {
  try {
    const located = configManager.getSettingWithSource('autonomy.policy');
    if (located) return { value: located.value, source: located.source };

    const global = configManager.getGlobalConfig() as unknown as Record<
      string,
      unknown
    >;
    const autonomy = global.autonomy;
    if (isRecord(autonomy) && autonomy.policy !== undefined) {
      return { value: autonomy.policy, source: 'userSettings' };
    }
    return undefined;
  } catch (error) {
    // 配置不可读 ⇒ 返回 undefined（默认 enabled=false，fail-safe）
    logger.warn('读取 autonomy.policy 失败，按默认（关闭）处理', {
      error: String(error),
    });
    return undefined;
  }
}

/** 加载策略（可注入读取器，便于单测） */
export function loadAutonomyPolicy(
  read: () => AutonomyPolicyReadResult | undefined = defaultReadAutonomyPolicy
): LoadedAutonomyPolicy {
  let located: AutonomyPolicyReadResult | undefined;
  try {
    located = read();
  } catch (error) {
    logger.warn('autonomy.policy 读取抛错，按默认（关闭）处理', {
      error: String(error),
    });
    located = undefined;
  }
  const { config, errors } = parseAutonomyPolicy(located?.value);
  if (errors.length > 0) {
    logger.warn('autonomy.policy 配置非法，已 fail-closed 为关闭', {
      source: located?.source ?? 'defaults',
      errors,
    });
  }
  return {
    config,
    source: located?.source ?? 'defaults',
    policyId: computeAutonomyPolicyId(config),
    errors,
  };
}
