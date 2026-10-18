/**
 * C-5（2026-10-18）提示词门禁的统一输出与退出码。
 *
 * 推进阶段（清单 §4 C-5）：**先上报 → 降噪 → 白名单 → 阻断**。
 * 因此默认口径是：
 * - `error` ⇒ exit 1（真问题必须拦）
 * - `warning` ⇒ 只上报（降噪期不阻断），`--strict` 时才阻断
 *
 * 四个门禁脚本（parity / budget / t1 / hardcoded）共用本模块，避免各写一份输出。
 */
import {
  formatPromptIssues,
  type PromptIssue,
} from '../../src/services/prompt/PromptValidator';

export interface PromptGateOptions {
  /** `--strict`：warning 也阻断（推进到「阻断」阶段后使用） */
  strict?: boolean;
  /** `--json`：机器可读输出 */
  json?: boolean;
  /** 降噪期门禁：即使有 error 也只上报、不阻断（`lint:prompt-hardcoded` 用） */
  reportOnly?: boolean;
  /** 登记豁免（显式白名单；打印附理由，避免"静默忽略"） */
  exemptions?: readonly PromptGateExemption[];
}

/** 登记豁免条目（路径 + 非空理由） */
export interface PromptGateExemption {
  entry: string;
  reason: string;
}

export function parseGateArgs(argv: readonly string[]): PromptGateOptions {
  return {
    strict: argv.includes('--strict'),
    json: argv.includes('--json'),
    reportOnly: argv.includes('--report-only'),
  };
}

/**
 * 打印问题并决定退出码。**不 return 退出码**，直接在失败时 `process.exit(1)`，
 * 让脚本主体保持线性（与现有 lint 脚本一致）。
 */
export function reportPromptGate(
  name: string,
  issues: readonly PromptIssue[],
  options: PromptGateOptions = {}
): void {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const exemptions = options.exemptions ?? [];

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          gate: name,
          errors: errors.length,
          warnings: warnings.length,
          issues,
          exemptions,
        },
        null,
        2
      )
    );
  } else if (issues.length === 0) {
    console.log(
      `[lint:prompt-${name}] ✓ 通过（0 issue` +
        (exemptions.length > 0 ? ` · 登记豁免 ${exemptions.length} 项` : '') +
        '）'
    );
  } else {
    console.log(`[lint:prompt-${name}]`);
    console.log(formatPromptIssues(issues));
    console.log(
      `[lint:prompt-${name}] 结果：${errors.length} error / ${warnings.length} warning`
    );
  }

  // 豁免一律显式打印（即使 0 issue）——「静默忽略」与「检查器跳过」同级
  if (!options.json && exemptions.length > 0) {
    for (const item of exemptions) {
      console.log(`  ⚪ 豁免 ${item.entry} —— ${item.reason}`);
    }
  }

  const shouldFail =
    options.reportOnly !== true &&
    (errors.length > 0 || (options.strict === true && warnings.length > 0));
  if (shouldFail) {
    if (!options.json) {
      console.error(
        `[lint:prompt-${name}] FAIL —— ${
          errors.length > 0 ? '存在 error' : '存在 warning（--strict）'
        }`
      );
    }
    process.exit(1);
  }
  if (options.reportOnly === true && errors.length > 0) {
    console.log(`[lint:prompt-${name}] 上报模式：仅记录，不阻断`);
  }
}
