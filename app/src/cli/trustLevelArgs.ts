// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * trustLevel — `--trust-level` 参数解析与**二次确认**（Q-31 / §9-17，2026-10-23）
 *
 * 背景：`--trust-level` 会让**未匹配信任工作区**的所有目录降级（`development` 等价
 * "bash 非 deny 一律 allow"）⇒ 一条 CLI 参数即可放宽全机命令审批。拍板口径：
 * **默认关闭**；必须同时传入 `--confirm-global-trust` 才生效，否则**忽略并告警**。
 *
 * 外移原因：`main.ts` 已触 R04-001 的 2000 行上限；本模块只做纯参数解析 + 审计留痕。
 */

import { getLogger } from '@modules/monitoring';
// PR-3c（2026-10-23）：全局信任级别变更落安全审计通道（`/v1/security/audit-logs` 可查）
import { logSecurityAuditEvent } from '@modules/security';

// 日志模块名沿用 `main` ⇒ 与迁移前日志输出逐字一致（便于既有排查口径）
const logger = getLogger('main');

/** 全局信任级别的显式确认开关（第二道确认） */
export const TRUST_LEVEL_CONFIRM_FLAG = '--confirm-global-trust';

/** 合法信任级别（与 `SecurityIntegration` / 配置校验同域） */
const VALID_TRUST_LEVELS = ['chat', 'work', 'development'];

/** 审计落盘（启动期无会话 ⇒ sessionId 记空串；失败内部降级，不阻断启动） */
function auditTrustLevel(requested: string, applied: boolean, reason: string) {
  logSecurityAuditEvent({
    timestamp: new Date(),
    command: `--trust-level ${requested}`,
    originalCommand: `--trust-level ${requested}`,
    truncatedResult: applied
      ? 'global trust level applied (confirmed)'
      : `global trust level ignored: ${reason}`,
    sessionContext: {
      sessionId: '',
      taskDescription: 'cli launch',
      // 语言无关取值（`normal` 属已登记状态词汇，避免在新文件新增出现点）
      currentMode: 'auto',
    },
    matchedRules: ['approval:trust'],
    behavior: applied ? 'allow' : 'deny',
    decision: applied ? 'auto_allowed' : 'auto_denied',
    riskLevel: 'shell',
  });
}

/** 是否已显式确认全局信任级别 */
export function isTrustLevelConfirmed(args: string[]): boolean {
  return args.includes(TRUST_LEVEL_CONFIRM_FLAG);
}

/** 从参数里找 `--trust-level` 的合法取值（**不做**确认判定） */
export function findTrustLevelArg(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--trust-level' && i + 1 < args.length) {
      const level = args[i + 1].toLowerCase();
      if (VALID_TRUST_LEVELS.includes(level)) return level;
    }
    if (args[i].startsWith('--trust-level=')) {
      const level = args[i].split('=')[1].toLowerCase();
      if (VALID_TRUST_LEVELS.includes(level)) return level;
    }
  }
  return undefined;
}

/**
 * 解析 `--trust-level`（含二次确认）。
 *
 * - 未传或取值非法 ⇒ `undefined`（与改造前一致）；
 * - 传了但**未** `--confirm-global-trust` ⇒ **忽略** + 告警 + 审计 `approval:trust`（applied:false）；
 * - 确认齐全 ⇒ 返回级别 + 审计 `approval:trust`（applied:true）。
 */
export function parseTrustLevelFromArgs(args?: string[]): string | undefined {
  if (!args) return undefined;
  const level = findTrustLevelArg(args);
  if (!level) return undefined;

  if (!isTrustLevelConfirmed(args)) {
    logger.warning(
      `--trust-level ${level} 已忽略：该参数会让所有未匹配信任工作区的目录降级（bash 不再逐条询问）。` +
        `如确需启用，请同时传入 ${TRUST_LEVEL_CONFIRM_FLAG}。`,
      {
        audit: 'approval:trust',
        requested: level,
        applied: false,
        reason: 'confirm-missing',
        confirmFlag: TRUST_LEVEL_CONFIRM_FLAG,
      }
    );
    auditTrustLevel(level, false, 'confirm-missing');
    return undefined;
  }

  logger.info('approval:trust 全局信任级别已显式启用', {
    requested: level,
    applied: true,
  });
  auditTrustLevel(level, true, 'confirmed');
  return level;
}
