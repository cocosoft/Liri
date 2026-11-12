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

// P1c（2026-11-12）：只读子命令的唯一事实源在 `readOnlyCommands.ts`（门禁的 CANONICAL_FILES.readOnly）
import {
  AUTO_MODE_DOCKER_READONLY_SUBCOMMANDS,
  AUTO_MODE_GH_READONLY_SUBCOMMANDS,
  AUTO_MODE_GIT_READONLY_SUBCOMMANDS,
  AUTO_MODE_KUBECTL_READONLY_SUBCOMMANDS,
} from '../readOnlyCommands';

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
  /**
   * 操作类型。P1a 的审批档条目已声明；P1b 从历史硬拦表迁入的存量条目**暂缺**
   * （当时只按名字分档，没有语义分类），P2 再按 `OperationKind` 补齐。
   */
  kind?: OperationKind;
  /**
   * 档位。**缺省 = 仅登记元数据**（例如只读子命令清单），不产生任何令牌。
   * 两档令牌的派生只认 `tier === 'ask' | 'deny'`。
   */
  tier?: CommandTier;
  /**
   * 该命令的**只读子命令**（P1c）：读侧（`readonly-command-allowlist`）与
   * 写侧（令牌表）共用同一份注册表，避免"读放行、写审批"两处各列一遍。
   */
  readonlySubcommands?: ReadonlySet<string>;
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
  {
    equivalents: ['docker', 'podman'],
    kind: 'cloud',
    tier: 'ask',
    readonlySubcommands: AUTO_MODE_DOCKER_READONLY_SUBCOMMANDS,
  },
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

  // ── P1c：只读子命令（不产生令牌，读侧与写侧共用） ───────────────────────
  {
    equivalents: ['git'],
    kind: 'read',
    readonlySubcommands: AUTO_MODE_GIT_READONLY_SUBCOMMANDS,
  },
  {
    equivalents: ['kubectl'],
    kind: 'read',
    readonlySubcommands: AUTO_MODE_KUBECTL_READONLY_SUBCOMMANDS,
  },
  {
    equivalents: ['gh'],
    kind: 'read',
    readonlySubcommands: AUTO_MODE_GH_READONLY_SUBCOMMANDS,
  },

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
  // ── 硬拦档：P1b 从 autoModeCommandTokens.ts 迁入的单命令（2026-11-12） ──
  // 结构 / 参数 / 注入类令牌仍留在 `autoModeCommandTokens.ts`（无法用命令家族表达）。
  // 注：这批存量条目暂不声明 `kind`（P2 按 OperationKind 补齐），档位仍为 deny。
  { token: 'format', kind: 'priv', tier: 'deny' },
  { token: 'mkfs', kind: 'priv', tier: 'deny' },
  { token: 'sudo', kind: 'priv', tier: 'deny' },
  { token: 'pkexec', kind: 'priv', tier: 'deny' },
  { token: 'doas', kind: 'priv', tier: 'deny' },
  { token: 'eval ', kind: 'exec', tier: 'deny' },
  { token: 'exec ', kind: 'exec', tier: 'deny' },
  { token: 'source ', kind: 'exec', tier: 'deny' },
  { token: 'crontab', kind: 'persist', tier: 'deny' },
  { token: 'at ', kind: 'persist', tier: 'deny' },
  { token: 'batch ', kind: 'persist', tier: 'deny' },
  { token: 'anacron', kind: 'persist', tier: 'deny' },
  { token: 'wmic ', kind: 'priv', tier: 'deny' },
  { token: 'takeown ', kind: 'priv', tier: 'deny' },
  { token: 'add-localgroupmember', tier: 'deny' },
  { token: 'set-localuser', tier: 'deny' },
  { token: 'new-localuser', tier: 'deny' },
  { token: 'remove-localuser', tier: 'deny' },
  { token: 'set-executionpolicy', kind: 'priv', tier: 'deny' },
  { token: 'set-mppreference', kind: 'priv', tier: 'deny' },
  { token: 'add-mppreference', kind: 'priv', tier: 'deny' },
  { token: 'disable-windowsoptionalfeature', kind: 'priv', tier: 'deny' },
  { token: 'enable-windowsoptionalfeature', kind: 'priv', tier: 'deny' },
  { token: 'uninstall-windowsfeature', kind: 'priv', tier: 'deny' },
  { token: 'bcdedit', kind: 'priv', tier: 'deny' },
  { token: 'register-scheduledtask', kind: 'persist', tier: 'deny' },
  { token: 'unregister-scheduledtask', kind: 'persist', tier: 'deny' },
  { token: 'new-service', kind: 'persist', tier: 'deny' },
  { token: 'set-service', kind: 'persist', tier: 'deny' },
  { token: 'remove-service', kind: 'persist', tier: 'deny' },
  { token: 'wsl ', tier: 'deny' },
  { token: 'enter-pssession', tier: 'deny' },
  { token: 'new-pssession', tier: 'deny' },
  { token: 'invoke-command', tier: 'deny' },
  { token: 'scp ', kind: 'net-write', tier: 'deny' },
  { token: 'mknod ', kind: 'priv', tier: 'deny' },
  { token: 'setcap ', kind: 'priv', tier: 'deny' },
  { token: 'npx ', kind: 'pkg', tier: 'deny' },
  { token: 'bunx ', kind: 'pkg', tier: 'deny' },
  { token: 'install-module', kind: 'pkg', tier: 'deny' },
  { token: 'install-package', kind: 'pkg', tier: 'deny' },
  { token: 'install-script', kind: 'pkg', tier: 'deny' },
  { token: 'clear-recyclebin', kind: 'priv', tier: 'deny' },
  { token: 'start ', tier: 'deny' },
  { token: 'runas ', kind: 'priv', tier: 'deny' },
  { token: 'regsvr32 ', kind: 'exec', tier: 'deny' },
  { token: 'msiexec ', kind: 'exec', tier: 'deny' },
  { token: 'add-type', tier: 'deny' },
  { token: 'import-module', tier: 'deny' },
  { token: 'deno ', kind: 'exec', tier: 'deny' },
  { token: 'nc ', kind: 'net-write', tier: 'deny' },
  { token: 'netcat ', kind: 'net-write', tier: 'deny' },
  { token: 'telnet ', kind: 'net-write', tier: 'deny' },
  { token: 'ftp ', kind: 'net-write', tier: 'deny' },
  { token: 'sftp ', kind: 'net-write', tier: 'deny' },
  { token: 'ssh ', kind: 'net-write', tier: 'deny' },
  { token: 'ncat ', kind: 'net-write', tier: 'deny' },
  { token: 'socat ', kind: 'net-write', tier: 'deny' },
  { token: 'curl ', kind: 'net-write', tier: 'deny' },
  { token: 'wget ', kind: 'net-write', tier: 'deny' },
  { token: 'service ', kind: 'persist', tier: 'deny' },
  { token: 'ptrace', tier: 'deny' },
  { token: 'LD_PRELOAD', tier: 'deny' },
  { token: 'kmod', kind: 'priv', tier: 'deny' },
  { token: 'insmod', kind: 'priv', tier: 'deny' },
  { token: 'rmmod', kind: 'priv', tier: 'deny' },
  { token: 'modprobe', kind: 'priv', tier: 'deny' },
  { token: 'tcpdump ', kind: 'net-write', tier: 'deny' },
  { token: 'tshark ', kind: 'net-write', tier: 'deny' },
  { token: 'wireshark ', kind: 'net-write', tier: 'deny' },
  { token: 'nmap ', kind: 'net-write', tier: 'deny' },
  { token: 'masscan ', kind: 'net-write', tier: 'deny' },
  { token: 'zmap ', kind: 'net-write', tier: 'deny' },
  { token: 'unicornscan ', kind: 'net-write', tier: 'deny' },
  { token: 'hping ', kind: 'net-write', tier: 'deny' },
  { token: 'arpspoof ', kind: 'net-write', tier: 'deny' },
  { token: 'dnsspoof ', kind: 'net-write', tier: 'deny' },
  { token: 'tcpspoof ', kind: 'net-write', tier: 'deny' },
  { token: 'UPDATE ', tier: 'deny' },
  { token: 'DELETE ', tier: 'deny' },
  { token: 'ReflectionClass', tier: 'deny' },
  { token: 'getMethod', tier: 'deny' },
  { token: 'invoke', tier: 'deny' },
  { token: 'call_user_func', tier: 'deny' },
  { token: 'array_filter', tier: 'deny' },
  { token: 'array_map', tier: 'deny' },
  { token: 'usort', tier: 'deny' },
  { token: 'uasort', tier: 'deny' },
  { token: 'uksort', tier: 'deny' },
  { token: 'sleep ', kind: 'proc', tier: 'deny' },
  { token: 'usleep ', tier: 'deny' },
  { token: 'nanosleep ', tier: 'deny' },
  { token: 'pause ', tier: 'deny' },
  { token: 'wait ', kind: 'proc', tier: 'deny' },
  { token: 'yes ', kind: 'proc', tier: 'deny' },
  { token: 'env', tier: 'deny' },
  { token: 'printenv', tier: 'deny' },
  { token: 'export', tier: 'deny' },
  { token: 'useradd ', kind: 'priv', tier: 'deny' },
  { token: 'userdel ', kind: 'priv', tier: 'deny' },
  { token: 'usermod ', kind: 'priv', tier: 'deny' },
  { token: 'groupadd ', kind: 'priv', tier: 'deny' },
  { token: 'groupdel ', kind: 'priv', tier: 'deny' },
  { token: 'groupmod ', kind: 'priv', tier: 'deny' },
  { token: 'passwd ', kind: 'priv', tier: 'deny' },
  { token: 'chpasswd', kind: 'priv', tier: 'deny' },
  { token: 'mkfifo', tier: 'deny' },
  { token: 'script ', tier: 'deny' },
  { token: 'xinput ', tier: 'deny' },
  { token: 'evtest ', tier: 'deny' },
  { token: 'scrot ', tier: 'deny' },
  { token: 'import ', tier: 'deny' },
  { token: 'xwd ', tier: 'deny' },
  { token: 'fswebcam ', tier: 'deny' },
  { token: 'cheese ', tier: 'deny' },
  { token: 'guvcview ', tier: 'deny' },
  { token: 'arecord ', tier: 'deny' },
  { token: 'sox ', tier: 'deny' },
  { token: 'ffmpeg ', tier: 'deny' },
  { token: 'aplay ', tier: 'deny' },
  { token: 'mpg123 ', tier: 'deny' },
  { token: 'ffplay ', tier: 'deny' },
  { token: 'lsusb ', tier: 'deny' },
  { token: 'usb-devices ', tier: 'deny' },
  { token: 'usbmount ', tier: 'deny' },
  { token: 'eject ', tier: 'deny' },
  { token: 'lsblk ', tier: 'deny' },
  { token: 'fdisk ', kind: 'priv', tier: 'deny' },
  { token: 'parted ', kind: 'priv', tier: 'deny' },
  { token: 'blkid ', tier: 'deny' },
  { token: 'mdadm ', kind: 'priv', tier: 'deny' },
  { token: 'lvm ', tier: 'deny' },
  { token: 'vgcreate ', kind: 'priv', tier: 'deny' },
  { token: 'lvcreate ', kind: 'priv', tier: 'deny' },
  { token: 'fsck ', kind: 'priv', tier: 'deny' },
  { token: 'e2fsck ', kind: 'priv', tier: 'deny' },
  { token: 'xfs_repair ', kind: 'priv', tier: 'deny' },
  { token: 'mkfs ', kind: 'priv', tier: 'deny' },
  { token: 'mke2fs ', kind: 'priv', tier: 'deny' },
  { token: 'sfdisk ', kind: 'priv', tier: 'deny' },
  { token: 'cfdisk ', kind: 'priv', tier: 'deny' },
  { token: 'gdisk ', kind: 'priv', tier: 'deny' },
  { token: 'shred ', kind: 'delete', tier: 'deny' },
  { token: 'testdisk ', kind: 'delete', tier: 'deny' },
  { token: 'photorec ', kind: 'delete', tier: 'deny' },
  { token: 'foremost ', kind: 'delete', tier: 'deny' },
  { token: 'scalpel ', kind: 'delete', tier: 'deny' },
  { token: 'tar ', kind: 'archive', tier: 'deny' },
  { token: 'cpio ', kind: 'archive', tier: 'deny' },
  { token: 'dump ', kind: 'archive', tier: 'deny' },
  { token: 'restore ', kind: 'archive', tier: 'deny' },
  { token: 'rsync ', kind: 'net-write', tier: 'deny' },
  { token: 'gzip ', kind: 'archive', tier: 'deny' },
  { token: 'bzip2 ', kind: 'archive', tier: 'deny' },
  { token: 'xz ', kind: 'archive', tier: 'deny' },
  { token: 'zip ', kind: 'archive', tier: 'deny' },
  { token: 'unzip ', kind: 'archive', tier: 'deny' },
  { token: 'rar ', kind: 'archive', tier: 'deny' },
  { token: 'unrar ', kind: 'archive', tier: 'deny' },
  { token: 'hdfs ', tier: 'deny' },
  { token: 'glusterfs ', tier: 'deny' },
  { token: 'ceph ', tier: 'deny' },
  { token: 'nfs ', tier: 'deny' },
  { token: 'svn ', tier: 'deny' },
  { token: 'hg ', tier: 'deny' },
  { token: 'bzr ', tier: 'deny' },
  { token: 'apt ', kind: 'pkg', tier: 'deny' },
  { token: 'apt-get ', kind: 'pkg', tier: 'deny' },
  { token: 'dpkg ', kind: 'pkg', tier: 'deny' },
  { token: 'rpm ', kind: 'pkg', tier: 'deny' },
  { token: 'yum ', kind: 'pkg', tier: 'deny' },
  { token: 'dnf ', kind: 'pkg', tier: 'deny' },
  { token: 'pacman ', kind: 'pkg', tier: 'deny' },
  { token: 'zypper ', kind: 'pkg', tier: 'deny' },
  { token: 'reboot', tier: 'deny' },
  { token: 'shutdown', tier: 'deny' },
  { token: 'halt', tier: 'deny' },
  { token: 'poweroff', tier: 'deny' },
  { token: 'dmidecode ', tier: 'deny' },
  { token: 'hdparm ', tier: 'deny' },
  { token: 'smartctl ', tier: 'deny' },
  { token: 'pidof ', kind: 'proc', tier: 'deny' },
  { token: 'pgrep ', kind: 'proc', tier: 'deny' },
  { token: 'pkill ', kind: 'proc', tier: 'deny' },
  { token: 'ifconfig ', kind: 'net-write', tier: 'deny' },
  { token: 'ip ', kind: 'net-write', tier: 'deny' },
  { token: 'route ', kind: 'net-write', tier: 'deny' },
  { token: 'netstat ', kind: 'net-write', tier: 'deny' },
  { token: 'ss ', kind: 'net-write', tier: 'deny' },
  { token: 'arp ', kind: 'net-write', tier: 'deny' },
  { token: 'ping ', kind: 'net-write', tier: 'deny' },
  { token: 'traceroute ', kind: 'net-write', tier: 'deny' },
  { token: 'mtr ', kind: 'net-write', tier: 'deny' },
  { token: 'dig ', kind: 'net-write', tier: 'deny' },
  { token: 'nslookup ', kind: 'net-write', tier: 'deny' },
  { token: 'host ', kind: 'net-write', tier: 'deny' },
  { token: 'dnsmasq ', kind: 'net-write', tier: 'deny' },
  { token: 'systemctl ', kind: 'persist', tier: 'deny' },
  { token: 'chkconfig ', kind: 'persist', tier: 'deny' },
  { token: 'journalctl ', tier: 'deny' },
  { token: 'dmesg ', tier: 'deny' },
  { token: 'logrotate ', kind: 'persist', tier: 'deny' },
  { token: 'rsyslogd ', kind: 'persist', tier: 'deny' },
  { token: 'syslogd ', kind: 'persist', tier: 'deny' },
  { token: 'chown ', kind: 'priv', tier: 'deny' },
  { token: 'chgrp ', kind: 'priv', tier: 'deny' },
  { token: 'chattr ', kind: 'priv', tier: 'deny' },
  { token: 'setfacl ', kind: 'priv', tier: 'deny' },
  { token: 'getfacl ', kind: 'priv', tier: 'deny' },
  { token: 'sort ', tier: 'deny' },
  { token: 'sed ', kind: 'write', tier: 'deny' },
  { token: 'awk ', kind: 'write', tier: 'deny' },
  { token: 'iconv ', kind: 'write', tier: 'deny' },
  { token: 'dos2unix ', kind: 'write', tier: 'deny' },
  { token: 'unix2dos ', kind: 'write', tier: 'deny' },
  { token: 'split ', kind: 'write', tier: 'deny' },
  { token: 'csplit ', kind: 'write', tier: 'deny' },
  { token: 'openssl ', tier: 'deny' },
  { token: 'gpg ', tier: 'deny' },
  { token: 'cryptsetup ', kind: 'priv', tier: 'deny' },
  { token: 'keytool ', tier: 'deny' },
  { token: 'keystore ', tier: 'deny' },
  { token: 'date ', tier: 'deny' },
  { token: 'time ', tier: 'deny' },
  { token: 'timeout ', tier: 'deny' },
  { token: 'gcc ', kind: 'exec', tier: 'deny' },
  { token: 'clang ', kind: 'exec', tier: 'deny' },
  { token: 'make ', kind: 'exec', tier: 'deny' },
  { token: 'cmake ', kind: 'exec', tier: 'deny' },
  { token: 'autoconf ', kind: 'exec', tier: 'deny' },
  { token: 'automake ', kind: 'exec', tier: 'deny' },
  { token: 'python ', kind: 'exec', tier: 'deny' },
  { token: 'perl ', kind: 'exec', tier: 'deny' },
  { token: 'ruby ', kind: 'exec', tier: 'deny' },
  { token: 'node ', kind: 'exec', tier: 'deny' },
  { token: 'php ', kind: 'exec', tier: 'deny' },
  { token: 'lua ', kind: 'exec', tier: 'deny' },
  { token: 'tcl ', kind: 'exec', tier: 'deny' },
  { token: 'gdb ', kind: 'exec', tier: 'deny' },
  { token: 'lldb ', kind: 'exec', tier: 'deny' },
  { token: 'strace ', kind: 'exec', tier: 'deny' },
  { token: 'ltrace ', kind: 'exec', tier: 'deny' },
  { token: 'valgrind ', kind: 'exec', tier: 'deny' },
  { token: 'perf ', kind: 'exec', tier: 'deny' },
  { token: 'dtrace ', kind: 'exec', tier: 'deny' },
  { token: 'prometheus ', tier: 'deny' },
  { token: 'grafana-cli ', tier: 'deny' },
  { token: 'influx ', tier: 'deny' },
  { token: 'telegraf ', tier: 'deny' },
  { token: 'collectd ', tier: 'deny' },
  { token: 'fluentd ', tier: 'deny' },
  { token: 'logstash ', tier: 'deny' },
  { token: 'filebeat ', tier: 'deny' },
  { token: 'nessus ', tier: 'deny' },
  { token: 'openvas ', tier: 'deny' },
  { token: 'metasploit ', tier: 'deny' },
  { token: 'sqlmap ', tier: 'deny' },
  { token: 'burpsuite ', tier: 'deny' },
  { token: 'john ', tier: 'deny' },
  { token: 'hashcat ', tier: 'deny' },
  { token: 'hydra ', tier: 'deny' },
  { token: 'medusa ', tier: 'deny' },
  { token: 'crunch ', tier: 'deny' },
  { token: 'dd ', kind: 'delete', tier: 'deny' },
  { token: 'strings ', tier: 'deny' },
  { token: 'hexdump ', tier: 'deny' },
  { token: 'xxd ', tier: 'deny' },
  { token: 'objdump ', tier: 'deny' },
  { token: 'readelf ', tier: 'deny' },
  { token: 'nm ', tier: 'deny' },
  { token: 'ld ', kind: 'exec', tier: 'deny' },
  { token: 'strip ', kind: 'exec', tier: 'deny' },
  { token: 'upx ', kind: 'exec', tier: 'deny' },
  { token: 'msfconsole ', kind: 'exec', tier: 'deny' },
  { token: 'proxychains ', kind: 'net-write', tier: 'deny' },
  { token: 'tor ', kind: 'net-write', tier: 'deny' },
  { token: 'sshuttle ', kind: 'net-write', tier: 'deny' },
  { token: 'chisel ', kind: 'net-write', tier: 'deny' },
  { token: 'frp ', kind: 'net-write', tier: 'deny' },
  { token: 'ngrok ', kind: 'net-write', tier: 'deny' },
  { token: 'social-engineer ', tier: 'deny' },
  { token: 'evilginx ', tier: 'deny' },

];

