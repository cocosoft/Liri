// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * commandPolicyVersion —— LRO-13：**命令判定策略版本**（让旧结论自动失效）。
 *
 * 台账键含策略版本：只要"判定依据"发生变化，历史"该命令不可执行"的结论就**不再命中**
 * （避免策略放松后仍被旧结论短路）。
 *
 * 参与摘要的因子（任一变化 ⇒ 新版本）：
 *   ① `APP_VERSION`（随包发版 ⇒ 内置危险词表/白名单/沙箱策略可能已变）；
 *   ② 权限模式 `permissionMode` 与默认信任级别 `defaultTrustLevel`（bash 姿态按信任级别分支）；
 *   ③ Bash 三个安全开关（`BASH_APPROVED_REVALIDATE` / `BASH_INTERPRETER_GUARD` / `BASH_APPROVAL_STRICT`）；
 *   ④ 权限规则集合的签名（`RuleManager.loadRules()` 的 `source|behavior|tool|pattern|fingerprint` 排序拼接）。
 *
 * **边界（如实）**：同进程内修改规则后，本函数会重新计算（不缓存）⇒ 新版本生效；
 * 但**已写入台账的条目**保留其旧版本，只在新查询时因键不同而自然不命中。
 */

import { createHash } from 'node:crypto';
import { APP_VERSION } from '@modules/constants';
import { feature } from '@openliri/kernel';
import { securityIntegrationService } from '@modules/security';
import { RuleManager } from '@modules/permission';

/** 参与版本摘要的 Bash 安全开关（与 `BashTool` 的灰度清单同源） */
const BASH_POLICY_FLAGS = [
  'BASH_APPROVED_REVALIDATE',
  'BASH_INTERPRETER_GUARD',
  'BASH_APPROVAL_STRICT',
] as const;

/** 权限规则集合签名（规则文件读取失败 ⇒ 固定占位，绝不冒充"无规则"） */
function rulesSignature(): string {
  try {
    const rules = new RuleManager().loadRules();
    return rules
      .map((r) =>
        [
          r.source,
          r.behavior,
          r.toolName ?? '',
          r.contentPattern ?? '',
          r.inputFingerprint ?? '',
        ].join('|')
      )
      .sort()
      .join(';');
  } catch {
    // @ignore-catch — 规则读取失败不阻塞执行；用固定占位使版本稳定（不会误命中"看起来一样"的版本）
    return 'rules-unavailable';
  }
}

/**
 * 当前策略版本（16 位十六进制）。
 *
 * 每次调用重算（规则文件小、调用点在**每步执行**与**任务恢复**，不在工具热路径）。
 */
export function resolveCommandPolicyVersion(): string {
  const parts = [
    APP_VERSION,
    String(securityIntegrationService.getPermissionMode()),
    securityIntegrationService.getDefaultTrustLevel() ?? '-',
    ...BASH_POLICY_FLAGS.map((f) => `${f}=${feature(f)}`),
    rulesSignature(),
  ];
  return createHash('sha256')
    .update(parts.join('\u0000'))
    .digest('hex')
    .slice(0, 16);
}
