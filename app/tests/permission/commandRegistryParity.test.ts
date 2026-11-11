// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P1 迁移等价性（2026-11-12）
 *
 * 立论（方案 §7 P1 验收）：`AUTO_MODE_APPROVAL_TOKENS` 由字面表改为 `COMMAND_SPECS` 派生后，
 * **旧表里的每一种写法仍必须命中审批档** —— 否则"收敛单一来源"会以静默放宽为代价。
 *
 * 本文件用**旧表的原始令牌清单**做对拍：
 *   - 每条旧令牌要么是派生表的 token，
 *   - 要么是某个等价组的成员（由 `expandTokenAliases()` 展开命中）。
 */

import { describe, expect, it } from 'bun:test';
import {
  AUTO_MODE_APPROVAL_TOKENS,
  COMMAND_EQUIVALENCE_GROUPS,
  COMMAND_SPECS,
} from '@openliri/infra/security';

/** 迁移前 `AUTO_MODE_APPROVAL_TOKENS` 的逐字快照（P0 收尾时的形态） */
const LEGACY_APPROVAL_TOKENS = [
  ' -force',
  '-itemtype symboliclink',
  '-outfile',
  'add-content',
  'attrib ',
  'bun add ',
  'bun install',
  'chmod ',
  'clear-content',
  'clear-itemproperty',
  'compress-archive',
  'copy ',
  'copy-item',
  'cp ',
  'cpi ',
  'docker cp',
  'docker exec',
  'docker push',
  'docker rm',
  'docker rmi',
  'docker run',
  'docker system prune',
  'expand-archive',
  'export-csv',
  'find ',
  'gh pr merge',
  'gh release delete',
  'gh repo delete',
  'git am ',
  'git apply ',
  'git checkout',
  'git cherry-pick',
  'git commit',
  'git config ',
  'git merge ',
  'git mv',
  'git reset ',
  'git revert ',
  'git rm',
  'git stash apply',
  'git stash pop',
  'git switch',
  'git tag ',
  'git worktree add',
  'icacls ',
  'kubectl apply',
  'kubectl cordon',
  'kubectl create',
  'kubectl delete',
  'kubectl drain',
  'kubectl edit',
  'kubectl exec',
  'kubectl patch',
  'kubectl replace',
  'kubectl rollout',
  'kubectl scale',
  'ln ',
  'mi ',
  'mklink ',
  'move ',
  'move-item',
  'mv ',
  'new-itemproperty',
  'new-psdrive',
  'npm add ',
  'npm ci',
  'out-file',
  'pnpm add ',
  'remove-itemproperty',
  'ren ',
  'rm ',
  'robocopy ',
  'set-acl',
  'set-content',
  'set-itemproperty',
  'spps',
  'stop-process',
  'tee ',
  'tee-object',
  'xcopy ',
  'yarn add ',
] as const;

const normalize = (token: string): string => token.trim().toLowerCase();

describe('P1：审批档由 CommandSpec 派生后与旧表等价', () => {
  it('旧表每条写法仍落在审批档（派生 token 或等价组成员）', () => {
    const derived = new Set(AUTO_MODE_APPROVAL_TOKENS.map(normalize));
    const groupMembers = new Set(
      COMMAND_EQUIVALENCE_GROUPS.flatMap((group) => group.map(normalize))
    );
    for (const legacy of LEGACY_APPROVAL_TOKENS) {
      const head = normalize(legacy);
      expect(
        derived.has(head) || groupMembers.has(head),
        `旧令牌 "${legacy}" 未映射到派生表：请补进 COMMAND_SPECS`
      ).toBe(true);
    }
  });

  it('等价组内部同档（不得跨 deny / ask）', () => {
    const tierByName = new Map<string, string>();
    for (const spec of COMMAND_SPECS) {
      for (const name of [spec.token, ...(spec.equivalents ?? [])]) {
        if (!name) continue;
        tierByName.set(normalize(name), spec.tier);
      }
    }
    for (const group of COMMAND_EQUIVALENCE_GROUPS) {
      const tiers = new Set(
        group.map((member) => tierByName.get(normalize(member)))
      );
      expect(tiers.size).toBe(1);
    }
  });

  it('每个 spec 至少声明 token 或 equivalents（否则是空条目）', () => {
    for (const spec of COMMAND_SPECS) {
      expect(Boolean(spec.token) || (spec.equivalents?.length ?? 0) > 0).toBe(
        true
      );
    }
  });
});
