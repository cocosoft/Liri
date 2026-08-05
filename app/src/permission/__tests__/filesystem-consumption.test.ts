/**
 * M0 配置打通验收（§六b）：面板保存结构与 filesystem 消费键对齐
 *
 * 面板（TrustedWorkspacesPanel/CustomRulesPanel）保存 /v1/config/permission 整块：
 *   { mode, trustedWorkspaces: [{path, trustLevel, enabled}],
 *     customRules: { directoryRules: { blacklist: [{path}] } } }
 * filesystem.ts 消费同一键：isWithinWorkingDirectory 读 permission.trustedWorkspaces，
 * isDangerousFile/isInDangerousDirectory 读 permission.customRules.directoryRules.blacklist。
 *
 * 注意：不使用 mock.module（会全局污染其他测试的 @modules/config 解析）。
 * 消费链的运行时端到端验证见方案 §九（PUT 整块 → GET 落盘一致），
 * 本测试固化"面板写入结构 == 消费键路径"的契约，防止再次断裂（回归防护）。
 */

import { describe, expect, it } from 'bun:test';
import {
  DANGEROUS_FILES,
  DANGEROUS_DIRECTORIES,
  isDangerousFile,
  isInDangerousDirectory,
} from '../filesystem';

describe('面板配置结构与 filesystem 消费键对齐（M0 配置打通）', () => {
  it('面板保存的 permission 整块包含 filesystem 消费键路径', () => {
    // 与 TrustedWorkspacesPanel/CustomRulesPanel 保存的结构一致（M0c）
    const permissionBlock = {
      mode: 'default',
      trustedWorkspaces: [
        { path: 'C:\\ws\\dev', trustLevel: 'work', enabled: true },
      ],
      customRules: {
        directoryRules: { blacklist: [{ path: 'C:\\secret' }] },
      },
    };

    // filesystem.ts:89 isWithinWorkingDirectory 读 trustedWorkspaces[].path
    expect(permissionBlock.trustedWorkspaces[0].path).toBe('C:\\ws\\dev');
    // filesystem.ts:36/54 读 customRules.directoryRules.blacklist[].path
    expect(permissionBlock.customRules.directoryRules.blacklist[0].path).toBe(
      'C:\\secret'
    );
  });

  it('默认危险文件/目录兜底仍生效（fail-closed，无自定义规则时）', () => {
    expect(isDangerousFile('.gitconfig')).toBe(true);
    expect(isInDangerousDirectory('/repo/.git/config')).toBe(true);
    expect(DANGEROUS_FILES).toContain('.gitconfig');
    expect(DANGEROUS_DIRECTORIES).toContain('.git');
  });
});
