#!/usr/bin/env bun
/**
 * R14 —— **分层质量摘要**（第九轮审查 §6.3）。
 *
 * 外部主张：CI 摘要应把质量指标**分类呈现**，**不要合并成单一的"质量分数"** ——
 * 不同类型问题风险不同（尤其"安全测试被跳过"不应被大量普通单测通过数抵消）。
 *
 * 本脚本把各项检查按 **5 层**归类渲染为 Markdown 并写入 GitHub Step Summary：
 *   ① 静态质量（类型/lint/架构/版本一致）
 *   ② 测试质量（通过/失败/跳过 + 关键覆盖）
 *   ③ 安全质量（负向/隔离/权限绕过）
 *   ④ 可靠性（故障注入/恢复/幂等）
 *   ⑤ 性能质量（固定环境基准与回归幅度）
 *
 * **不合成单一分数**（本脚本刻意不产出任何总分/加权值）。
 *
 * 用法：
 *   bun run scripts/quality-summary.ts                # 从 QS_JSON 读取结果并渲染（写 $GITHUB_STEP_SUMMARY）
 *   QS_JSON='{"typecheck":"success",...}' bun run scripts/quality-summary.ts
 *   bun run scripts/quality-summary.ts --self-check   # 自证（合成样例，断言分层且无总分）
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

type CheckResult = 'success' | 'failure' | 'skipped' | 'cancelled' | 'unknown';

interface CheckSpec {
  /** 结果键（CI 传入的 JSON 中的键名） */
  key: string;
  /** 展示名 */
  label: string;
}

interface Layer {
  index: number;
  name: string;
  checks: CheckSpec[];
}

/**
 * 5 层 + 各自检查项。键名与 **CI 作业名**对齐（`needs.<job>.result` 可精确映射），
 * 避免把"作业通过"过度声称成某个子步骤通过（CS06：不虚构粒度）。
 */
const LAYERS: Layer[] = [
  {
    index: 1,
    name: '静态质量',
    checks: [
      {
        key: 'static-checks',
        label: 'Static Checks（lint:arch / lint:size / 循环依赖 / 安全扫描）',
      },
      {
        key: 'test-suite',
        label: 'Test Suite（typecheck + lint + 单测 + 覆盖率）',
      },
    ],
  },
  {
    index: 2,
    name: '测试质量',
    checks: [
      { key: 'test-suite', label: '后端测试（Test Suite）' },
      { key: 'client-test', label: '前端测试（Client Test）' },
      { key: 'command-test', label: '命令审计 / 执行（Command Tests）' },
    ],
  },
  {
    index: 3,
    name: '安全质量',
    checks: [
      {
        key: 'security-scan',
        label: '安全扫描（static-check · security-scan）',
      },
      {
        key: 'sandbox-negative',
        label: '沙箱真负向（P1-6 · Linux 强制跑：越权读/写/子进程被内核拒绝）',
      },
      {
        key: 'pathshield-e2e',
        label: '防泄题沙箱 e2e（E2E Fault Injection · PathShield）',
      },
    ],
  },
  {
    index: 4,
    name: '可靠性',
    checks: [
      { key: 'e2e-test', label: '故障注入 e2e（E2E Fault Injection）' },
      { key: 'cargo-build', label: '原生构建（Cargo Native Build）' },
    ],
  },
  {
    index: 5,
    name: '性能质量',
    checks: [
      { key: 'performance-test', label: '性能回归（Performance Tests）' },
    ],
  },
];

const ICON: Record<CheckResult, string> = {
  success: '✅',
  failure: '❌',
  skipped: '⏭️',
  cancelled: '🚫',
  unknown: '❔',
};

const LABEL: Record<CheckResult, string> = {
  success: '通过',
  failure: '失败',
  skipped: '跳过',
  cancelled: '已取消',
  unknown: '未提供',
};

/** 由「检查结果表」渲染分层 Markdown。**纯函数**（供自证）。 */
export function renderQualitySummary(
  results: Record<string, CheckResult>
): string {
  const lines: string[] = [];
  lines.push('## 分层质量摘要（R14 · 不合成单一分数）');
  lines.push('');
  lines.push(
    '> 各层**独立呈现**：不同类型问题风险不同 —— **安全测试被跳过不应被大量普通单测通过抵消**。本摘要**不产出**任何总分/加权值。'
  );
  lines.push('');

  for (const layer of LAYERS) {
    lines.push(`### ${layer.index}. ${layer.name}`);
    lines.push('');
    lines.push('| 检查 | 结果 |');
    lines.push('|---|---|');
    for (const check of layer.checks) {
      const r = results[check.key] ?? 'unknown';
      lines.push(`| ${check.label} | ${ICON[r]} ${LABEL[r]} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** 解析结果：优先 `QS_JSON`，其次读取 `QS_JSON_FILE` 指向的文件。 */
function collectResults(): Record<string, CheckResult> {
  const raw =
    process.env.QS_JSON ??
    (process.env.QS_JSON_FILE && existsSync(process.env.QS_JSON_FILE)
      ? readFileSync(process.env.QS_JSON_FILE, 'utf-8')
      : '{}');
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, CheckResult> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (
        v === 'success' ||
        v === 'failure' ||
        v === 'skipped' ||
        v === 'cancelled'
      )
        out[k] = v;
      else out[k] = 'unknown';
    }
    return out;
  } catch {
    // @ignore-catch — 结果 JSON 不可解析时按"全部未提供"渲染，不虚构结果
    return {};
  }
}

/** 自证：合成样例必须**分层**呈现 且 **不含**总分（防"静默合成单一分数"）。 */
function selfCheck(): void {
  const md = renderQualitySummary({
    'test-suite': 'success',
    'static-checks': 'success',
    'security-scan': 'skipped',
    'client-test': 'success',
    'performance-test': 'failure',
  });
  const problems: string[] = [];
  for (const layer of LAYERS) {
    if (!md.includes(layer.name)) problems.push(`缺层标题：${layer.name}`);
  }
  // 安全层"跳过"必须**原样显示**（不得被其它层通过数掩盖）
  if (!md.includes('安全扫描') || !md.includes('⏭️ 跳过')) {
    problems.push('安全层的"跳过"未如实呈现');
  }
  // 不得出现任何"总分/评分"字样（不合成为单一分数）
  for (const banned of ['质量分数', 'overall score', 'quality score']) {
    if (md.includes(banned)) problems.push(`出现被禁止的合成分数：${banned}`);
  }
  // 亦不得出现"数值型合计"（如 `总分：87`）—— 免责声明里的"总分"字样不算
  if (/(总分|得分|score)\s*[:：]?\s*\d+/i.test(md)) {
    problems.push('出现数值型合计分数');
  }
  if (problems.length > 0) {
    console.error('❌ 自证失败：');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('✅ 自证通过：5 层齐全、跳过项如实呈现、无合成分数。');
}

function main(): void {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }
  const md = renderQualitySummary(collectResults());
  console.log(md);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, md + '\n', 'utf-8');
    console.log(`\n（已写入 Step Summary：${summaryPath}）`);
  }
}

// 直接执行时运行；被 import（测试）时不自动执行
if (import.meta.main) main();
