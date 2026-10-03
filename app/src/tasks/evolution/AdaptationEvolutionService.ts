// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * AdaptationEvolutionService —— 经验**自动演化**（T-②06 阶段 2，2026-10-03）
 *
 * 规格：`.trae/specs/adaptation-writeback-evolution.md`（台账 T-②06 / benchmark §6.4 #9）。
 *
 * 闭环：**失败/评审样本 → 归纳 → 写回产物 → 自动回灌**
 *   - 经验源：`GoalMetricsService.queryReviewSamples()`（**首个生产消费方**），
 *     失败判定 = `converged === 0`（模型**明确**判未收敛）—— **不引入阈值**（CS04）；
 *   - 归纳：经 core SPI 调 LLM（`resolveAiAccess`，同 `MemoryDreamService`，避免 infra→app 倒挂）；
 *   - 写回：提示覆盖层（`utils/promptEvolution`）+ 可选技能侧车；**只追加、不改写**用户文件；
 *   - 回灌：覆盖层由 `promptEvolution` 系统提示词分段自动注入；侧车由 `FileSkillLoader` 合并。
 *
 * **防抖**（三条，缺一不可）：① 失败样本 ≥ {@link MIN_FAILURE_SAMPLES}；
 * ② 样本签名与上次不同（无新经验不重复演化）；③ 距上次演化 ≥
 * `EVOLUTION_MIN_INTERVAL_MS`。目的：避免"同一批经验反复改写产物"。
 *
 * **判定与接线分离**（R06-006 GR03）：`selectFailureSamples` / `computeSampleSignature` /
 * `decideEvolution` / `buildEvolutionPrompt` / `parseEvolutionOutput` 均为**纯函数**
 * （可单测）；IO 与外部依赖经 {@link EvolutionDeps} 注入。
 *
 * **失败口径**（CS03）：LLM 不可用 / 输出不可解析 / 落盘失败 ⇒ 只留痕**不抛**
 * （观测面失败不得反灌业务）；产物为空 ⇒ 不写状态（下次仍可演化）。
 */

import { createHash } from 'crypto';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { resolveAiAccess } from '@modules/core/spi';
import { resolveUserSkillsDir } from '@modules/core/paths';
import {
  EVOLUTION_MIN_INTERVAL_MS,
  readEvolutionState,
  writeEvolutionState,
  writePromptEvolutionOverlay,
  writeSkillEvolution,
  type EvolutionState,
} from '@modules/utils/promptEvolution';
import { goalMetricsService } from '../db/GoalMetricsService';
import { recordEvolutionApplied } from './EvolutionAudit';

const logger = getLogger('tasks:evolution');

/**
 * 归纳所需的最小失败样本数（**设计常量**，非业务阈值：单点样本不足以"归纳"规律，
 * 两条起才存在共性可提取）。不配置化（CS03：无实测需求不加可配置面）。
 */
export const MIN_FAILURE_SAMPLES = 2;

/** 演化跳过原因（机器可读，供日志/测试断言，CS02） */
export type EvolutionSkipped =
  | 'insufficient-samples'
  | 'duplicate-signature'
  | 'throttled'
  | 'no-output'
  | 'write-failed'
  | 'error';

/** 一条失败样本（只保留演化所需字段；结构上兼容 `ReviewSampleRow`） */
export interface ReviewSampleLike {
  pdcaTaskId: string;
  goalText: string;
  stage: string;
  /** 收敛判定：`1` 收敛 / `0` **明确未收敛** / `null` 未决（跳过结论） */
  converged: number | null;
  reason: string | null;
}

/** 失败样本（经筛选后的最小事实） */
export interface FailureSample {
  pdcaTaskId: string;
  goalText: string;
  stage: string;
  reason: string;
}

/** LLM 归纳产物（已解析并做过形状校验） */
export interface EvolutionOutput {
  /** 提示覆盖层正文（必填；空 ⇒ 本次不落盘） */
  overlay: string;
  /** 目标技能名（可选；**必须**在候选清单内，否则由调用方忽略） */
  skill?: string;
  /** 技能侧车正文（`skill` 给出时才有意义） */
  skillPatch?: string;
}

