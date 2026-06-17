/**
 * Sandbox模块测试
 * 测试沙箱约束和安全检查功能
 */

import { SandboxManager } from '../SandboxManager';
import { checkDangerousCommand } from '../utils/DangerousCommandChecker';
import { validatePathSafety, checkPathAccess } from '../utils/PathRestrictions';

describe('Sandbox Module Tests', () => {
  let sandboxManager: SandboxManager;

  beforeEach(() => {
    sandboxManager = SandboxManager.getInstance();
    sandboxManager.reset();
  });

  describe('危险命令检测', () => {
    it('应该检测到 rm -rf', () => {
      const result = checkDangerousCommand('rm -rf /');
      expect(result.isDangerous).toBe(true);
    });

    it('应该检测到 Fork 炸弹', () => {
      const result = checkDangerousCommand(':(){:|:&};:');
      expect(result.isDangerous).toBe(true);
    });

    it('应该检测到 shutdown', () => {
      const result = checkDangerousCommand('shutdown -h now');
      expect(result.isDangerous).toBe(true);
    });

    it('应该允许安全命令', () => {
      const result = checkDangerousCommand('ls -la');
      expect(result.isDangerous).toBe(false);
    });
  });

  describe('路径安全验证', () => {
    it('应该拒绝根目录访问', () => {
      const result = validatePathSafety('/', '/workspace');
      expect(result.safe).toBe(false);
    });

    it('应该拒绝路径遍历', () => {
      const result = validatePathSafety('../../etc/passwd', '/workspace');
      expect(result.safe).toBe(false);
    });

    it('应该拒绝敏感目录访问', () => {
      const result = validatePathSafety('/etc/passwd', '/workspace');
      expect(result.safe).toBe(false);
    });

    it('应该允许工作目录内的路径', () => {
      const result = validatePathSafety(
        '/workspace/project/src/main.ts',
        '/workspace/project'
      );
      expect(result.safe).toBe(true);
    });
  });

  describe('路径访问控制', () => {
    it('应该检查路径访问权限', () => {
      const result = checkPathAccess(
        '/workspace/test',
        ['/workspace'],
        ['/etc']
      );
      expect(result.allowed).toBe(true);
    });

    it('应该拒绝访问拒绝列表中的路径', () => {
      const result = checkPathAccess('/etc/passwd', ['/workspace'], ['/etc']);
      expect(result.allowed).toBe(false);
    });
  });

  describe('沙箱管理器', () => {
    it('应该检查命令安全性', () => {
      const result = sandboxManager.checkCommand('rm -rf /');
      expect(result.allowed).toBe(false);
    });

    it('应该检查路径访问', () => {
      sandboxManager.updateSettings({
        filesystem: {
          denyRead: ['/etc/passwd'],
          allowRead: [],
          denyWrite: [],
          allowWrite: [],
          allowManagedReadPathsOnly: false,
        },
      });
      const result = sandboxManager.checkPath('/etc/passwd', 'read');
      expect(result.allowed).toBe(false);
    });

    it('应该管理违规记录', () => {
      sandboxManager.recordViolation({
        type: 'command_denied',
        message: '危险命令被拒绝',
        details: { command: 'rm -rf /' },
      });

      const violations = sandboxManager.getViolations();
      expect(violations.length).toBe(1);
    });

    it('应该支持超时执行', async () => {
      const result = await sandboxManager.executeWithConstraints(async () => {
        return 'success';
      });

      expect(result.success).toBe(true);
      expect(result.data).toBe('success');
    });
  });
});
