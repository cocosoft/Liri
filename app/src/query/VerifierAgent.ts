/**
 * VerifierAgent — 制造者/检查者分离的验证器子代理
 *
 * Phase 4 新增。对标 loop-engineering patterns 中的 verifier 子代理。
 * 在 Loop 中引入独立的验证器，用更严格的指令审查工具调用结果，
 * 确保修改的正确性，降低"误修复"风险。
 *
 * 设计原则：
 *   - 默认立场：REJECT（假设修改有问题，需证明正确性）
 *   - 与制造者使用不同 temperature（通常 temperature=0，确定性输出）
 *   - 最多 3 次修复-验证循环，超过则升级
 *   - 不触发 CircuitBreaker（独立的防护层）
 *
 * 调用方通过 TAORLoopDeps.callModel 注入模型调用能力，
 * VerifierAgent 本身不持有模型客户端。
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('query:verifierAgent');

// ─── 类型定义 ──────────────────────────────────────────

/** 单个检查项 */
export interface CheckItem {
  /** 检查项名称 */
  item: string;
  /** 是否通过 */
  passed: boolean;
}

/** 验证结果 */
export interface VerificationResult {
  /** 是否通过验证 */
  passed: boolean;
  /** 验证置信度 (0-1) — LLM 自评，仅作参考 */
  confidence: number;
  /** 未通过时的反馈消息（给制造者用于修复） */
  feedback?: string;
  /** 验证类型 */
  verdict: VerdictType;
  /** 子检查项列表（Phase 2b: 双指标验证） */
  checks?: CheckItem[];
  /** 检查项通过率 = passedChecks / totalChecks（客观指标） */
  checkPassRate?: number;
}

/** 验证判定类型 */
export type VerdictType = 'APPROVE' | 'REJECT' | 'ESCALATE';

/** 验证代理配置 */
export interface VerifierAgentConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 最大修复-验证循环次数，默认 3 */
  maxCycles: number;
  /** 置信度阈值（低于此值视为 REJECT），默认 0.7 */
  confidenceThreshold: number;
  /** 验证超时（毫秒），默认 60_000 */
  timeoutMs: number;
  /**
   * Teamwork P2b（2026-09-06）：REJECT 时 pitfall 记录钩子（P1-2 pitfall 注册表写入点）。
   * 由上层（编排器）注入 PitfallRegistry.record；未注入 no-op——现状零变化。
   */
  recordPitfall?: (rec: {
    description: string;
    error: string;
    source: 'verifier';
    contextSig?: string;
  }) => void;
}

/** 验证输入 */
export interface VerificationInput {
  /** 当前对话消息历史 */
  messages: Array<{
    role: string;
    content: string;
    tool_calls?: unknown;
    tool_call_id?: string;
  }>;
  /** 最近一轮的工具调用结果 */
  toolResults: Array<{
    toolName: string;
    toolCallId: string;
    result?: unknown;
    error?: string;
  }>;
  /** 当前轮次 */
  turnCount: number;
  /** 会话 ID */
  sessionId: string;
  /**
   * P0-3（2026-09-06，Teamwork）：审查准则覆盖——默认本代理为"代码变更验证器"；
   * 注入本字段可切换到其他审查语义（如研究候选的对抗评审：审查对象/维度说明）。
   * 判定机制（checks 通过率 + confidence + 默认立场 REJECT）不变；未注入时行为与现状一致。
   */
  reviewGuidelines?: string;
}

const DEFAULT_CONFIG: VerifierAgentConfig = {
  enabled: true,
  maxCycles: 3,
  confidenceThreshold: 0.7,
  timeoutMs: 60_000,
};

// ─── 验证提示词模板 ────────────────────────────────────

/**
 * 构建验证提示词
 * 指令核心：默认拒绝，需制造者证明修改正确性
 */