/** 一次演化的结果（如实记录：落了什么、为何跳过） */
export interface EvolutionRunResult {
  applied: Array<{ scope: 'prompt' | 'skill'; target?: string; bytes: number }>;
  skipped?: EvolutionSkipped;
  sampleCount: number;
}

/** 外部依赖（生产实现见 {@link createEvolutionDeps}；测试注入假实现） */
export interface EvolutionDeps {
  /** 读取评审样本（生产 = `GoalMetricsService.queryReviewSamples`） */
  loadReviewSamples: () => Promise<ReviewSampleLike[]>;
  /** 候选技能名（仅**用户**技能目录下含 `SKILL.md` 者；用于约束 LLM 不得臆造技能名） */
  listSkillCandidates: () => string[];
  /** LLM 归纳（不可用/失败 ⇒ `null`） */
  generate: (input: {
    samples: FailureSample[];
    skillCandidates: string[];
  }) => Promise<EvolutionOutput | null>;
  readState: () => EvolutionState;
  writeState: (state: EvolutionState) => boolean;
  /** 落盘覆盖层 ⇒ 字节数；失败 ⇒ `null` */
  writeOverlay: (text: string) => number | null;
  /** 落盘技能侧车 ⇒ 字节数；失败 ⇒ `null` */
  writeSkillSidecar: (skillName: string, text: string) => number | null;
  now: () => number;
  /** 审计事件（生产 = `recordEvolutionApplied`；未装配 sink ⇒ 内部如实不落） */
  emitEvent: (payload: {
    scope: 'prompt' | 'skill';
    target?: string;
    sampleCount: number;
    bytes: number;
  }) => Promise<void>;
}

// ─── 纯函数（判定与接线分离，可单测）────────────────────────────────────────

/**
 * 从评审样本中挑出**明确未收敛**的失败样本（纯函数）。
 *
 * 判定用 `converged === 0`（模型明确判未收敛）—— `null`（未决/降级跳过）**不算失败**，
 * 避免把"评估没跑成"误当"目标未达成"（L7 三态既有口径）。
 */
export function selectFailureSamples(
  rows: readonly ReviewSampleLike[]
): FailureSample[] {
  const failures: FailureSample[] = [];
  for (const row of rows) {
    if (row.converged !== 0) continue;
    failures.push({
      pdcaTaskId: row.pdcaTaskId,
      goalText: row.goalText,
      stage: row.stage,
      reason: row.reason ?? '',
    });
  }
  return failures;
}

