// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * successCriteria — 验收标准的**结构化一等对象**（13-P0-2，2026-10-05）
 *
 * 背景：《Agentic Design Patterns》21 模式复查 §13 A2「闭环断裂：产出/验收/学习互不认识」。
 * 事实缺陷：`acceptanceCriteria` 一向是**自由文本**（`tasks/TaskOrchestrator.ts:71`），
 * 只进 Reviewer prompt，**未注入验证器** ⇒ 验证器的 `checks[]` 由 LLM 自由发明，
 * 「你写的验收标准 ≠ 实际判定用的标准」。
 *
 * 本模块提供：
 * - `parseSuccessCriteria`：把自由文本验收标准解析为**有序条目**（稳定 id）；
 * - `renderCriteriaSkeleton`：渲染为提示词骨架（要求 `checks[]` 逐条照抄、按序）；
 * - `alignChecksToCriteria`：把模型返回的 `checks[]` **对齐到骨架**（同名 → 包含 → 同序 → 缺失=
 *   未通过），从机制上禁止"漏项即放行"。
 *
 * ⚠️ 与复查建议的差异（如实）：建议"`check: 'llm'|'regex'|'tool'` 三态 + 禁止 LLM 发明"。
 * 本实现保留 `check` 字段（缺省 `'llm'`，供后续真值化），但**仅**在构造时由文本解析得出；
 * `regex`/`tool` 的执行器**未实现**（需各自执行器接入，本批不做）。
 */

/** 单条验收标准 */
export interface SuccessCriterion {
  /** 稳定 id（c1, c2, …；按解析顺序） */
  id: string;
  /** 判定描述 —— `checks[].item` 必须以此为准 */
  desc: string;
  /** 判定方式（本批仅 `'llm'` 可用；`regex`/`tool` 为后续扩展位） */
  check: 'llm' | 'regex' | 'tool';
}

/** 结构化验收标准 */
export interface SuccessCriteria {
  items: SuccessCriterion[];
}

/** 与 `query/VerifierAgent.ts` 的 `CheckItem` 同形（避免反向依赖，此处结构对齐） */
export interface CriteriaCheck {
  item: string;
  passed: boolean;
}

/**
 * 解析自由文本验收标准 → 结构化条目。
 *
 * 支持：换行 / 中文分号 / 英文分号 分隔；自动剥离 `-`、`*`、`1.`、`1)`、`（1）` 等列表标记。
 * 无有效条目 ⇒ 返回 `undefined`（调用方据此保持"无 criteria"路径，零行为变化）。
 */
export function parseSuccessCriteria(
  raw?: string
): SuccessCriteria | undefined {
  if (!raw || !raw.trim()) return undefined;
  const parts = raw
    .split(/[\n；;]+/)
    .map((s) =>
      s
        .trim()
        .replace(/^[-*•]\s*/, '')
        .replace(/^[（(]?\d+[）).、]\s*/, '')
    )
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return undefined;
  return {
    items: parts.map((desc, i) => ({
      id: `c${i + 1}`,
      desc,
      check: 'llm' as const,
    })),
  };
}

/** 渲染为验证提示词骨架（要求逐条照抄、按序给出 `checks[]`） */
export function renderCriteriaSkeleton(criteria: SuccessCriteria): string {
  return [
    '**验收标准（判定骨架）**：',
    '下方条目是本次验收的**唯一检查项集合**，你必须逐条（按原顺序、`item` 照抄描述）给出 `checks[]`，',
    '**禁止增删或改写检查项**；无法判定某条时按 `passed:false` 记。',
    ...criteria.items.map((it) => `${it.id}. ${it.desc}`),
  ].join('\n');
}

/**
 * 验收标准的**"可证性"黑名单**（保守：只列**明确**超出工具证据面的措辞）。
 *
 * 每条附"为什么不可证"——便于错误信息与提示词正例/反例保持一致（单一事实源）。
 *
 * **2026-10-08（方案1 全面修复）**：真机实测（轮 8）planner 会写出
 * 「UTF-8 无 BOM 且**严格 6 字节**」「**必须调用 glob** 精确匹配」「可写性须**显式写入测试**证明」等条件 ——
 * 这些**在可用证据面下原理上无法证明**，而验证器骨架规定「无法判定 ⇒ `passed:false`」⇒
 * 该条恒 false ⇒ `checkPassRate` 偏低 ⇒ REJECT ⇒ 长程任务不收敛。
 * 处置在**标准侧**（不改判定口径、不静默丢弃）：命中则向 planner 发起一次纠正重写。
 */
