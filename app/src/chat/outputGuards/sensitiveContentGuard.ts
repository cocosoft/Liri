// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 敏感内容护栏（13-P2-1）：PII/密钥 → **打码**（默认）或 **阻断**（`OUTPUT_GUARD_BLOCK`）
 *
 * 复用既有唯一实现（CS01）：`security/services/SensitiveDataService` 的
 * `sanitize()`（打码）与 `createFriendlyErrorMessage()`（用户可读阻断提示）。
 *
 * ⚠️ 刻意**不用** `detectSensitiveData()`：其 `SENSITIVE_PATTERNS` 带 `/g` 且以 `.test()` 判定，
 * 连续调用会因 `lastIndex` 残留而**交替返回 true/false**（既有缺陷，见台账）。
 * 本护栏改用 `sanitize()` 的"文本是否变化"判定 —— `String.replace(/(...)/g)` 无该状态残留问题。
 */

import { feature } from '@modules/core';
import type { OutputGuard, OutputGuardVerdict } from '@modules/core';
import { SensitiveErrorType, sensitiveDataService } from '@modules/security';

export const SENSITIVE_CONTENT_GUARD = 'sensitive_content';

/** 敏感内容护栏（priority 10：先于注入回显执行） */
export function createSensitiveContentGuard(): OutputGuard {
  return {
    name: SENSITIVE_CONTENT_GUARD,
    priority: 10,
    check(text: string): OutputGuardVerdict {
      const sanitized = sensitiveDataService.sanitize(text);
      if (sanitized === text) return { action: 'pass', issues: [] };

      if (feature('OUTPUT_GUARD_BLOCK')) {
        return {
          action: 'block',
          // 复用既有用户可读文案（CS01：不另造提示语）
          text: sensitiveDataService.createFriendlyErrorMessage({
            type: SensitiveErrorType.SENSITIVE_DATA_DETECTED,
            message: 'output contains sensitive data',
            timestamp: Date.now(),
          }),
          issues: [
            {
              guard: SENSITIVE_CONTENT_GUARD,
              severity: 'block',
              message: '终稿包含敏感内容（PII/密钥），已按策略阻断',
            },
          ],
        };
      }

      return {
        action: 'redact',
        text: sanitized,
        issues: [
          {
            guard: SENSITIVE_CONTENT_GUARD,
            severity: 'warn',
            message: '终稿包含敏感内容（PII/密钥），已打码',
          },
        ],
      };
    },
  };
}
