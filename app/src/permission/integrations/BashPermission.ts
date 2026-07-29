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

    // P2-1: 智能审批 — 使用 SmartApprovalObserver 自动批准低风险命令
    const {
      SmartApprovalObserver,
    } = require('@modules/tools/SmartApprovalObserver');
    const observer = new SmartApprovalObserver();
    const approvalResult = observer.evaluate(command);

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
