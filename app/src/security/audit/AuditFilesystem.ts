/**
 * 文件系统安全审计模块
 * 检查敏感路径权限、Windows ACL、密钥文件暴露
 */

import type { SecurityAuditFinding, AuditSeverity } from './AuditTypes';
import { Logger, LogLevel } from '@modules/monitoring';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveProjectRoot, resolveDataDir } from '@modules/core';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 敏感文件路径（相对于 resolveDataDir()）
 */
const SENSITIVE_DATA_FILES = [
  {
    file: 'oauth-tokens.json',
    label: 'OAuth Token 存储',
    severity: 'HIGH' as AuditSeverity,
  },
  { file: 'app.db', label: '数据库文件', severity: 'MEDIUM' as AuditSeverity },
];

const SENSITIVE_PATHS = [
  { path: '.env', label: '环境变量文件', severity: 'HIGH' as AuditSeverity },
  {
    path: '.env.local',
    label: '本地环境变量',
    severity: 'HIGH' as AuditSeverity,
  },
  {
    path: 'config/credentials.json',
    label: '凭证配置',
    severity: 'HIGH' as AuditSeverity,
  },
  {
    path: '.ssh/id_rsa',
    label: 'SSH 私钥',
    severity: 'CRITICAL' as AuditSeverity,
  },
  {
    path: '.git-credentials',
    label: 'Git 凭证',
    severity: 'HIGH' as AuditSeverity,
  },
];

const UNSAFE_WORLD_ACCESSIBLE = 0o777;

/**
 * 审计文件系统安全
 */
export function auditFilesystem(workspaceDir?: string): SecurityAuditFinding[] {
  const findings: SecurityAuditFinding[] = [];
  const scanDir = workspaceDir || resolveProjectRoot();

  try {
    auditSensitivePathPermissions(scanDir, findings);
    auditWorldWritableFiles(scanDir, findings);
    auditSymlinkSafety(scanDir, findings);

    logger.info(`文件系统审计完成，发现 ${findings.length} 个问题`);
  } catch (error) {
    logger.error('文件系统审计失败', error as Error);
  }

  return findings;
}

function auditSensitivePathPermissions(
  scanDir: string,
  findings: SecurityAuditFinding[]
): void {
  for (const { path: relPath, label, severity } of SENSITIVE_PATHS) {
    const fullPath = join(scanDir, relPath);
    checkPathPermissions(fullPath, relPath, label, severity, findings);
  }

  // 检查数据目录下的敏感文件
  const dataDir = resolveDataDir();
  for (const { file, label, severity } of SENSITIVE_DATA_FILES) {
    const fullPath = join(dataDir, file);
    checkPathPermissions(fullPath, file, label, severity, findings);
  }
}

function checkPathPermissions(
  fullPath: string,
  relPath: string,
  label: string,
  severity: AuditSeverity,
  findings: SecurityAuditFinding[]
): void {
  if (!existsSync(fullPath)) return;

  try {
    const st = statSync(fullPath);
    const mode = st.mode & 0o777;

    if (mode & 0o007) {
      findings.push({
        id: `FS_perm_${relPath.replace(/[/.]/g, '_')}`,
        severity,
        category: 'filesystem',
        path: fullPath,
        message: `${label} (${relPath}) 对其他用户可访问 (权限: ${mode.toString(8)})`,
        remediation: `运行 chmod 600 ${relPath} 限制只有文件所有者可读写`,
      });
    }
  } catch {
    // stat 失败
  }
}

function auditWorldWritableFiles(
  scanDir: string,
  findings: SecurityAuditFinding[]
): void {
  const checkDirs = [
    join(scanDir, 'app', 'config'),
    resolveDataDir(),
    join(scanDir, 'app', 'configs'),
  ];

  for (const dir of checkDirs) {
    if (!existsSync(dir)) continue;
    try {
      const st = statSync(dir);
      const mode = st.mode & 0o777;
      if (mode & 0o002) {
        findings.push({
          id: `FS_dir_${dir.replace(/[/.]/g, '_')}`,
          severity: 'MEDIUM',
          category: 'filesystem',
          path: dir,
          message: `配置目录 ${dir} 对所有人可写 (权限: ${mode.toString(8)})`,
          remediation: `运行 chmod 755 ${dir} 限制写入权限`,
        });
      }
    } catch {
      // stat 失败
    }
  }
}

function auditSymlinkSafety(
  scanDir: string,
  findings: SecurityAuditFinding[]
): void {
  const checkDirs = [join(scanDir, 'config'), join(scanDir, 'plugins')];

  for (const baseDir of checkDirs) {
    if (!existsSync(baseDir)) continue;

    try {
      const { readdirSync } = require('node:fs');
      const entries = readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) {
          const symlinkPath = join(baseDir, entry.name);
          findings.push({
            id: `FS_symlink_${symlinkPath.replace(/[/.]/g, '_')}`,
            severity: 'LOW',
            category: 'filesystem',
            path: symlinkPath,
            message: `检测到符号链接: ${symlinkPath}`,
            remediation: '确认符号链接目标的安全性，避免链接到敏感目录',
          });
        }
      }
    } catch {
      // readdir 失败
    }
  }
}
