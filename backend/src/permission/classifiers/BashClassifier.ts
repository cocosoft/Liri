/**
 * Bash命令分类器
 * 专门用于分类Bash命令的安全性
 * 参考CC源码 cc_code/backend/utils/permissions/bashClassifier.ts 实现
 */

import { logger } from '@modules/utils/log';

/**
 * Bash分类结果
 */
export interface BashClassifierResult {
  /** 是否允许执行 */
  allowed: boolean;
  /** 分类决策 */
  decision: 'allow' | 'soft_deny' | 'deny';
  /** 决策理由 */
  reason?: string;
  /** 命令 */
  command: string;
  /** 危险级别 */
  dangerLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  /** 是否为只读命令 */
  isReadonly: boolean;
}

/**
 * 危险命令模式
 */
interface DangerPattern {
  pattern: RegExp;
  dangerLevel: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
}

/**
 * Bash分类器配置
 */
export interface BashClassifierConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 允许执行的命令白名单 */
  allowedCommands: string[];
  /** 危险命令黑名单 */
  dangerousCommands: string[];
  /** 只读命令列表 */
  readonlyCommands: string[];
  /** 允许执行的目录限制 */
  allowedDirs: string[];
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: BashClassifierConfig = {
  enabled: true,
  allowedCommands: [],
  dangerousCommands: [
    'rm -rf /',
    'rm -rf /*',
    'dd if=/dev/zero of=/dev/sda',
    'mkfs.ext4',
    ':(){:|:&};:',
    'chmod -R 777 /',
    '> /etc/passwd',
    'wget | sh',
    'curl | sh',
  ],
  readonlyCommands: [
    'ls', 'dir', 'pwd', 'echo', 'cat', 'head', 'tail', 'less', 'more',
    'grep', 'find', 'which', 'whereis', 'file', 'stat', 'wc', 'sort',
    'uniq', 'cut', 'tr', 'awk', 'sed', 'tar -t', 'zipinfo', 'unzip -l',
    'git status', 'git log', 'git diff', 'git show', 'git branch',
    'svn status', 'svn info', 'hg log', 'cvs diff',
    'docker ps', 'docker images', 'docker logs', 'docker inspect',
    'kubectl get', 'kubectl describe', 'helm list',
    'ps', 'top', 'htop', 'free', 'df', 'du', 'iostat', 'netstat',
    'curl -I', 'curl -head', 'wget --spider',
  ],
  allowedDirs: [],
};

/**
 * 危险命令模式列表
 */
