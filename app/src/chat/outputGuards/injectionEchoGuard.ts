// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 注入回显护栏（13-P2-1）：检测终稿是否**回显/泄漏**注入内容或系统提示
 *
 * 复用既有唯一实现（CS01）：`security/injection/PromptInjectionDetector` 的模式库
 * （含 `prompt_leak` / `ignore_previous` 等）与三档 severity。
 *
 * ⚠️ 刻意**不阻断**（`action:'pass'`，仅产出 info/warn）：助手回复**正当讨论**提示注入
 * （如本文档、安全分析）会命中同一模式库，阻断将把正常回复误伤为失败（CS03：不做无场景的兜底）。
 * 该信号供日志/审计消费（`guardFinalOutput` 返回 `guardIssues`）。
 */

import type { OutputGuard, OutputGuardVerdict } from '@modules/core';
import { getPromptInjectionDetector } from '@modules/security';

export const INJECTION_ECHO_GUARD = 'injection_echo';

/** 注入回显护栏（priority 20：在敏感内容护栏之后，观测打码后文本） */
export function createInjectionEchoGuard(): OutputGuard {
  return {
    name: INJECTION_ECHO_GUARD,
    priority: 20,
    check(text: string): OutputGuardVerdict {
      const result = getPromptInjectionDetector().detect(text);
      if (!result.detected) return { action: 'pass', issues: [] };

      const escalate =
        result.severity === 'high' || result.severity === 'critical';
      return {
        action: 'pass',
        issues: [
          {
            guard: INJECTION_ECHO_GUARD,
            severity: escalate ? 'warn' : 'info',
            message: `终稿疑似回显注入内容（severity=${result.severity}，patterns=${result.matchedPatterns.join(',')}）`,
          },
        ],
      };
    },
  };
}