/** 样本签名（内容哈希）：相同 ⇒ 无新经验（防抖第 ② 条） */
export function computeSampleSignature(
  samples: readonly FailureSample[]
): string {
  const canonical = samples
    .map((s) => `${s.pdcaTaskId}\u0000${s.reason}`)
    .sort()
    .join('\u0001');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/**
 * 是否应演化（纯函数）。
 * @returns 跳过原因；`null` = 应当演化
 */
export function decideEvolution(params: {
  sampleCount: number;
  signature: string;
  state: EvolutionState;
  now: number;
}): EvolutionSkipped | null {
  const { sampleCount, signature, state, now } = params;
  if (sampleCount < MIN_FAILURE_SAMPLES) return 'insufficient-samples';
  if (signature === state.lastSampleSignature) return 'duplicate-signature';
  if (
    state.lastAppliedAt > 0 &&
    now - state.lastAppliedAt < EVOLUTION_MIN_INTERVAL_MS
  ) {
    return 'throttled';
  }
  return null;
}

/** 归纳提示词（纯函数；显式约束：可移植要点、技能名必须取自候选清单、只输出 JSON） */
export function buildEvolutionPrompt(input: {
  samples: FailureSample[];
  skillCandidates: string[];
}): string {
  const sampleLines = input.samples
    .map(
      (s) =>
        `- [未收敛] 目标: ${s.goalText.slice(0, 120)} | 阶段: ${s.stage} | 原因: ${s.reason.slice(0, 200)}`
    )
    .join('\n');
  const candidates =
    input.skillCandidates.length > 0
      ? input.skillCandidates.join(', ')
      : '（无）';

  return [
    '你是"经验归纳器"。基于下列**未收敛**的 PDCA 任务样本，归纳可复用的操作经验。',
    '只输出严格 JSON（不要解释、不要代码块围栏）：',
    '{"overlay":"<Markdown 无序列表，≤10 条，纯要点>","skill":"<需要修订的技能名，逐字取自候选清单；无则空字符串>","skillPatch":"<该技能的补充条目；skill 为空则空字符串>"}',
    '要求：',
    '1. overlay 只写**可移植**的操作要点（不写具体任务名/路径/一次性偶发细节，不写客套话）；',
    '2. skill **必须逐字取自**候选清单，**不得臆造**技能名（不在清单内请留空）；',
    '3. 无有效经验可归纳 ⇒ overlay 输出空字符串。',
    '',
    `候选技能：${candidates}`,
    '样本：',
    sampleLines,
  ].join('\n');
}

/** 解析 LLM 输出（纯函数；容忍代码块围栏；形状不符 ⇒ `null`） */
export function parseEvolutionOutput(text: string): EvolutionOutput | null {
  const fenced = text.replace(/```json\s*([\s\S]*?)```/i, '$1');
  const match = fenced.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as {
      overlay?: unknown;
      skill?: unknown;
      skillPatch?: unknown;
    };
    const overlay = typeof parsed.overlay === 'string' ? parsed.overlay.trim() : '';
    const skill =
      typeof parsed.skill === 'string' && parsed.skill.trim().length > 0
        ? parsed.skill.trim()
        : undefined;
    const skillPatch =
      typeof parsed.skillPatch === 'string' && parsed.skillPatch.trim().length > 0
        ? parsed.skillPatch.trim()
        : undefined;
    return { overlay, skill, skillPatch };
  } catch {
    // @ignore-catch — 输出不可解析 ⇒ 视为"无产物"（调用方留痕）
    return null;
  }
}

// ─── 编排（IO 经 deps 注入）─────────────────────────────────────────────────

/**
 * 执行一次演化（幂等 + 防抖 + 失败不抛）。
 *
 * @returns 如实记录本次落了哪些产物 / 为何跳过
 */
export async function runAdaptationEvolution(
  deps: EvolutionDeps
): Promise<EvolutionRunResult> {
  try {
    const rows = await deps.loadReviewSamples();
    const samples = selectFailureSamples(rows);
    const signature = computeSampleSignature(samples);
    const now = deps.now();
    const skipped = decideEvolution({
      sampleCount: samples.length,
      signature,
      state: deps.readState(),
      now,
    });
    if (skipped) {
      logger.debug('演化跳过', { skipped, sampleCount: samples.length });
      return { applied: [], skipped, sampleCount: samples.length };
    }

    const skillCandidates = deps.listSkillCandidates();
    const output = await deps.generate({ samples, skillCandidates });
    if (!output || output.overlay.length === 0) {
      logger.warn('演化未产出有效覆盖层', { sampleCount: samples.length });
      return { applied: [], skipped: 'no-output', sampleCount: samples.length };
    }

    const applied: EvolutionRunResult['applied'] = [];
    const overlayBytes = deps.writeOverlay(output.overlay);
    if (overlayBytes !== null) {
      applied.push({ scope: 'prompt', bytes: overlayBytes });
      logger.info('演化：提示覆盖层已更新', {
        sampleCount: samples.length,
        bytes: overlayBytes,
      });
      await deps.emitEvent({
        scope: 'prompt',
        sampleCount: samples.length,
        bytes: overlayBytes,
      });
    }

    // 技能侧车：**仅在候选清单内**才写（禁止臆造技能名；CS02：用标识符比对，非自由文本推断）
    if (output.skill && output.skillPatch && skillCandidates.includes(output.skill)) {
      const skillBytes = deps.writeSkillSidecar(output.skill, output.skillPatch);
      if (skillBytes !== null) {
        applied.push({ scope: 'skill', target: output.skill, bytes: skillBytes });
        logger.info('演化：技能侧车已更新', {
          skill: output.skill,
          sampleCount: samples.length,
          bytes: skillBytes,
        });
        await deps.emitEvent({
          scope: 'skill',
          target: output.skill,
          sampleCount: samples.length,
          bytes: skillBytes,
        });
      }
    }

    if (applied.length === 0) {
      logger.warn('演化：无产物落盘成功', { sampleCount: samples.length });
      return { applied: [], skipped: 'write-failed', sampleCount: samples.length };
    }

    // 仅在**确有落盘**后推进状态 ⇒ 落盘失败不致"经验被吞"（下次仍可演化）
    if (!deps.writeState({ lastAppliedAt: now, lastSampleSignature: signature })) {
      logger.warn('演化：状态落盘失败（下次可能重复演化）', {});
    }
    return { applied, sampleCount: samples.length };
  } catch (err) {
    await handleError(err, {
      module: 'tasks:evolution',
      action: 'runAdaptationEvolution',
    });
    return { applied: [], skipped: 'error', sampleCount: 0 };
  }
}

