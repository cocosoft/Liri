// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 快速路径（PlanDrivenLoop 分流）判据 —— 类型与默认值的**单一事实源**（T-②05，2026-10-03）
 *
 * 背景（`architecture-benchmark-20260928` §6.4 #6）：分流阈值 `SIMPLE_TASK_MAX_LENGTH`
 * 与「危险意图清单」此前**硬编码在** `tasks/PlanDrivenLoop.ts` 且不读配置；本模块把两者
 * 收敛为**配置驱动**判据 —— 默认值在此定义一次（`config` 默认值与运行时回退共用），
 * 用户可在 `~/.pyapp/config.json` 的 `fastPath` 组覆盖（亦可经 `POST /v1/config/:key`
 * 以点号路径写，如 `fastPath.maxSimpleTaskLength`）。
 *
 * **为什么放 `types/`（core）**：默认值需被 `config`(infra) 与 `tasks`(app) **同时**引用 ——
 * 落任一消费方都会造成反向依赖（`config` 不得 import `app`）。core 是两者共同的下界。
 *
 * 运行时解析（读配置 + 编译正则 + 非法项告警 + 缓存）在 `tasks/fastPathPolicy.ts`；
 * 本模块**纯函数、零依赖**。
 */

/** 简单任务最大字符数（trim 后）——默认值 */
export const DEFAULT_FAST_PATH_MAX_LENGTH = 60;

/**
 * 危险工具意图正则**源码**——默认值。
 *
 * 依据（S0/S3 原始基线）：覆盖删除/移除、发送、写入/覆盖三类**不可逆**意图；
 * 中英文各一组。编译时统一加 `i`（见 {@link compileIntentPatterns}），
 * 与原逐个字面量 `/…/i` 语义等价。
 */
export const DEFAULT_DANGEROUS_INTENT_PATTERNS: readonly string[] = [
  '删除|移除|删掉|清除|清理',
  '\\bdelete\\w*\\b',
  '\\b(?:rm|remove|unlink)\\w*\\b',
  '发送|发信|寄送',
  '\\bsend\\w*\\b',
  '写入|覆盖',
  '\\b(?:write|overwrite)\\w*\\b',
];

/** 单条正则源码长度上限（超出即忽略）—— 降低异常/恶意模式（ReDoS）面 */
export const MAX_INTENT_PATTERN_LENGTH = 200;

/** 编译危险意图正则时统一采用的标志 */
export const INTENT_PATTERN_FLAGS = 'i';

/** 快速路径判据**配置形状**（`GlobalConfig.fastPath`） */
export interface FastPathConfig {
  /** 简单任务最大字符数（trim 后） */
  maxSimpleTaskLength: number;
  /** 危险工具意图正则源码列表（编译时统一加 `i`） */
  dangerousIntentPatterns: string[];
}

/** 解析后的快速路径判据（供纯判定函数消费） */
export interface FastPathPolicy {
  maxSimpleTaskLength: number;
  dangerousIntentPatterns: readonly RegExp[];
}

/** 编译结果（被忽略的源码如实回传，由调用方决定是否告警） */
export interface CompiledIntentPatterns {
  patterns: RegExp[];
  /** 被忽略的源码（非字符串 / 空 / 超长 / 非法正则） */
  invalid: string[];
}

/**
 * 编译危险意图正则（**纯函数**，无 IO/副作用）。
 *
 * 容错口径（CS03：不为理论可能性加缓冲；此处是**真实边界** —— 配置来自用户手写 JSON）：
 * 单条非法/超长/非字符串 ⇒ **只作废该条**（并入 `invalid`），其余规则继续生效，不抛错。
 */
export function compileIntentPatterns(
  sources: readonly unknown[]
): CompiledIntentPatterns {
  const patterns: RegExp[] = [];
  const invalid: string[] = [];
  for (const source of sources) {
    if (
      typeof source !== 'string' ||
      source.length === 0 ||
      source.length > MAX_INTENT_PATTERN_LENGTH
    ) {
      invalid.push(typeof source === 'string' ? source : String(source));
      continue;
    }
    try {
      patterns.push(new RegExp(source, INTENT_PATTERN_FLAGS));
    } catch {
      // @ignore-catch — 非法正则只作废该条，不阻断其余规则；结果经 invalid 如实上报
      invalid.push(source);
    }
  }
  return { patterns, invalid };
}

/**
 * 由配置构造判据（**纯函数**）。
 *
 * 回退口径（**fail-closed 安全默认**）：阈值非法（非正 / 非有限 / 非数）⇒ 默认 60；
 * 正则列表缺失 / 空 / **全部非法** ⇒ 默认清单（不因留空而放开危险意图筛除）。
 *
 * @returns `policy` 与 `invalidPatterns`（被忽略的源码，供调用方告警）
 */
export function buildFastPathPolicy(
  config: FastPathConfig | undefined | null
): { policy: FastPathPolicy; invalidPatterns: string[] } {
  const rawMax = config?.maxSimpleTaskLength;
  const maxSimpleTaskLength =
    typeof rawMax === 'number' && Number.isFinite(rawMax) && rawMax > 0
      ? Math.floor(rawMax)
      : DEFAULT_FAST_PATH_MAX_LENGTH;

  const configured = config?.dangerousIntentPatterns;
  const sources =
    Array.isArray(configured) && configured.length > 0
      ? configured
      : DEFAULT_DANGEROUS_INTENT_PATTERNS;

  const { patterns, invalid } = compileIntentPatterns(sources);
  if (patterns.length > 0) {
    return {
      policy: { maxSimpleTaskLength, dangerousIntentPatterns: patterns },
      invalidPatterns: invalid,
    };
  }

  // 全部非法 ⇒ 退回默认清单（安全默认，避免危险意图失去准入筛除）
  const fallback = compileIntentPatterns(DEFAULT_DANGEROUS_INTENT_PATTERNS);
  return {
    policy: {
      maxSimpleTaskLength,
      dangerousIntentPatterns: fallback.patterns,
    },
    invalidPatterns: invalid,
  };
}