function buildVerificationPrompt(input: VerificationInput): string {
  const toolResultsSummary = input.toolResults
    .map((tr) => {
      if (tr.error) {
        return `- ${tr.toolName}(${tr.toolCallId}): ❌ 失败 — ${tr.error}`;
      }
      const resultStr =
        typeof tr.result === 'string'
          ? tr.result.slice(0, 500)
          : JSON.stringify(tr.result).slice(0, 500);
      return `- ${tr.toolName}(${tr.toolCallId}): ${resultStr}`;
    })
    .join('\n');

  // P0-3（2026-09-06，Teamwork）：注入 reviewGuidelines 时切换为"审查对象+维度由
  // 调用方定义"的对抗评审模板（如研究候选方案评审）；判定机制（checks 通过率 +
  // confidence + 默认立场 REJECT）与 JSON 解析不变，仅审查语义/维度动态化。
  if (input.reviewGuidelines) {
    return [
      '## 验证任务',
      '',
      '你是严格的对抗评审员。对下方待审对象按给定审查准则逐项审查，判断其是否合格。',
      '',
      '**审查准则**：',
      input.reviewGuidelines,
      '',
      '**审查原则**：',
      '1. 默认立场是 REJECT（假设待审对象有问题，需证明其合格）',
      '2. 依据上方审查准则逐项给出 checks（item=准则要点，passed=是否满足）',
      '3. 存在明显缺陷或与任务目标不符 → REJECT，feedback 给出具体理由',
      '4. 无法确定（置信度低）→ ESCALATE',
      '',
      '## 待审对象',
      '',
      toolResultsSummary || '(无待审内容)',
      '',
      '## 输出格式',
      '',
      '仅输出 JSON（不要有其他内容）：',
      '```json',
      '{',
      '  "verdict": "APPROVE" | "REJECT" | "ESCALATE",',
      '  "confidence": 0.0-1.0,',
      '  "feedback": "REJECT/ESCALATE 时给出具体批评理由",',
      '  "checks": [{"item": "准则要点1", "passed": true}, {"item": "准则要点2", "passed": false}]',
      '}',
      '```',
      '',
      '**判定参考**：多数准则通过且无致命缺陷 → APPROVE（confidence >= 0.8）；半数左右通过 → ESCALATE 或 REJECT 并给理由；多数不通过 → REJECT。',
    ].join('\n');
  }

  return [
    '## 验证任务',
    '',
    '你是代码变更的验证器。你的职责是审查上一轮工具调用的结果，判断修改是否正确。',
    '',
    '**审查原则**：',
    '1. 默认立场是 REJECT（假设修改有问题，需证明其正确性）',
    '2. 检查以下维度：',
    '   - 修改是否完成了用户要求的目标？',
    '   - 修改是否引入了新的错误（语法错误、类型错误、逻辑错误）？',
    '   - 修改是否破坏已有功能（回归风险）？',
    '   - 修改是否遵循了项目的编码规范？',
    '   - 是否有遗漏的边界情况？',
    '3. 如果工具调用失败，应判定为 REJECT',
    '4. 如果无法确定（置信度低），应判定为 ESCALATE',
    '',
    '## 本轮工具调用结果',
    '',
    toolResultsSummary || '(无工具调用)',
    '',
    '## 输出格式',
    '',
    '请用以下 JSON 格式输出（仅输出 JSON，不要有其他内容）。必须包含 checks 数组，每项对应一个检查维度：',
    '',
    '```json',
    '{',
    '  "verdict": "APPROVE" | "REJECT" | "ESCALATE",',
    '  "confidence": 0.0-1.0,',
    '  "feedback": "如果 REJECT 或 ESCALATE，提供具体的修复建议",',
    '  "checks": [',
    '    {"item": "修改是否完成目标", "passed": true},',
    '    {"item": "是否引入新错误", "passed": false},',
    '    {"item": "是否破坏已有功能", "passed": true},',
    '    {"item": "是否遵循编码规范", "passed": true},',
    '    {"item": "是否遗漏边界情况", "passed": true}',
    '  ]',
    '}',
    '```',
    '',
    '**判定规则**：',
    '- 所有工具调用成功 + 修改正确 → APPROVE, confidence >= 0.8',
    '- 有工具调用失败或修改有问题 → REJECT, 提供具体修复建议',
    '- 无法确定是否正确 → ESCALATE, confidence < 0.7',
  ].join('\n');
}