// ─── 生产实现 ───────────────────────────────────────────────────────────────

/** 列出用户技能目录下**含 SKILL.md** 的技能名（候选清单，约束 LLM 不得臆造） */
function listUserSkillCandidates(): string[] {
  const dir = resolveUserSkillsDir();
  try {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'vendor')
      .map((e) => e.name)
      .filter((name) => existsSync(join(dir, name, 'SKILL.md')))
      .sort();
  } catch {
    // @ignore-catch — 目录不可读 ⇒ 无候选（不臆造）
    return [];
  }
}

/** 经 core SPI 归纳（不可用 / 输出不可解析 ⇒ `null`） */
async function generateWithModel(input: {
  samples: FailureSample[];
  skillCandidates: string[];
}): Promise<EvolutionOutput | null> {
  const ai = resolveAiAccess();
  const routerPort = ai.getModelRouter() as {
    resolveAsync(role: string): Promise<string | null>;
  } | null;
  const registryPort = ai.getProviderRegistry() as {
    getByModel(model: string): unknown;
    getDefaultProvider(): unknown;
  } | null;
  const model = routerPort ? await routerPort.resolveAsync('quick') : null;
  const provider =
    model && registryPort
      ? registryPort.getByModel(model)
      : registryPort?.getDefaultProvider();
  if (!provider) {
    logger.warn('演化：无可用 AI Provider');
    return null;
  }
  const client = ai.createToolAwareClient(provider) as {
    sendMessage(
      messages: unknown,
      options: unknown
    ): Promise<{ content: string }>;
  };
  const response = await client.sendMessage(
    [{ role: 'user', content: buildEvolutionPrompt(input) }],
    { model, temperature: 0.3, maxTokens: 2048 }
  );
  return parseEvolutionOutput(response.content);
}

/**
 * 生产依赖装配。
 * @param sessionId 审计事件归属会话（缺省 ⇒ 事件仍按"未装配"如实不落，见 `EvolutionAudit`）
 */
export function createEvolutionDeps(sessionId?: string): EvolutionDeps {
  return {
    loadReviewSamples: async () => {
      await goalMetricsService.init();
      return goalMetricsService.queryReviewSamples();
    },
    listSkillCandidates: listUserSkillCandidates,
    generate: generateWithModel,
    readState: () => readEvolutionState(),
    writeState: (state) => writeEvolutionState(state),
    writeOverlay: (text) => writePromptEvolutionOverlay(text)?.bytes ?? null,
    writeSkillSidecar: (skillName, text) =>
      writeSkillEvolution(skillName, text)?.bytes ?? null,
    now: () => Date.now(),
    emitEvent: async (payload) => {
      if (!sessionId) return;
      await recordEvolutionApplied({ sessionId, ...payload });
    },
  };
}
