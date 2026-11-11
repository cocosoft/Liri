// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 命令语义注册表（P1，2026-11-12）—— 「一条命令属于哪类操作、落在哪一档」的**唯一来源**。
 *
 * ## 为什么需要
 * 此前同一件事被拆在三个文件里：`autoModeCommandTokens.ts`（两档令牌字面量）、
 * `commandAliases.ts`（等价组）、`readonly-command-allowlist.ts`（只读白名单 + 参数守卫）。
 * 结果是"补一波漏一波"：新增一种写法要同时改两三处，漏一处就静默放行
 * （本轮 P0 之前实测：`Rename-Item` 放行而 `ren` 审批、`New-Service` 放行而 `sc create` 硬拦）。
 *
 * 本表用 `CommandSpec` 描述**命令家族**：`token`（进令牌表的写法）+ `equivalents`
 * （同一操作的其他写法）+ `kind`（操作类型，供 P2/P3 做档位推导与数据流判定）。
 *
 * ## 边界（本阶段刻意不做）
 * - **硬拦表尚未迁入**：`AUTO_MODE_HARD_DENY_TOKENS` 里还有 ~380 条（大量是元字符 / 注入 /
 *   路径字面量，不是命令语义）。P1b 只迁"命令名"部分，元字符类留在结构令牌里。
 * - `readonly-command-allowlist` 尚未并入：它的判据是"参数形态 + 子命令"，与令牌表正交，
 *   P1c 再收敛。
 *
 * ⚠️ 本表**只声明语义**，不参与匹配：匹配仍是 `containsCommandToken`（命令位锚定）。
 * 档位推导见 `approvalTokensFromSpecs()` / `equivalenceGroupsFromSpecs()`。
 */

/** 操作类型（P2/P3 将据此推导档位、数据流与工作区边界） */
export type OperationKind =
  | 'read'
  | 'write'
  | 'delete'
  | 'move'
  | 'copy'
  | 'set-perm'
  | 'exec'
  | 'priv'
  | 'persist'
  | 'net-write'
  | 'pkg'
  | 'archive'
  | 'db'
  | 'cloud'
  | 'service'
  | 'proc';

/** 档位：命中**不拒绝**为 ask（转人工审批）；命中即拒绝为 deny */
export type CommandTier = 'deny' | 'ask';

export interface CommandSpec {
  /**
   * 进入档位令牌表的写法（缺省表示"仅用于等价映射"，例如容器运行时前缀 `docker`）。
   * 末尾空格在实现里会被 `trim`，保留只是为了与历史表逐字一致。
   */
  token?: string;
  /** 同一操作的其他写法（含短别名）。匹配时与 `token` 互为等价。 */
  equivalents?: readonly string[];
  kind: OperationKind;
  tier: CommandTier;
}

/**
 * 命令家族清单（P1a：审批档 + 等价组）。
 *
 * 收录口径与历史一致：**命中不拒绝、转人工确认**的命令才在 `ask` 档；
 * `deny` 档此处只登记**等价关系**（真正的硬拦令牌仍由 `autoModeCommandTokens.ts` 持有，P1b 迁移）。
 */