// ─── VerifierAgent ─────────────────────────────────────

export class VerifierAgent {
  private config: VerifierAgentConfig;
  /** 当前修复-验证循环计数 */
  private cycleCount: number = 0;
  /** 制造者模型调用（由 TAORLoopDeps 注入） */
  private callModel:
    | ((
        messages: Array<{ role: string; content: string }>,
        signal: AbortSignal
      ) => AsyncGenerator<{ content?: string }>)
    | null = null;

  constructor(config?: Partial<VerifierAgentConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 设置模型调用函数（由 TAORLoop 注入）
   */
  setCallModel(
    fn: (
      messages: Array<{ role: string; content: string }>,
      signal: AbortSignal
    ) => AsyncGenerator<{ content?: string }>
  ): void {
    this.callModel = fn;
  }

  /**
   * 验证最近一轮的工具调用结果
   *
   * @param input 验证输入（消息历史 + 工具结果）
   * @param signal 中断信号
   * @returns 验证结果
   */
  async verify(
    input: VerificationInput,
    signal: AbortSignal
  ): Promise<VerificationResult> {
    if (!this.config.enabled) {
      return { passed: true, confidence: 1.0, verdict: 'APPROVE' };
    }

    if (this.cycleCount >= this.config.maxCycles) {
      logger.warn('验证循环已达上限，强制升级', {
        sessionId: input.sessionId,
        cycleCount: this.cycleCount,
        maxCycles: this.config.maxCycles,
      });
      return {
        passed: false,
        confidence: 0,
        verdict: 'ESCALATE',
        feedback: `修复-验证循环已达上限 (${this.config.maxCycles})，需要人工介入`,
      };
    }

    if (!this.callModel) {
      logger.warn('VerifierAgent 未设置 callModel，跳过验证');
      return { passed: true, confidence: 0.5, verdict: 'APPROVE' };
    }

    this.cycleCount++;

    const prompt = buildVerificationPrompt(input);
    const messages = [
      {
        role: 'system' as const,
        // P0-3（2026-09-06）：注入 reviewGuidelines 时以"对抗评审员"语义审查（研究候选等），
        // 否则维持默认"代码审查员"（现状零变化）
        content: input.reviewGuidelines
          ? '你是一个严格的对抗评审员。只输出 JSON。'
          : '你是一个严格的代码审查员。只输出 JSON。',
      },
      { role: 'user' as const, content: prompt },
    ];

    try {
      const timeoutSignal = AbortSignal.timeout(this.config.timeoutMs);
      const combinedSignal = AbortSignal.any([signal, timeoutSignal]);

      const chunks: string[] = [];
      for await (const chunk of this.callModel(messages, combinedSignal)) {
        if (chunk.content) {
          chunks.push(chunk.content);
        }
      }

      const responseText = chunks.join('');
      const result = this._parseResponse(responseText);

      logger.info('验证完成', {
        sessionId: input.sessionId,
        turnCount: input.turnCount,
        verdict: result.verdict,
        confidence: result.confidence,
        cycleCount: this.cycleCount,
      });

      // Teamwork P2b（2026-09-06）：REJECT → pitfall 写点（P1-2 注册表；issue 蒸馏为 error）
      if (result.verdict === 'REJECT') {
        const toolName = input.toolResults[0]?.toolName ?? 'unknown';
        this.config.recordPitfall?.({
          description: `验证驳回：${toolName} 未通过对抗审查`,
          error: (result.feedback ?? '').slice(0, 500),
          source: 'verifier',
          contextSig: input.sessionId,
        });
      }

      return result;
    } catch (error) {
      await handleError(error, {
        module: 'query:verifier',
        action: '验证过程',
      });

      // 验证本身失败 → 降级为 APPROVE（不阻断主流程，但置信度极低）
      return {
        passed: true,
        confidence: 0.1, // 从 0.3 降到 0.1，明确表达不确定性
        verdict: 'APPROVE',
        feedback: `验证过程异常（${String(error).slice(0, 100)}），降级通过。请人工确认工具结果是否正确。`,
      };
    }
  }

  /**
   * 重置验证循环计数（新对话开始时调用）
   */
  reset(): void {
    this.cycleCount = 0;
  }

  /**
   * 获取当前循环计数
   */
  getCycleCount(): number {
    return this.cycleCount;
  }

  /**
   * 解析验证模型的 JSON 响应（Phase 2b: 双指标判定）
   */
  private _parseResponse(text: string): VerificationResult {
    // 尝试提取 JSON 块
    const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();

    try {
      const parsed = JSON.parse(jsonStr);

      const verdict: VerdictType = ['APPROVE', 'REJECT', 'ESCALATE'].includes(
        parsed.verdict
      )
        ? parsed.verdict
        : 'REJECT';

      const confidence =
        typeof parsed.confidence === 'number'
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.5;

      // Phase 2b: 解析 checks[] 数组并计算 CheckPassRate
      const checks: CheckItem[] = Array.isArray(parsed.checks)
        ? parsed.checks.map((c: { item: string; passed: boolean }) => ({
            item: c.item || '未知检查项',
            passed: Boolean(c.passed),
          }))
        : [];

      const totalChecks = checks.length;
      const passedChecks = checks.filter((c) => c.passed).length;
      const checkPassRate = totalChecks > 0 ? passedChecks / totalChecks : null;

      // 双指标判定逻辑：
      // 1. CheckPassRate < 0.5 → 直接 REJECT（不看 confidence）
      // 2. CheckPassRate >= 0.8 && confidence >= 0.6 → APPROVE
      // 3. CheckPassRate >= 0.5 && confidence < 0.6 → ESCALATE
      // 4. 其他 → REJECT（安全违约）
      let passed: boolean;
      let finalVerdict: VerdictType = verdict;

      if (checkPassRate !== null) {
        if (checkPassRate < 0.5) {
          finalVerdict = 'REJECT';
          passed = false;
        } else if (checkPassRate >= 0.8 && confidence >= 0.6) {
          finalVerdict = 'APPROVE';
          passed = true;
        } else if (checkPassRate >= 0.5 && confidence < 0.6) {
          finalVerdict = 'ESCALATE';
          passed = false;
        } else {
          finalVerdict = 'REJECT';
          passed = false;
        }
      } else {
        // 无 checks 数据 → 退回到单指标判定（兼容旧格式）
        passed =
          verdict === 'APPROVE' &&
          confidence >= this.config.confidenceThreshold;
        finalVerdict = verdict;
      }

      logger.info('验证解析完成（双指标）', {
        verdict: finalVerdict,
        confidence,
        checkPassRate:
          checkPassRate !== null ? checkPassRate.toFixed(2) : 'N/A',
        totalChecks,
        passedChecks,
      });

      return {
        passed,
        confidence,
        verdict: finalVerdict,
        checks: checks.length > 0 ? checks : undefined,
        checkPassRate: checkPassRate ?? undefined,
        feedback:
          verdict !== 'APPROVE'
            ? (parsed.feedback as string) || '未提供具体反馈'
            : undefined,
      };
    } catch (err) {
      // JSON 解析失败 → 降级为 APPROVE
      logger.warn('验证响应 JSON 解析失败，降级通过', {
        responsePreview: text.slice(0, 200),
      });
      return {
        passed: true,
        confidence: 0.3,
        verdict: 'APPROVE',
        feedback: '验证响应解析失败，降级通过',
      };
    }
  }
}

/** 工厂函数 */
export function createVerifierAgent(
  config?: Partial<VerifierAgentConfig>
): VerifierAgent {
  return new VerifierAgent(config);
}
