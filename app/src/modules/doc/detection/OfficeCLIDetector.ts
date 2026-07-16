/**
 * OfficeCLI 检测器
 * 负责检测本地 OfficeCLI 安装状态、版本校验、中文兼容性检查
 */

import { execSync } from 'child_process';
import { Logger, LogLevel } from '@modules/monitoring';

import type { OfficeCLIInfo, OfficeCLIVersionConstraint } from '../types';

const logger = new Logger({
  module: 'doc:detection',
  level: LogLevel.INFO,
});

/** OfficeCLI 版本兼容约束 */
const OFFICECLI_CONSTRAINT: OfficeCLIVersionConstraint = {
  minVersion: '3.0.0',
  maxVersion: '3.x.x',
  knownIncompatible: [],
  lastTested: '3.2.1',
};

/** 常见安装路径（Windows） */
const KNOWN_PATHS: string[] = [
  'officecli',
  'officecli.exe',
  // npm global
  // 由 which/where 自动发现，此列表仅作 fallback
];

/**
 * 检测 OfficeCLI 是否已安装及其版本
 */
export function detectOfficeCLI(): OfficeCLIInfo {
  try {
    // 检测可执行文件
    const versionOutput = execSync('officecli --version', {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    }).trim();

    const version = extractVersion(versionOutput);
    if (!version) {
      logger.warn('无法解析 OfficeCLI 版本号', { output: versionOutput });
      return { installed: false };
    }

    // 版本兼容性校验
    if (!isVersionCompatible(version, OFFICECLI_CONSTRAINT)) {
      logger.warn('OfficeCLI 版本不兼容', {
        version,
        constraint: OFFICECLI_CONSTRAINT,
      });
      return { installed: true, version, path: 'officecli' };
    }

    // 中文兼容性快速检查
    checkCJKCompatibility();

    logger.info('OfficeCLI 检测完成', { version });
    return { installed: true, version, path: 'officecli' };
  } catch {
    logger.info('OfficeCLI 未安装或不在 PATH 中');
    return { installed: false };
  }
}

/**
 * 检查指定版本是否满足兼容性约束
 */
function isVersionCompatible(
  version: string,
  constraint: OfficeCLIVersionConstraint
): boolean {
  const parts = version.split('.').map(Number);
  const minParts = constraint.minVersion.split('.').map(Number);

  // 已知不兼容版本
  if (constraint.knownIncompatible.includes(version)) {
    return false;
  }

  // 语义版本比较（仅比较 major.minor，patch 允许差异）
  if (parts[0] < minParts[0]) return false;
  if (parts[0] === minParts[0] && parts[1] < minParts[1]) return false;

  // maxVersion 为 '3.x.x' 时仅限制 major
  const maxMajor = parseInt(constraint.maxVersion.split('.')[0], 10);
  if (parts[0] > maxMajor) return false;

  return true;
}

/**
 * 从 stdout 中提取语义版本号
 */
function extractVersion(output: string): string | null {
  const match = output.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

/**
 * 中文兼容性检查
 * 创建测试文档并验证中文输出
 */
function checkCJKCompatibility(): void {
  try {
    const tmpFile = 'test-cjk-compat.docx';
    execSync(`officecli create ${tmpFile} --content "中文测试" --json`, {
      encoding: 'utf-8',
      timeout: 10000,
      windowsHide: true,
    });

    const viewOutput = execSync(`officecli view ${tmpFile} text`, {
      encoding: 'utf-8',
      timeout: 10000,
      windowsHide: true,
    });

    if (!viewOutput.includes('中文测试')) {
      logger.warn('OfficeCLI 中文输出异常，请检查字体配置');
    } else {
      logger.info('OfficeCLI 中文兼容性检查通过');
    }

    // 清理测试文件
    execSync(`del ${tmpFile}`, { windowsHide: true });
  } catch (error) {
    logger.warn('中文兼容性检查失败，不影响正常运行', { error: String(error) });
  }
}

/**
 * 获取版本约束配置
 */
export function getVersionConstraint(): OfficeCLIVersionConstraint {
  return { ...OFFICECLI_CONSTRAINT };
}

/**
 * 生成 OfficeCLI MCP Server 配置
 */
export function buildOfficeCLIMcpConfig(info: OfficeCLIInfo) {
  return {
    type: 'stdio' as const,
    name: 'officecli',
    command: info.path || 'officecli',
    args: ['mcp'],
    env: {
      OFFICE_OUTPUT_DIR: '~/.pyapp/office/output/',
    },
  };
}
