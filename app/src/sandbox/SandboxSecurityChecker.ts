/**
 * 沙箱安全检查器
 *
 * O27 修复（2026-09-12）：删除**不可达**的 `check()` 全链路检查 —— 全仓无调用者（唯一调用方是它自己），
 * 连带删除 8 个只被它调用的方法（路径遍历 / 敏感路径 / 命令注入 / 零宽字符 / 空字节 /
 * Zsh equals / 环境变量污染 / 工作目录）与 5 个模式集合。
 *
 * 它们不只是"没人用"，**本身也不宜直接接线**：
 *   - `sensitivePaths` 含 `'C:\\'` / `'D:\\'` → 任何含盘符路径的正常命令都会被判违规
 *   - `commandInjectionPatterns` 含 `' | '` / `' && '` / `' ; '` → 正常管道与串联命令会被判注入
 *   - `pathTraversalPatterns` 含 `'../'` → 正常的上一级目录访问会被判遍历攻击
 * 保留**在用**的 `checkDangerousCommands`（BashTool / PowerShellTool 执行前调用，token 边界匹配）；
 * 路径语义防护（凭据 / 私钥拒绝列表 + shell 命令串提取）由 PathGuard 统一负责。
 */

/**
 * 沙箱安全检查器安全检查结果
 */
export interface SecurityCheckResult {
  /** 是否通过检查 */
  allowed: boolean;
  /** 检查原因 */
  reason: string;
  /** 匹配的危险模式（如果有） */
  matchedPattern?: string;
  /** 建议的操作 */
  suggestion?: string;
}

/**
 * 沙箱安全检查器
 */
export class SandboxSecurityChecker {
  /**
   * 危险命令模式列表
   */
  private readonly dangerousCommands = new Set([
    // P1 统一来源：DELETION_RULES（security/patterns/dangerousCommands.ts）PowerShell 删除别名
    'remove-item',
    'ri',
    'rm',
    'del',
    'erase',
    'rd',
    'rrmdir',
    // 文件系统破坏命令
    'rm -rf',
    'rm -fr',
    'rm -rf /',
    'rm -rf *',
    'rm -rf /*',
    'del /s /q',
    'erase /f /s',
    'rd /s /q',
    'format',
    'mkfs',
    'mkfs.ext',
    'mkfs.xfs',
    'dd if=',
    'dd of=/dev/',
    'dd of=/dev/sd',
    'dd of=/dev/hd',
    'chmod 777',
    'chmod -R 777',
    'chmod a+rwx',
    'chown -R',
    'chgrp -R',
    'chown root',
    'chgrp root',
    'truncate -s 0',
    'fallocate -l 0',
    // Fork炸弹
    ':(){ :|:& };:',
    'forkbomb',
    '(){ :|:& };:',
    // 权限提升
    'sudo',
    'su root',
    'pkexec',
    'doas',
    'su -',
    'sudo -i',
    // 远程代码执行
    'curl | bash',
    'wget | bash',
    'curl | sh',
    'wget | sh',
    'curl | sudo',
    'wget | sudo',
    'curl | su',
    'wget | su',
    'base64 -d |',
    'echo ... | base64',
    'echo | base64 -d',
    'python -c',
    'python3 -c',
    'perl -e',
    'ruby -e',
    'node -e',
    'bash -c',
    'sh -c',
    'zsh -c',
    'ksh -c',
    'curl -sL',
    'curl -s',
    'wget -q',
    'wget -qO-',
    // 命令注入
    'eval ',
    'exec ',
    'source ',
    '. ',
    // Zsh equals expansion
    '=rm',
    '=sh',
    '=bash',
    '=cp',
    '=mv',
    '=cat',
    '=echo',
    '=kill',
    '=sudo',
    '=su',
    '=curl',
    '=wget',
    '=python',
    // 环境变量污染
    'PATH=',
    'LD_PRELOAD=',
    'LD_LIBRARY_PATH=',
    'PYTHONPATH=',
    'PERL5LIB=',
    'RUBYLIB=',
    'NODE_PATH=',
    'IFS=',
    'HOME=',
    'USER=',
    'SHELL=',
    'LOGNAME=',
  ]);

  /**
   * 检查危险命令
   * @param command 命令字符串
   * @returns 检查结果
   */
  checkDangerousCommands(command: string): SecurityCheckResult {
    const lowerCommand = command.toLowerCase();
    // 方案八 8b：危险词改为「token 边界匹配」，杜绝子串误伤。
    // 旧实现用 includes()——如危险词 "ri"（Remove-Item 缩写）会误伤
    // "transcripts"、"dir" 等任何含 "ri" 的正常命令。
    const tokens = lowerCommand.split(/[\s;|&<>]+/).filter(Boolean);

    for (const dangerous of this.dangerousCommands) {
      const d = dangerous.toLowerCase().trim();
      if (!d) continue;
      const matched = d.includes(' ')
        ? lowerCommand.includes(d) // 带参数组合（如 "rm -rf"）整体匹配，组合本身足够具体
        : tokens.includes(d); // 单 token 危险词：按独立 token 精确匹配
      if (matched) {
        return {
          allowed: false,
          reason: `命令包含危险操作: "${dangerous}"`,
          matchedPattern: dangerous,
          suggestion: '请检查命令是否必要，避免执行破坏性操作',
        };
      }
    }

    return {
      allowed: true,
      reason: '未检测到危险命令',
    };
  }
}