/** 审批档的**令牌**（不含元字符/参数类结构令牌，那些仍在 `autoModeCommandTokens.ts`） */
export function approvalTokensFromSpecs(): string[] {
  return COMMAND_SPECS.filter(
    (spec): spec is CommandSpec & { token: string } =>
      spec.tier === 'ask' && typeof spec.token === 'string'
  ).map((spec) => spec.token);
}

/** 硬拦档的**命令名令牌**（结构 / 参数 / 注入类令牌仍在 `autoModeCommandTokens.ts`） */
export function denyTokensFromSpecs(): string[] {
  return COMMAND_SPECS.filter(
    (spec): spec is CommandSpec & { token: string } =>
      spec.tier === 'deny' && typeof spec.token === 'string'
  ).map((spec) => spec.token);
}

/**
 * 命令名 → 只读子命令集合（P1c）。
 *
 * 找不到（或该命令没有只读子命令）⇒ 空集合（调用方按"不放行"处理）。
 */
export function readonlySubcommandsFor(command: string): ReadonlySet<string> {
  const name = command.trim().toLowerCase();
  for (const spec of COMMAND_SPECS) {
    if (!spec.readonlySubcommands) continue;
    const names = [spec.token, ...(spec.equivalents ?? [])]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim().toLowerCase());
    if (names.includes(name)) return spec.readonlySubcommands;
  }
  return new Set<string>();
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
