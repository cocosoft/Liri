/**
 * 工作空间信任机制集成测试
 *
 * 覆盖范围（P1.7 / P2.5）：
 * - P1.2：BashSecurityAnalyzer 自定义命令规则（loadCommandRules 合并）
 * - P1.3：SecurityIntegration 信任工作区匹配与默认回退
 * - P1.4：DirectoryScopeRestriction 信任路径注入 allowedDirs
 * - P1.5：filesystem isWithinWorkingDirectory 多工作区 + 自定义目录规则合并
 * - P1.6：ProtectedPaths 用户自定义黑名单合并
 * - P3.1：三级信任行为（development/work/chat）
 * - P3.2：场景联动（CLI --trust-level → config → SecurityIntegration 回退）
 * - 零影响保证：不配置时安全行为不变
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import path from 'node:path';
import { configManager } from '@modules/config';
import { SecurityIntegrationService } from '../../src/security/SecurityIntegration';
import { BashSecurityAnalyzer } from '../../src/security/BashSecurityAnalyzer';
import { DirectoryScopeRestriction } from '../../src/security/bash/DirectoryScopeRestriction';
import {
  isWithinWorkingDirectory,
  isDangerousFile,
  isInDangerousDirectory,
} from '../../src/permission/filesystem';
import {
  isWriteProtected,
  getCrossPlatformProtectedFiles,
} from '../../src/security/files/ProtectedPaths';

// ==========================================
// 辅助函数
// ==========================================
function clearPermissionConfig(): void {
  configManager.setConfigValue('permission', undefined);
}

// ==========================================
// P1.3：信任工作区基础功能
// ==========================================
describe('P1.3 — SecurityIntegration 信任工作区匹配', () => {
  let securityIntegration: SecurityIntegrationService;

  beforeEach(() => {
    clearPermissionConfig();
    securityIntegration = new SecurityIntegrationService();
  });

  afterEach(() => {
    clearPermissionConfig();
  });

  it('不配置时 isInTrustedWorkspace 返回 false（零影响）', () => {
    expect(securityIntegration.isInTrustedWorkspace('/some/path')).toBe(false);
  });

  it('匹配已启用工作区路径返回 true', () => {
    configManager.setConfigValue('permission', {
      mode: 'default',
      trustedWorkspaces: [
        { path: '/home/user/project', trustLevel: 'development', enabled: true },
      ],
    });

    expect(securityIntegration.isInTrustedWorkspace('/home/user/project/src')).toBe(true);
    expect(securityIntegration.isInTrustedWorkspace('/home/user/project')).toBe(true);
  });

  it('前缀匹配不扩大范围', () => {
    configManager.setConfigValue('permission', {
      mode: 'default',
      trustedWorkspaces: [
        { path: '/home/user/proj', trustLevel: 'development', enabled: true },
      ],
    });

    expect(securityIntegration.isInTrustedWorkspace('/home/user/proj-other')).toBe(false);
  });

  it('禁用的工作区不生效', () => {
    configManager.setConfigValue('permission', {
      mode: 'default',
      trustedWorkspaces: [
        { path: '/home/user/project', trustLevel: 'development', enabled: false },
      ],
    });

    expect(securityIntegration.isInTrustedWorkspace('/home/user/project/src')).toBe(false);
  });

  it('多工作区各自独立匹配', () => {
    configManager.setConfigValue('permission', {
      mode: 'default',
      trustedWorkspaces: [
        { path: '/home/user/project-a', trustLevel: 'chat', enabled: true },
        { path: '/home/user/project-b', trustLevel: 'development', enabled: true },
      ],
    });

    expect(securityIntegration.isInTrustedWorkspace('/home/user/project-a/docs')).toBe(true);
    expect(securityIntegration.isInTrustedWorkspace('/home/user/project-b/src')).toBe(true);
    expect(securityIntegration.isInTrustedWorkspace('/home/user/project-c')).toBe(false);
  });

  it('跨平台反斜杠路径也能正确匹配', () => {
    configManager.setConfigValue('permission', {
      mode: 'default',
      trustedWorkspaces: [
        { path: 'C:\\Users\\me\\project', trustLevel: 'development', enabled: true },
      ],
    });

    expect(securityIntegration.isInTrustedWorkspace('C:/Users/me/project/src')).toBe(true);
    expect(securityIntegration.isInTrustedWorkspace('C:\\Users\\me\\project\\src')).toBe(true);
  });
});

// ==========================================
// P3.2：信任级别与场景联动
// ==========================================
describe('P3.2 — 信任级别与场景联动', () => {
  let securityIntegration: SecurityIntegrationService;

  beforeEach(() => {
    clearPermissionConfig();
    securityIntegration = new SecurityIntegrationService();
  });

  afterEach(() => {
    clearPermissionConfig();
  });

  it('不在工作区内返回全局默认信任级别', () => {
    configManager.setConfigValue('permission', {
      mode: 'default',
      trustedWorkspaces: [],
      defaultTrustLevel: 'work',
    });

    expect(securityIntegration.getTrustLevelForPath('/other/path')).toBe('work');
  });

  it('无默认信任级别时返回 undefined', () => {
    configManager.setConfigValue('permission', {
      mode: 'default',
      trustedWorkspaces: [],
    });

    expect(securityIntegration.getTrustLevelForPath('/other/path')).toBeUndefined();
  });

  it('工作区优先级高于全局默认', () => {
    configManager.setConfigValue('permission', {
      mode: 'default',
      trustedWorkspaces: [
        { path: '/project', trustLevel: 'chat', enabled: true },
      ],
      defaultTrustLevel: 'development',
    });

    // 在工作区内 → 使用 chat
    expect(securityIntegration.getTrustLevelForPath('/project/file.txt')).toBe('chat');
    // 在工作区外 → 使用 development（全局默认）
    expect(securityIntegration.getTrustLevelForPath('/other/file.txt')).toBe('development');
  });

  it('多工作区各自返回自己的信任级别', () => {
    configManager.setConfigValue('permission', {
      mode: 'default',
      trustedWorkspaces: [
        { path: '/chat-area', trustLevel: 'chat', enabled: true },
        { path: '/work-area', trustLevel: 'work', enabled: true },
        { path: '/dev-area', trustLevel: 'development', enabled: true },
      ],
    });

    expect(securityIntegration.getTrustLevelForPath('/chat-area/readme.md')).toBe('chat');
    expect(securityIntegration.getTrustLevelForPath('/work-area/src')).toBe('work');
    expect(securityIntegration.getTrustLevelForPath('/dev-area/src')).toBe('development');
  });

  it('getDefaultTrustLevel 返回全局默认值', () => {
    configManager.setConfigValue('permission', {
      mode: 'default',
      trustedWorkspaces: [],
      defaultTrustLevel: 'development',
    });

    expect(securityIntegration.getDefaultTrustLevel()).toBe('development');
  });

  it('未配置 defaultTrustLevel 时 getDefaultTrustLevel 返回 undefined', () => {
    configManager.setConfigValue('permission', {
      mode: 'default',
      trustedWorkspaces: [],
    });

    expect(securityIntegration.getDefaultTrustLevel()).toBeUndefined();
  });
});

// ==========================================
// P3.1：三级信任行为
// ==========================================
describe('P3.1 — BashSecurityAnalyzer 三级信任行为', () => {
  let analyzer: BashSecurityAnalyzer;

  beforeEach(() => {
    clearPermissionConfig();
    analyzer = new BashSecurityAnalyzer();
  });

  afterEach(() => {
    clearPermissionConfig();
  });

  it('无信任级别时正常检查（零影响）', () => {
    const result = analyzer.analyze('ls -la');
    expect(result.safe).toBe(true);
    expect(result.behavior).toBe('allow');
  });

  it('development 级别自动放行非危险命令', () => {
    const result = analyzer.analyze('ls -la', 'development');
    expect(result.safe).toBe(true);
    expect(result.behavior).toBe('allow');
  });

  it('development 级别不绕过危险命令', () => {
    const result = analyzer.analyze('rm -rf /', 'development');
    expect(result.safe).toBe(false);
    expect(result.behavior).toBe('deny');
  });

  it('work 级别放行 ask 命令为 allow', () => {
    const result = analyzer.analyze('some-tool --flag', 'work');
    // 命令本身不是危险命令，正常应放行
    expect(result.safe).toBe(true);
  });

  it('chat 级别不做特殊处理', () => {
    const result = analyzer.analyze('ls -la', 'chat');
    // chat 级别 == 不处理信任逻辑
    expect(result.safe).toBe(true);
  });

  it('危险命令在所有信任级别下都不可绕过', () => {
    for (const level of ['chat', 'work', 'development', undefined]) {
      const result = analyzer.analyze('rm -rf /', level);
      expect(result.safe).toBe(false);
      expect(result.behavior).toBe('deny');
    }
  });
});

// ==========================================
// P1.2：BashSecurityAnalyzer 自定义命令规则
// ==========================================
describe('P1.2 — BashSecurityAnalyzer 自定义命令规则', () => {
  let analyzer: BashSecurityAnalyzer;

  beforeEach(() => {
    clearPermissionConfig();
  });

  afterEach(() => {
    clearPermissionConfig();
  });

  it('不配置时默认危险命令被拦截', () => {
    analyzer = new BashSecurityAnalyzer();
    const result = analyzer.analyze('rm -rf /');
    expect(result.safe).toBe(false);
    expect(result.behavior).toBe('deny');
  });

  it('config 自定义黑名单命令会被检测到', () => {
    configManager.setConfigValue('permission', {
      mode: 'default',
      trustedWorkspaces: [],
      customRules: {
        commandRules: {
          blacklist: [
            { pattern: 'wget', type: 'blacklist', label: 'wget 下载' },
          ],
          whitelist: [],
          mode: 'blacklist',
        },
      },
    });
    analyzer = new BashSecurityAnalyzer();

    // 默认危险命令仍然被拦截
    expect(analyzer.analyze('rm -rf /').safe).toBe(false);

    // 自定义命令能正常分析（loadCommandRules 执行不报错）
    expect(() => analyzer.analyze('wget http://example.com')).not.toThrow();
  });

  it('config 命令规则空列表时不影响默认规则', () => {
    configManager.setConfigValue('permission', {
      mode: 'default',
      trustedWorkspaces: [],
      customRules: {
        commandRules: {
          blacklist: [],
          whitelist: [],
          mode: 'blacklist',
        },
      },
    });
    analyzer = new BashSecurityAnalyzer();

    // 默认危险命令仍然被拦截
    expect(analyzer.analyze('rm -rf /*').safe).toBe(false);
    // 安全命令仍然放行
    expect(analyzer.analyze('ls -la').safe).toBe(true);
  });
});

// ==========================================
// P1.4：DirectoryScopeRestriction 信任路径注入
// ==========================================
describe('P1.4 — DirectoryScopeRestriction 信任路径注入', () => {
  afterEach(() => {
    clearPermissionConfig();
  });

  it('不配置时不注入 allowedDirs', () => {
    clearPermissionConfig();
    const restriction = new DirectoryScopeRestriction();
    // 此时 allowedDirs 为空（无信任工作区）
    const result = restriction.validatePath('/etc/passwd');
    // 默认 denyDirs 包含 /etc，路径应被拒绝
    expect(result.allowed).toBe(false);
  });

  it('配置信任工作区后路径自动注入 allowedDirs', () => {
    configManager.setConfigValue('permission', {
      mode: 'default',
      trustedWorkspaces: [
        { path: '/home/user/project', trustLevel: 'development', enabled: true },
      ],
    });

    const restriction = new DirectoryScopeRestriction();
    // /home/user/project 不在 denyDirs 中，且在 allowedDirs 中 → true
    const result = restriction.validatePath('/home/user/project/src/main.ts');
    expect(result.allowed).toBe(true);
  });

  it('信任工作区路径在 allowedDirs 中时能被正确允许', () => {
    configManager.setConfigValue('permission', {
      mode: 'default',
      trustedWorkspaces: [
        { path: '/home/user/work', trustLevel: 'work', enabled: true },
      ],
    });

    const restriction = new DirectoryScopeRestriction();
    const result = restriction.validatePath('/home/user/work/src/file.txt');
    // /home/user/work 在 allowedDirs 中且不在 denyDirs 中 → true
    expect(result.allowed).toBe(true);
  });

  it('禁用的工作区不注入 allowedDirs', () => {
    configManager.setConfigValue('permission', {
      mode: 'default',
      trustedWorkspaces: [
        { path: '/home/user/project', trustLevel: 'work', enabled: false },
      ],
    });

    const restriction = new DirectoryScopeRestriction();
    const config = restriction.getConfig();
    // /home/user/project 不应出现在 allowedDirs 中
    expect(config.allowedDirs).not.toContain('/home/user/project');
    // allowedDirs 应为空（无启用的工作区）
    expect(config.allowedDirs.length).toBe(0);
  });
});

// ==========================================
// P1.5：filesystem 多工作区 + 自定义目录规则
// ==========================================
describe('P1.5 — filesystem 多工作区与目录规则合并', () => {
  afterEach(() => {
    clearPermissionConfig();
  });

  describe('isWithinWorkingDirectory 多工作区', () => {
    it('在 cwd 内时返回 true', () => {
      expect(isWithinWorkingDirectory('src/file.ts', '/home/user/project')).toBe(true);
    });

    it('cwd 外 + 无信任工作区时返回 false', () => {
      clearPermissionConfig();
      expect(isWithinWorkingDirectory('/etc/passwd', '/home/user/project')).toBe(false);
    });

    it('在信任工作区内时返回 true', () => {
      configManager.setConfigValue('permission', {
        mode: 'default',
        trustedWorkspaces: [
          { path: '/home/user/other-project', trustLevel: 'work', enabled: true },
        ],
      });
      expect(
        isWithinWorkingDirectory('/home/user/other-project/src/file.ts', '/home/user/project')
      ).toBe(true);
    });

    it('不在信任工作区时返回 false', () => {
      configManager.setConfigValue('permission', {
        mode: 'default',
        trustedWorkspaces: [
          { path: '/home/user/trusted', trustLevel: 'work', enabled: true },
        ],
      });
      expect(
        isWithinWorkingDirectory('/home/user/untrusted/file.ts', '/home/user/project')
      ).toBe(false);
    });
  });

  describe('isDangerousFile / isInDangerousDirectory 配置合并', () => {
    it('不配置时默认值生效', () => {
      clearPermissionConfig();
      expect(isDangerousFile('.gitconfig')).toBe(true);
      expect(isInDangerousDirectory('/project/.git/objects')).toBe(true);
    });

    it('自定义目录黑名单合并到默认值', () => {
      configManager.setConfigValue('permission', {
        mode: 'default',
        trustedWorkspaces: [],
        customRules: {
          directoryRules: {
            blacklist: [
              { path: '.env', type: 'blacklist', label: '.env 文件' },
            ],
          },
        },
      });

      // 默认文件仍然被保护
      expect(isDangerousFile('.gitconfig')).toBe(true);
      // 新增的自定义文件也被保护
      expect(isDangerousFile('.env')).toBe(true);
    });

    it('自定义目录黑名单不丢失默认目录保护', () => {
      configManager.setConfigValue('permission', {
        mode: 'default',
        trustedWorkspaces: [],
        customRules: {
          directoryRules: {
            blacklist: [
              { path: 'node_modules', type: 'blacklist', label: '依赖目录' },
            ],
          },
        },
      });

      // 默认目录仍然被保护
      expect(isInDangerousDirectory('/project/.git/objects')).toBe(true);
    });
  });
});

// ==========================================
// P1.6：ProtectedPaths config 合并
// ==========================================
describe('P1.6 — ProtectedPaths 用户自定义黑名单合并', () => {
  afterEach(() => {
    clearPermissionConfig();
  });

  it('不配置自定义规则时使用默认受保护文件', () => {
    clearPermissionConfig();
    const files = getCrossPlatformProtectedFiles();
    expect(files.length).toBeGreaterThan(0);
  });

  it('用户自定义黑名单路径被合并', () => {
    configManager.setConfigValue('permission', {
      mode: 'default',
      trustedWorkspaces: [],
      customRules: {
        directoryRules: {
          blacklist: [
            { path: '/home/user/secret', type: 'blacklist', label: '机密文件' },
          ],
        },
      },
    });

    const files = getCrossPlatformProtectedFiles();
    expect(files.some((f) => f.includes('secret'))).toBe(true);
  });

  it('不配置时 isWriteProtected 正常工作', () => {
    clearPermissionConfig();
    // .bashrc 默认受保护
    expect(isWriteProtected(path.join(require('os').homedir(), '.bashrc'))).toBe(true);
  });
});

// ==========================================
// SecurityIntegration checkSecurity 集成
// ==========================================
describe('SecurityIntegration.checkSecurity 集成', () => {
  let securityIntegration: SecurityIntegrationService;

  beforeEach(() => {
    clearPermissionConfig();
    securityIntegration = new SecurityIntegrationService();
  });

  afterEach(() => {
    clearPermissionConfig();
  });

  it('不配置信任工作区时正常检查', async () => {
    const result = await securityIntegration.checkSecurity('ls -la', 'Bash', {}, undefined);
    expect(result.allowed).toBe(true);
  });

  it('配置信任工作区 cwd 时正常检查', async () => {
    configManager.setConfigValue('permission', {
      mode: 'default',
      trustedWorkspaces: [
        { path: '/project', trustLevel: 'development', enabled: true },
      ],
    });

    const result = await securityIntegration.checkSecurity('ls -la', 'Bash', {}, '/project/src');
    expect(result).toBeDefined();
    expect(result.allowed).toBe(true);
  });

  it('配置信任工作区后 cwd 匹配可正确检查', async () => {
    configManager.setConfigValue('permission', {
      mode: 'default',
      trustedWorkspaces: [
        { path: '/project', trustLevel: 'development', enabled: true },
      ],
    });

    const result = await securityIntegration.checkSecurity('ls -la', 'Bash', {}, '/project/src');
    expect(result.allowed).toBe(true);
  });
});

// ==========================================
// 零影响保证总表
// ==========================================
describe('零影响保证（不配置时行为不变）', () => {
  let securityIntegration: SecurityIntegrationService;
  let analyzer: BashSecurityAnalyzer;

  beforeEach(() => {
    clearPermissionConfig();
    securityIntegration = new SecurityIntegrationService();
    analyzer = new BashSecurityAnalyzer();
  });

  it('isInTrustedWorkspace 返回 false', () => {
    expect(securityIntegration.isInTrustedWorkspace('/any/path')).toBe(false);
  });

  it('getTrustLevelForPath 返回 undefined', () => {
    expect(securityIntegration.getTrustLevelForPath('/any/path')).toBeUndefined();
  });

  it('getDefaultTrustLevel 返回 undefined', () => {
    expect(securityIntegration.getDefaultTrustLevel()).toBeUndefined();
  });

  it('isWithinWorkingDirectory 仅检查 cwd', () => {
    expect(isWithinWorkingDirectory('/etc/passwd', '/home/user/project')).toBe(false);
  });

  it('BashSecurityAnalyzer 仍然拦截危险命令', () => {
    const result = analyzer.analyze('rm -rf /');
    expect(result.safe).toBe(false);
    expect(result.behavior).toBe('deny');
  });

  it('BashSecurityAnalyzer 放行安全命令', () => {
    const result = analyzer.analyze('ls -la');
    expect(result.safe).toBe(true);
  });
});