export const COMMAND_SPECS: readonly CommandSpec[] = [
  // ── 文件复制 / 移动 / 重命名 ─────────────────────────────────────────────
  {
    token: 'copy-item',
    equivalents: ['cpi', 'cp', 'copy'],
    kind: 'copy',
    tier: 'ask',
  },
  {
    token: 'move-item',
    equivalents: ['mi', 'mv', 'move', 'rename-item', 'ren', 'rni'],
    kind: 'move',
    tier: 'ask',
  },
  { token: 'xcopy', kind: 'copy', tier: 'ask' },
  { token: 'robocopy', kind: 'copy', tier: 'ask' },

  // ── 写文件内容 / 属性 ───────────────────────────────────────────────────
  {
    token: 'set-content',
    equivalents: [
      'sc',
      'add-content',
      'ac',
      'clear-content',
      'clc',
      'out-file',
      'tee',
      'tee-object',
      'export-csv',
    ],
    kind: 'write',
    tier: 'ask',
  },
  {
    token: 'set-itemproperty',
    equivalents: [
      'set-item',
      'si',
      'new-itemproperty',
      'remove-itemproperty',
      'clear-itemproperty',
    ],
    kind: 'write',
    tier: 'ask',
  },

  // ── 权限位 ─────────────────────────────────────────────────────────────
  {
    token: 'icacls',
    equivalents: ['set-acl', 'attrib', 'chmod'],
    kind: 'set-perm',
    tier: 'ask',
  },

  // ── 删除 / 链接 / 查找（危险子形态仍在硬拦表） ──────────────────────────
  { token: 'rm', kind: 'delete', tier: 'ask' },
  { token: 'ln', kind: 'write', tier: 'ask' },
  { token: 'mklink', kind: 'write', tier: 'ask' },
  { token: 'find', kind: 'delete', tier: 'ask' },

  // ── 归档 / 远端映射 / 进程 ─────────────────────────────────────────────
  { token: 'expand-archive', equivalents: ['compress-archive'], kind: 'archive', tier: 'ask' },
  { token: 'new-psdrive', kind: 'write', tier: 'ask' },
  { token: 'stop-process', equivalents: ['spps'], kind: 'proc', tier: 'ask' },

  // ── 仓库写操作（会改工作区 / 历史） ─────────────────────────────────────
  { token: 'git rm', kind: 'delete', tier: 'ask' },
  { token: 'git mv', kind: 'move', tier: 'ask' },
  { token: 'git checkout', kind: 'move', tier: 'ask' },
  { token: 'git switch', kind: 'move', tier: 'ask' },
  { token: 'git reset ', kind: 'move', tier: 'ask' },
  { token: 'git merge ', kind: 'write', tier: 'ask' },
  { token: 'git cherry-pick', kind: 'write', tier: 'ask' },
  { token: 'git revert ', kind: 'write', tier: 'ask' },
  { token: 'git commit', kind: 'write', tier: 'ask' },
  { token: 'git stash pop', kind: 'write', tier: 'ask' },
  { token: 'git stash apply', kind: 'write', tier: 'ask' },
  { token: 'git apply ', kind: 'write', tier: 'ask' },
  { token: 'git am ', kind: 'write', tier: 'ask' },
  { token: 'git tag ', kind: 'persist', tier: 'ask' },
  { token: 'git worktree add', kind: 'write', tier: 'ask' },
  { token: 'git config ', kind: 'persist', tier: 'ask' },

  // ── 依赖安装（本地） ───────────────────────────────────────────────────
  { token: 'bun add ', kind: 'pkg', tier: 'ask' },
  { token: 'bun install', kind: 'pkg', tier: 'ask' },
  { token: 'yarn add ', kind: 'pkg', tier: 'ask' },
  { token: 'pnpm add ', kind: 'pkg', tier: 'ask' },
  { token: 'npm add ', kind: 'pkg', tier: 'ask' },
  { token: 'npm ci', kind: 'pkg', tier: 'ask' },

  // ── 容器 / 集群 / 代码托管（只收写子命令；只读查询走只读白名单） ────────
  { equivalents: ['docker', 'podman'], kind: 'cloud', tier: 'ask' },
  { token: 'docker run', kind: 'cloud', tier: 'ask' },
  { token: 'docker exec', kind: 'cloud', tier: 'ask' },
  { token: 'docker cp', kind: 'cloud', tier: 'ask' },
  { token: 'docker rm', kind: 'cloud', tier: 'ask' },
  { token: 'docker rmi', kind: 'cloud', tier: 'ask' },
  { token: 'docker push', kind: 'cloud', tier: 'ask' },
  { token: 'docker system prune', kind: 'cloud', tier: 'ask' },
  { token: 'kubectl apply', kind: 'cloud', tier: 'ask' },
  { token: 'kubectl create', kind: 'cloud', tier: 'ask' },
  { token: 'kubectl delete', kind: 'cloud', tier: 'ask' },
  { token: 'kubectl patch', kind: 'cloud', tier: 'ask' },
  { token: 'kubectl replace', kind: 'cloud', tier: 'ask' },
  { token: 'kubectl scale', kind: 'cloud', tier: 'ask' },
  { token: 'kubectl edit', kind: 'cloud', tier: 'ask' },
  { token: 'kubectl drain', kind: 'cloud', tier: 'ask' },
  { token: 'kubectl cordon', kind: 'cloud', tier: 'ask' },
  { token: 'kubectl rollout', kind: 'cloud', tier: 'ask' },
  { token: 'kubectl exec', kind: 'cloud', tier: 'ask' },
  { token: 'gh pr merge', kind: 'cloud', tier: 'ask' },
  { token: 'gh release delete', kind: 'cloud', tier: 'ask' },
  { token: 'gh repo delete', kind: 'cloud', tier: 'ask' },

  // ── deny 档：此处只登记等价关系（硬拦令牌仍在 autoModeCommandTokens.ts） ──
  {
    token: 'remove-item',
    equivalents: ['ri', 'del', 'erase', 'rd', 'rmdir'],
    kind: 'delete',
    tier: 'deny',
  },
  {
    token: 'format-volume',
    equivalents: ['initialize-disk', 'clear-disk'],
    kind: 'priv',
    tier: 'deny',
  },
  { token: 'invoke-expression', equivalents: ['iex'], kind: 'exec', tier: 'deny' },
  { token: 'start-process', equivalents: ['saps'], kind: 'exec', tier: 'deny' },
];

/** 审批档的**令牌**（不含元字符/参数类结构令牌，那些仍在 `autoModeCommandTokens.ts`） */
export function approvalTokensFromSpecs(): string[] {
  return COMMAND_SPECS.filter(
    (spec): spec is CommandSpec & { token: string } =>
      spec.tier === 'ask' && typeof spec.token === 'string'
  ).map((spec) => spec.token);
}

/**
 * 等价组（组内首项为代表写法）。
 *
 * 仅用于 `expandTokenAliases()`：判定时对**代表令牌**展开同组写法，
 * 因此新增方言只需在 `COMMAND_SPECS` 里补 `equivalents`。
 */
export function equivalenceGroupsFromSpecs(): readonly (readonly string[])[] {
  return COMMAND_SPECS.filter(
    (spec) => (spec.equivalents?.length ?? 0) > 0
  ).map((spec) => {
    const equivalents = spec.equivalents ?? [];
    // 无 `token` 的条目（如容器运行时前缀）以**首个等价写法**为代表，
    // 且不得把自己重复放进同组（否则 `COMMAND_ALIASES` 会出现自映射）。
    if (spec.token) return [spec.token, ...equivalents];
    const [representative, ...rest] = equivalents;
    return [representative!, ...rest];
  });
}