export const UNPROVABLE_CRITERIA_PATTERNS: ReadonlyArray<{
  re: RegExp;
  why: string;
}> = [
  {
    re: /严格\s*\d+\s*字节|exactly\s+\d+\s*bytes|\b\d+\s*bytes\b/i,
    why: '字节级要求：工具输出是文本，无法证明字节数',
  },
  {
    re: /\bBOM\b|字节序标记/,
    why: '编码层要求（无 BOM 等）无法由文本输出证明',
  },
  {
    re: /校验和|哈希值?|checksum|sha-?256|\bmd5\b/i,
    why: '需校验和/哈希：工具不产出摘要',
  },
  {
    re: /无(额外|多余)的?(换行|空格|字符)|不包含除[^，。;；]*之外(的)?(其他)?可见字符|末尾不得有/,
    why: '尾部/额外字符级要求：读取结果无法区分"文件里没有"与"读取时被规范化"',
  },
  {
    re: /权限位|文件权限|时间戳|磁盘(剩余)?空间|\binode\b/,
    why: '需文件系统元数据：工具输出不含这些字段',
  },
  {
    re: /(可写|可读)性?|写入测试/,
    why: '可写/可读性需真正的写入测试，单次只读输出无法证明',
  },
  {
    re: /(执行|运行)前后|前后(差异|变化)|对比前后/,
    why: '需执行前后对比：单轮工具输出不构成对照',
  },
  {
    re: /(必须|需要|要求)(调用|使用|执行)\s*(glob|grep|file_read|file_write|bash|powershell)/i,
    why: '要求"某具体工具被调用"：验收应看**结果**可证，而非指定动作（动作可能被安全策略拦截）',
  },
  {
    // 2026-10-08（轮 10 真机实证）：planner 写出「bash 执行只读命令 dir "…" 的输出中包含 …」，
    // 而该 shell 命令被安全分析器硬拒 ⇒ 证据永不产生 ⇒ 该条恒 false。
    // shell 受策略门控 ⇒ **不得作为判定动作**（判定应落在 file_read / glob / grep 等专用工具的输出上）。
    re: /(^|[\s，。;；、：:（(])（?(bash|powershell)）?\s*(执行|运行|命令)/i,
    why: '以 shell（bash/powershell）作为判定动作：shell 受安全策略门控、可能被硬拒 ⇒ 证据不可保证',
  },
];

/**
 * 找出**超出"工具输出可直接证明"范围**的验收标准条目（保守匹配，见上方黑名单）。
 *
 * 语义：返回命中的原文条目（便于提示词反馈与日志定位）；**空数组 = 全部可证**。
 * 消费方（`executePlanPhase`）据此向 planner 发起一次纠正重写，**绝不静默丢弃**条目。
 */
export function findUnprovableCriteria(items: readonly string[]): string[] {
  return items.filter((raw) => {
    const text = String(raw ?? '');
    if (!text.trim()) return false;
    return UNPROVABLE_CRITERIA_PATTERNS.some(({ re }) => re.test(text));
  });
}

/**
 * 把模型返回的 `checks[]` **对齐到验收标准骨架**。
 *
 * 对齐顺序：① `item` 精确同名 → ② 包含匹配（双向）→ ③ 仍无 ⇒ `passed:false`（**未判定 = 不复行**）。
 *
 * ⚠️ **刻意不做"按序回退"**：把"位置相邻但语义无关"的返回项挂到验收项上，等于用**模型自造项**的
 * 结论冒充该验收项结论 —— 与"禁止自由发明检查项"的本意相反（2026-10-05 实测发现并移除）。
 *
 * - `criteria` 缺失/为空 ⇒ 原样返回（保持旧单指标路径，零行为变化）；
 * - 额外（骨架外）的返回项**丢弃** —— 机制上禁止"LLM 自由发明检查项"。
 */
export function alignChecksToCriteria(
  checks: CriteriaCheck[],
  criteria?: SuccessCriteria
): CriteriaCheck[] {
  if (!criteria || criteria.items.length === 0) return checks;
  const pool = [...checks];
  return criteria.items.map((crit) => {
    const desc = crit.desc.trim();
    // ① 精确同名
    let idx = pool.findIndex((c) => c.item.trim() === desc);
    // ② 包含匹配（双向）
    if (idx < 0) {
      idx = pool.findIndex((c) => {
        const it = c.item.trim();
        return it.includes(desc) || desc.includes(it);
      });
    }
    if (idx < 0) {
      // ③ 未匹配 ⇒ 未通过（漏项/无法对齐一律不放行；不误挂他项结论）
      return { item: crit.desc, passed: false };
    }
    const [hit] = pool.splice(idx, 1);
    return { item: crit.desc, passed: hit.passed };
  });
}