const DANGER_PATTERNS: DangerPattern[] = [
  { pattern: /^rm\s+-rf\s+\//, dangerLevel: 'critical', reason: '试图删除根目录' },
  { pattern: /^rm\s+-rf\s+\*\s*$/, dangerLevel: 'critical', reason: '递归删除当前目录' },
  { pattern: /^dd\s+if=/, dangerLevel: 'critical', reason: '直接写入磁盘' },
  { pattern: /^mkfs\./, dangerLevel: 'critical', reason: '格式化文件系统' },
  { pattern: /^:\(\)\{:\|:&\};:/, dangerLevel: 'critical', reason: 'Fork炸弹' },
  { pattern: /^chmod\s+-R\s+777\s+\//, dangerLevel: 'high', reason: '开放根目录权限' },
  { pattern: /^>\s*\/etc\/passwd$/, dangerLevel: 'critical', reason: '修改系统账户文件' },
  { pattern: /\|?\s*sh\s*$/, dangerLevel: 'high', reason: '执行shell脚本' },
  { pattern: /\$\([^)]*\)\s*\|?\s*sh/, dangerLevel: 'high', reason: '执行命令输出作为shell' },
  { pattern: /curl\s+.*\|.*sh/, dangerLevel: 'high', reason: '下载并执行脚本' },
  { pattern: /wget\s+.*\|.*sh/, dangerLevel: 'high', reason: '下载并执行脚本' },
  { pattern: /sudo\s+rm\s+/, dangerLevel: 'medium', reason: '使用sudo删除' },
  { pattern: /^kill\s+-9?\s*\d+$/, dangerLevel: 'low', reason: '终止进程' },
  { pattern: /^killall/, dangerLevel: 'medium', reason: '终止所有匹配进程' },
  { pattern: /^pkill/, dangerLevel: 'medium', reason: '模式匹配终止进程' },
  { pattern: /^shutdown/, dangerLevel: 'medium', reason: '关闭系统' },
  { pattern: /^reboot/, dangerLevel: 'medium', reason: '重启系统' },
  { pattern: /^init\s+0/, dangerLevel: 'medium', reason: '关闭系统' },
  { pattern: /^init\s+6/, dangerLevel: 'medium', reason: '重启系统' },
  { pattern: /^systemctl\s+stop/, dangerLevel: 'low', reason: '停止系统服务' },
  { pattern: /^systemctl\s+disable/, dangerLevel: 'low', reason: '禁用系统服务' },
  { pattern: /^service\s+\w+\s+stop/, dangerLevel: 'low', reason: '停止服务' },
  { pattern: /^mv\s+.*\s+\/dev\/null/, dangerLevel: 'high', reason: '删除文件到黑洞' },
  { pattern: /^cat\s+\/dev\/null\s+>/, dangerLevel: 'medium', reason: '清空文件' },
  { pattern: /^>\/\s*etc\//, dangerLevel: 'high', reason: '写入系统目录' },
  { pattern: /^chmod\s+777\s+/, dangerLevel: 'medium', reason: '开放权限' },
  { pattern: /^chmod\s+-R\s+777/, dangerLevel: 'high', reason: '递归开放权限' },
  { pattern: /^chown\s+-R/, dangerLevel: 'medium', reason: '更改所有者' },
  { pattern: /^useradd/, dangerLevel: 'medium', reason: '添加系统用户' },
  { pattern: /^userdel/, dangerLevel: 'medium', reason: '删除系统用户' },
  { pattern: /^passwd/, dangerLevel: 'medium', reason: '修改密码' },
  { pattern: /^iptables/, dangerLevel: 'medium', reason: '修改防火墙规则' },
  { pattern: /^ufw\s+disable/, dangerLevel: 'medium', reason: '禁用防火墙' },
  { pattern: /^docker\s+run\s+--privileged/, dangerLevel: 'high', reason: '运行特权容器' },
  { pattern: /^docker\s+exec\s+--privileged/, dangerLevel: 'high', reason: '特权容器执行' },
  { pattern: /^kubectl\s+exec\s+-it\s+.*\s+\/bin\/sh/, dangerLevel: 'medium', reason: '进入容器shell' },
  { pattern: /^ssh\s+.*@.*\s+"rm/, dangerLevel: 'high', reason: '远程执行删除' },
];

/**
 * 只读命令特征
 */
const READONLY_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^ls\s+/, reason: '列出目录内容' },
  { pattern: /^dir\s+/, reason: '列出目录内容' },
  { pattern: /^pwd$/, reason: '显示当前目录' },
  { pattern: /^echo\s+/, reason: '输出文本' },
  { pattern: /^cat\s+.*/, reason: '查看文件内容' },
  { pattern: /^head\s+/, reason: '查看文件开头' },
  { pattern: /^tail\s+/, reason: '查看文件结尾' },
  { pattern: /^less\s+/, reason: '分页查看文件' },
  { pattern: /^more\s+/, reason: '分页查看文件' },
  { pattern: /^grep\s+/, reason: '搜索文件内容' },
  { pattern: /^find\s+/, reason: '搜索文件' },
  { pattern: /^which\s+/, reason: '查找命令位置' },
  { pattern: /^whereis\s+/, reason: '查找命令位置' },
  { pattern: /^file\s+/, reason: '查看文件类型' },
  { pattern: /^stat\s+/, reason: '查看文件状态' },
  { pattern: /^wc\s+/, reason: '统计文件' },
  { pattern: /^sort\s+/, reason: '排序文本' },
  { pattern: /^uniq\s+/, reason: '去重文本' },
  { pattern: /^cut\s+/, reason: '剪切文本' },
  { pattern: /^tr\s+/, reason: '字符转换' },
  { pattern: /^awk\s+/, reason: '文本处理' },
  { pattern: /^sed\s+/, reason: '文本处理' },
  { pattern: /^git\s+status/, reason: '查看Git状态' },
  { pattern: /^git\s+log/, reason: '查看Git历史' },
  { pattern: /^git\s+diff/, reason: '查看Git差异' },
  { pattern: /^git\s+show/, reason: '查看Git对象' },
  { pattern: /^git\s+branch/, reason: '查看Git分支' },
  { pattern: /^docker\s+ps/, reason: '查看容器' },
  { pattern: /^docker\s+images/, reason: '查看镜像' },
  { pattern: /^docker\s+logs/, reason: '查看日志' },
  { pattern: /^kubectl\s+get/, reason: '查看K8s资源' },
  { pattern: /^ps\s+/, reason: '查看进程' },
  { pattern: /^top\s*/, reason: '查看进程' },
  { pattern: /^free\s*/, reason: '查看内存' },
  { pattern: /^df\s+/, reason: '查看磁盘' },
  { pattern: /^du\s+/, reason: '查看目录大小' },
  { pattern: /^curl\s+-I/, reason: '查看HTTP头' },
  { pattern: /^curl\s+--head/, reason: '查看HTTP头' },
  { pattern: /^wget\s+--spider/, reason: '检查资源' },
];

/**
 * Bash分类器
 * 专门用于分类Bash命令的安全性
 */
export class BashClassifier {
  private config: BashClassifierConfig;

  constructor(config: Partial<BashClassifierConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 分类Bash命令
   */
  classify(command: string): BashClassifierResult {
    const trimmedCommand = command.trim();

    if (!this.config.enabled) {
      return this.createResult(trimmedCommand, 'allow', 'none', 'classifier_disabled');
    }

    // 检查危险命令黑名单
    const dangerousCheck = this.checkDangerousList(trimmedCommand);
    if (dangerousCheck) {
      return dangerousCheck;
    }

    // 检查危险模式
    const patternCheck = this.checkDangerPatterns(trimmedCommand);
    if (patternCheck) {
      return patternCheck;
    }

    // 检查只读命令
    const readonlyCheck = this.checkReadonly(trimmedCommand);
    if (readonlyCheck.isReadonly) {
      return readonlyCheck;
    }

    // 检查允许目录
    if (this.config.allowedDirs.length > 0) {
      const dirCheck = this.checkAllowedDirs(trimmedCommand);
      if (!dirCheck.allowed) {
        return dirCheck;
      }
    }

    // 默认允许但需要确认
    return this.createResult(trimmedCommand, 'soft_deny', 'low', 'unclassified_command');
  }

  /**
   * 检查危险命令黑名单
   */
  private checkDangerousList(command: string): BashClassifierResult | null {
    for (const dangerous of this.config.dangerousCommands) {
      if (command.includes(dangerous)) {
        return this.createResult(command, 'deny', 'critical', `dangerous_command: ${dangerous}`);
      }
    }
    return null;
  }

  /**
   * 检查危险模式
   */
  private checkDangerPatterns(command: string): BashClassifierResult | null {
    for (const danger of DANGER_PATTERNS) {
      if (danger.pattern.test(command)) {
        const decision = danger.dangerLevel === 'critical' || danger.dangerLevel === 'high' ? 'deny' : 'soft_deny';
        return this.createResult(command, decision, danger.dangerLevel, danger.reason);
      }
    }
    return null;
  }

  /**
   * 检查是否只读
   */
  private checkReadonly(command: string): BashClassifierResult {
    for (const pattern of READONLY_PATTERNS) {
      if (pattern.pattern.test(command)) {
        return this.createResult(command, 'allow', 'none', pattern.reason);
      }
    }

    // 检查配置的只读命令
    for (const readonlyCmd of this.config.readonlyCommands) {
      if (command.startsWith(readonlyCmd)) {
        return this.createResult(command, 'allow', 'none', 'readonly_command');
      }
    }

    return this.createResult(command, 'allow', 'none', 'unknown');
  }

  /**
   * 检查允许目录
   */
  private checkAllowedDirs(command: string): BashClassifierResult {
    // 简单的目录检查
    const pathMatch = command.match(/cd\s+(\S+)/);
    if (pathMatch) {
      const targetDir = pathMatch[1];
      const isAllowed = this.config.allowedDirs.some(allowed =>
        targetDir.startsWith(allowed) || targetDir === allowed
      );

      if (!isAllowed) {
        return this.createResult(command, 'deny', 'medium', `directory_not_allowed: ${targetDir}`);
      }
    }

    return this.createResult(command, 'allow', 'none', 'directory_allowed');
  }

  /**
   * 创建结果
   */
  private createResult(
    command: string,
    decision: 'allow' | 'soft_deny' | 'deny',
    dangerLevel: 'none' | 'low' | 'medium' | 'high' | 'critical',
    reason: string
  ): BashClassifierResult {
    return {
      allowed: decision === 'allow',
      decision,
      reason,
      command,
      dangerLevel,
      isReadonly: dangerLevel === 'none' && decision === 'allow',
    };
  }

  /**
   * 添加危险命令
   */
  addDangerousCommand(command: string): void {
    if (!this.config.dangerousCommands.includes(command)) {
      this.config.dangerousCommands.push(command);
    }
  }

  /**
   * 移除危险命令
   */
  removeDangerousCommand(command: string): void {
    const index = this.config.dangerousCommands.indexOf(command);
    if (index > -1) {
      this.config.dangerousCommands.splice(index, 1);
    }
  }

  /**
   * 添加只读命令
   */
  addReadonlyCommand(command: string): void {
    if (!this.config.readonlyCommands.includes(command)) {
      this.config.readonlyCommands.push(command);
    }
  }

  /**
   * 添加允许目录
   */
  addAllowedDir(dir: string): void {
    if (!this.config.allowedDirs.includes(dir)) {
      this.config.allowedDirs.push(dir);
    }
  }

  /**
   * 获取配置
   */
  getConfig(): BashClassifierConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<BashClassifierConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * 导出单例
 */
export const bashClassifier = new BashClassifier();
