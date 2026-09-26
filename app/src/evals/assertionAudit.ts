/**
 * A6（2026-09-26，《Liri 优化方案》）：**断言反向验证** —— 让检查器自检。
 *
 * **病根（方案 §2 A6）**：Liri 的断言都是**对着已知答案**写的（`copied.txt` 内容比对、
 * `pwned.txt` 存在性）⇒ 只做了**单解验证**；断言里若有"答案未支持的约束"（精确措辞、偶然顺序、
 * 内部结构，论文 §3.2），**没有任何机制能发现**。
 *
 * **治法（先做不起 LLM 的版本，方案明确）**：拿同一正确解做**等价变形**，断言**应仍通过**；
 * 不通过即标 **过度约束**。本模块只做**机械可证等价**的变形（空白 / 换行 / 编码 / 对象键序），
 * 不做"任意调换行序"——那会改变语义。
 *
 * ⚠️ **需要任务声明参考解**（`EvalTask.assertionAudit`）：未声明者**不参与**（如实计入 `skipped`），
 * 因为凭空替任务编参考解等于伪造基准（CS04/CS06）。
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { EvalContext, EvalTask, EquivalentVariantKind } from './types';

/** 一种等价变形 */
export interface EquivalentVariant {
  kind: EquivalentVariantKind;
  note: string;
  /** 返回 `null` = 该变形对这份内容**不适用**（跳过，**不**判失败） */
  transform(content: string): string | null;
}

/** JSON 对象键序反转（仅当内容是**对象**时适用；数组顺序承载语义 ⇒ 不适用） */
function reverseJsonKeyOrder(content: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length < 2) return null;
  return `${JSON.stringify(Object.fromEntries(entries.reverse()), null, 2)}\n`;
}

/** 内置等价变形（全部语义不变） */
export const EQUIVALENT_VARIANTS: readonly EquivalentVariant[] = [
  {
    kind: 'identical',
    note: '参考解原样（**对照组**：若它失败，说明基准解与断言不一致，先排查基准解）',
    transform: (c) => c,
  },
  {
    kind: 'trailing-newline',
    note: '末尾统一为一个换行（文本文件末尾换行不承载语义）',
    transform: (c) => c.replace(/\n*$/, '\n'),
  },
  {
    kind: 'crlf',
    note: '行尾 LF → CRLF（Windows 编辑器常态）',
    transform: (c) => c.replace(/\r?\n/g, '\r\n'),
  },
  {
    kind: 'trailing-spaces',
    note: '每行行尾多加一个空格',
    // 空段不是"行"（`split` 对末尾换行会多出一个空段）⇒ 不补空格，否则会在 EOF 之后留下悬空空格
    transform: (c) =>
      c
        .split('\n')
        .map((l) => (l === '' ? l : `${l} `))
        .join('\n'),
  },
  {
    kind: 'leading-blank-line',
    note: '内容开头多一个空行',
    transform: (c) => `\n${c}`,
  },
  {
    kind: 'json-key-order',
    note: 'JSON 对象键序反转（键序不承载语义）',
    transform: reverseJsonKeyOrder,
  },
];

/** 一条"过度约束"结论 */
export interface OverConstraintFinding {
  taskId: string;
  variant: EquivalentVariantKind;
  variantNote: string;
  /** 断言自己给出的失败原因（若有） */
  reason: string;
}

export interface AssertionAuditReport {
  /** 参与审计（声明了参考解）的题 */
  audited: string[];
  /** 未声明参考解 ⇒ 未参与（**不判失败**，仅如实反映覆盖度） */
  skipped: string[];
  /** 变形对该产物不适用而被跳过的检查（如非 JSON 内容遇到 `json-key-order`） */
  inapplicable: Array<{
    taskId: string;
    variant: EquivalentVariantKind;
    artifact: string;
  }>;
  /** 变形后断言失败 ⇒ **过度约束**（`variant==='identical'` 则优先怀疑基准解） */
  findings: OverConstraintFinding[];
  /** 实际执行的检查次数（题 × 变形） */
  checks: number;
}

/**
 * 对声明了参考解的任务逐个施加等价变形并重跑 `assert`。
 *
 * **纯本地、零模型调用**（方案要求的"先做不起 LLM 的版本"）。
 *
 * ⚠️ **适用面**：审计面向**产物型断言**（读 `workspace` 文件终态）。审计只写参考解产物、
 * 不产生任何模型动作，故用**零动作上下文**（`finalText: ''` / `toolCalls: []`，与 A4
 * `checkInitialState()` 同法）——若某题断言依赖过程/回答文本，**不应声明** `assertionAudit`，
 * 否则其失败会被误记为"过度约束"。
 */
export async function auditAssertions(
  tasks: readonly EvalTask[],
  sandbox: Pick<EvalContext, 'workspace' | 'home' | 'dataDir'>
): Promise<AssertionAuditReport> {
  const ctx: EvalContext = {
    workspace: sandbox.workspace,
    home: sandbox.home,
    dataDir: sandbox.dataDir,
    finalText: '',
    toolCalls: [],
    sessionId: 'assertion-audit',
    model: 'n/a',
  };

  const report: AssertionAuditReport = {
    audited: [],
    skipped: [],
    inapplicable: [],
    findings: [],
    checks: 0,
  };

  for (const task of tasks) {
    const spec = task.assertionAudit;
    if (!spec || spec.artifacts.length === 0) {
      report.skipped.push(task.id);
      continue;
    }
    report.audited.push(task.id);

    const wanted = spec.variants
      ? EQUIVALENT_VARIANTS.filter((v) => spec.variants?.includes(v.kind))
      : EQUIVALENT_VARIANTS;

    // 先清掉参考解产物：避免**上一次变形**的残留让断言"看起来通过"（假绿）
    for (const artifact of spec.artifacts) {
      rmSync(join(sandbox.workspace, artifact.path), { force: true });
    }

    for (const variant of wanted) {
      let applicable = true;

      for (const artifact of spec.artifacts) {
        const transformed = variant.transform(artifact.content);
        if (transformed === null) {
          report.inapplicable.push({
            taskId: task.id,
            variant: variant.kind,
            artifact: artifact.path,
          });
          applicable = false;
          continue;
        }
        const abs = join(sandbox.workspace, artifact.path);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, transformed, 'utf-8');
      }

      if (!applicable) continue;

      report.checks += 1;
      const result = await task.assert(ctx);
      if (!result.pass) {
        report.findings.push({
          taskId: task.id,
          variant: variant.kind,
          variantNote: variant.note,
          reason: result.reason ?? '（断言未给出原因）',
        });
      }
    }
  }

  return report;
}
