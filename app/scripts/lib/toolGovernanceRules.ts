/**
 * toolGovernanceRules — 工具安全治理门禁的**纯判据**（P0，2026-11-22）
 *
 * 与 `gen-tool-governance.ts` 分离的原因：
 * - 生成器需要实例化全部内置工具（读配置 / 路径 / DB），不适合被单测直接 import；
 * - 判据是纯函数 ⇒ 放在本文件，单测零副作用、可在 CI 任一平台运行。
 *
 * 规范：`.trae/specs/tool-security-governance-plan.md`。
 */

/** 已被接受的缺口（矩阵规则检测得到；带理由与关闭计划才允许通过门禁） */
export interface AcceptedGap {
  tool: string;
  gaps: string[];
  riskId: string;
  reason: string;
  plan: string;
}

/** 矩阵规则检测不到、但人工已确认的风险（仅登记，不影响门禁） */
export interface KnownRisk {
  id: string;
  tools: string[];
  dimension: string;
  reason: string;
  plan: string;
}

export interface ExceptionsFile {
  note?: string;
  acceptedGaps: AcceptedGap[];
  knownRisks: KnownRisk[];
}

export type EntryStatus =
  | 'centralized'
  | 'authorized'
  | 'scoped-readonly'
  | 'needs-review';

export interface EntrypointRecord {
  file: string;
  status: EntryStatus;
  authorizedBy: string | null;
  occurrences: number;
  note: string;
}

export interface EntrypointsFile {
  note?: string;
  scanRoots: string[];
  entries: EntrypointRecord[];
}

/** `computeGaps` 需要的最小形状（便于单测构造，不依赖完整 ToolRow） */
export interface GapInput {
  sandboxLevel: string;
  risk: { derived: string };
  maxResultSizeChars: number | null;
}

/**
 * 计算一个工具的治理缺口。
 *
 * 规则刻意少而硬（避免"每加一条规则就多一批噪声"）：
 * - `risk-undeclared`：派生不出风险档（声明缺失且无法由 effects / sandboxLevel / 自报只读推出）；
 * - `shell-without-sandbox`：自称 shell 却没有 `execution` 能力位；
 * - `no-result-limit`：`execution` 类没有声明 `maxResultSizeChars`。
 */
export function computeGaps(row: GapInput): string[] {
  const gaps: string[] = [];
  if (row.risk.derived === 'undeclared') gaps.push('risk-undeclared');
  if (row.risk.derived === 'shell' && row.sandboxLevel !== 'execution') {
    gaps.push('shell-without-sandbox');
  }
  if (row.sandboxLevel === 'execution' && row.maxResultSizeChars === null) {
    gaps.push('no-result-limit');
  }
  return gaps.sort();
}

/** 校验例外表：引用不存在的工具 / 缺字段 / id 重复 ⇒ 错误（防僵尸登记） */
export function validateExceptions(
  exceptions: ExceptionsFile,
  toolNames: readonly string[]
): string[] {
  const errors: string[] = [];
  const names = new Set(toolNames);
  const ids = new Set<string>();
  for (const gap of exceptions.acceptedGaps) {
    if (!names.has(gap.tool)) {
      errors.push(`acceptedGaps 引用了不存在的工具：${gap.tool}`);
    }
    if (!gap.riskId || !gap.reason.trim() || !gap.plan.trim()) {
      errors.push(`acceptedGaps(${gap.tool}) 缺少 riskId / reason / plan`);
    }
  }
  for (const risk of exceptions.knownRisks) {
    if (!risk.id || ids.has(risk.id)) {
      errors.push(`knownRisks id 缺失或重复：${risk.id}`);
    }
    ids.add(risk.id);
    if (!risk.reason.trim() || !risk.plan.trim() || !risk.dimension.trim()) {
      errors.push(`knownRisks(${risk.id}) 缺少 reason / plan / dimension`);
    }
    for (const tool of risk.tools) {
      if (!names.has(tool)) {
        errors.push(`knownRisks(${risk.id}) 引用了不存在的工具：${tool}`);
      }
    }
  }
  return errors;
}

/**
 * 校验执行入口台账：扫描结果与登记必须一一对应。
 *
 * - 新文件出现 `tool.execute(` 而未登记 ⇒ 错误（必须先复核授权）；
 * - 出现次数与登记不符 ⇒ 错误（复核后更新）；
 * - 台账登记的文件已不存在 / 状态非法 / needs-review 无说明 / authorized 无授权来源 ⇒ 错误。
 */
export function validateEntrypoints(
  registry: EntrypointsFile,
  scanned: ReadonlyArray<{ file: string; occurrences: number }>
): string[] {
  const errors: string[] = [];
  const byFile = new Map(registry.entries.map((e) => [e.file, e]));
  const scannedFiles = new Set(scanned.map((s) => s.file));

  for (const s of scanned) {
    const entry = byFile.get(s.file);
    if (!entry) {
      errors.push(
        `未登记的执行入口：${s.file}（${s.occurrences} 处 tool.execute）`
      );
      continue;
    }
    if (entry.occurrences !== s.occurrences) {
      errors.push(
        `${s.file}: 登记 ${entry.occurrences} 处，实际 ${s.occurrences} 处（请复核授权后更新台账）`
      );
    }
  }
  const allowedStatuses: readonly EntryStatus[] = [
    'centralized',
    'authorized',
    'scoped-readonly',
    'needs-review',
  ];
  for (const entry of registry.entries) {
    if (!scannedFiles.has(entry.file)) {
      errors.push(`台账登记的入口已不存在：${entry.file}`);
    }
    if (!allowedStatuses.includes(entry.status)) {
      errors.push(`${entry.file}: 非法 status ${String(entry.status)}`);
    }
    if (entry.status === 'needs-review' && !entry.note.trim()) {
      errors.push(`${entry.file}: needs-review 必须写 note（待取证说明）`);
    }
    if (entry.status === 'authorized' && !entry.authorizedBy) {
      errors.push(`${entry.file}: authorized 必须写 authorizedBy`);
    }
  }
  return errors;
}
