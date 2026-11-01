/**
 * Bash权限检查器
 * 负责检查Bash工具的权限，包括危险命令检测、路径安全检查等
 */
import {
  PermissionDecision,
  PermissionDecisionType,
  createAllowDecision,
  createDenyDecision,
  createAskDecision,
} from '../types/PermissionDecision';
import { PermissionContext } from '../types/PermissionContext';

/** 审批建议（`tools/SmartApprovalObserver.evaluate` 的返回形态子集） */
export interface CommandApprovalAdvice {
  decision: 'auto_allow' | 'auto_deny' | 'needs_review';
  reason: string;
}

/** 审批评估器：由 app / entry 层注入，infra 不感知具体实现 */
export type CommandApprovalEvaluator = (
  command: string
) => CommandApprovalAdvice;

let approvalEvaluator: CommandApprovalEvaluator | null = null;

/**
 * 装配审批评估器（app / entry 层调用），返回 disposer（注册 → disposer，LIFO）。
 *
 * 为什么是注入而非直接引用：`SmartApprovalObserver` 属 app 层（`@modules/tools`），
 * permission 属 infra —— 直接引用会构成 infra → app 倒挂（原为 `require()` 动态通道，
 * `lint:infra` R3 曾逐条登记）。装配示例：
 * `setCommandApprovalEvaluator((cmd) => new SmartApprovalObserver().evaluate(cmd))`。
 *
 * 当前无生产消费者（`BashPermission` 未被接线）；未注入时 `checkPermission` 一律**询问**，
 * 不会静默放行 —— 将来接线方必须在 app / entry 层完成装配。
 */
export function setCommandApprovalEvaluator(
  evaluator: CommandApprovalEvaluator | null
): () => void {
  const previous = approvalEvaluator;
  approvalEvaluator = evaluator;
  return () => {
    approvalEvaluator = previous;
  };
}

/**
 * Bash权限检查器类
 */
export class BashPermission {
  /**
   * 检查Bash命令权限
   * @param input 工具输入
   * @param context 权限上下文
   * @returns 权限决策
   */
  static checkPermission(
    input: Record<string, unknown>,
    context: PermissionContext
  ): PermissionDecision {
    const command = input.command as string;
    if (!command) {
      return createDenyDecision('No command provided');
    }

    // 检查危险命令
    const dangerousCommands = [
      'rm -rf',
      'format',
      'mkfs',
      'dd',
      'shutdown',
      'reboot',
      'poweroff',
      'halt',
      'init 0',
      'init 6',
      'sysctl',
      'modprobe',
      'rmmod',
      'insmod',
      'chmod 777',
      'chmod +x',
      'sudo',
      'su',
      'passwd',
      'useradd',
      'userdel',
      'groupadd',
      'groupdel',
      'kill -9',
      'pkill',
      'killall',
      'iptables',
      'firewall-cmd',
      'wget',
      'curl',
      'scp',
      'rsync',
      'ssh',
      'ftp',
      'telnet',
      'netcat',
      'nc',
      'nmap',
      'ping',
      'traceroute',
      'arp',
      'arping',
      'tcpdump',
      'tshark',
      'wireshark',
      'strace',
      'ltrace',
      'gdb',
      'valgrind',
      'perf',
      'mount',
      'umount',
      'fdisk',
      'parted',
      'gparted',
      'cfdisk',
      'sfdisk',
      'mkfs.ext4',
      'mkfs.xfs',
      'mkfs.btrfs',
      'mkfs.vfat',
      'mkfs.ntfs',
      'mkswap',
      'swapon',
      'swapoff',
      'fsck',
      'e2fsck',
      'xfs_repair',
      'btrfs check',
      'resize2fs',
      'xfs_growfs',
      'btrfs filesystem resize',
    ];

    // 检查是否包含危险命令
    for (const dangerousCommand of dangerousCommands) {
      if (command.includes(dangerousCommand)) {
        return createAskDecision(
          `Dangerous Bash command detected: ${dangerousCommand}`
        );
      }
    }

    // P2-1: 智能审批 — 评估器由 app 层注入（infra 不反向依赖 `@modules/tools`）。
    // 未注入 ⇒ 询问（fail-safe：宁可多问，不静默放行）。
    if (!approvalEvaluator) {
      return createAskDecision(
        'Unknown command, requiring user approval（审批评估器未注入）'
      );
    }
    const approvalResult = approvalEvaluator(command);

    if (approvalResult.decision === 'auto_deny') {
      return createDenyDecision(approvalResult.reason);
    }
    if (approvalResult.decision === 'auto_allow') {
      return createAllowDecision(approvalResult.reason);
    }

    // 需要人工审核或未匹配 → 默认询问
    return createAskDecision(
      approvalResult.reason || 'Unknown command, requiring user approval'
    );
  }
}
