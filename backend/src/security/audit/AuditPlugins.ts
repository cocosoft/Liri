/**
 * 插件信任审计模块
 * 验证已安装插件的来源、完整性和权限范围
 * 对齐 OpenClaw security/audit-plugins-trust.ts
 */

import type { SecurityAuditFinding, AuditSeverity } from './AuditTypes';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const logger = new Logger({ level: LogLevel.INFO });

interface PluginMeta {
  name: string;
  path: string;
  hasPackageJson: boolean;
  hasSourceSignature: boolean;
  permissions: string[];
  version?: string;
}

/**
 * 审计已安装插件的安全性
 */
export function auditPlugins(pluginsDir?: string): SecurityAuditFinding[] {
  const findings: SecurityAuditFinding[] = [];
  const scanDir = pluginsDir || join(process.cwd(), 'plugins');

  try {
    if (!existsSync(scanDir)) {
      return findings;
    }

    const pluginMetas = discoverPlugins(scanDir);

    for (const meta of pluginMetas) {
      auditPluginIntegrity(meta, findings);
      auditPluginPermissions(meta, findings);
      auditPluginSource(meta, findings);
    }

    logger.info(`插件信任审计完成，扫描 ${pluginMetas.length} 个插件，发现 ${findings.length} 个问题`);
  } catch (error) {
    logger.error('插件信任审计失败', error as Error);
  }

  return findings;
}

function discoverPlugins(scanDir: string): PluginMeta[] {
  const metas: PluginMeta[] = [];
  try {
    const { readdirSync, statSync } = require('node:fs');
    const entries = readdirSync(scanDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginPath = join(scanDir, entry.name);
      const packageJsonPath = join(pluginPath, 'package.json');
      const hasPackageJson = existsSync(packageJsonPath);

      let permissions: string[] = [];
      let version: string | undefined;
      if (hasPackageJson) {
        try {
          const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
          permissions = pkg['py_app']?.permissions || [];
          version = pkg.version;
        } catch {
          // 忽略解析错误
        }
      }

      metas.push({
        name: entry.name,
        path: pluginPath,
        hasPackageJson,
        hasSourceSignature: existsSync(join(pluginPath, '.signature')),
        permissions,
        version,
      });
    }
  } catch {
    // 目录读取失败
  }
  return metas;
}

function auditPluginIntegrity(meta: PluginMeta, findings: SecurityAuditFinding[]): void {
  if (!meta.hasPackageJson) {
    findings.push({
      id: `PLUGIN_${meta.name}_integrity-001`,
      severity: 'MEDIUM',
      category: 'plugin_trust',
      path: meta.path,
      message: `插件 "${meta.name}" 缺少 package.json，无法验证基本信息`,
      remediation: '为插件添加 package.json 文件，包含名称、版本和权限声明',
    });
  }
  if (!meta.hasSourceSignature) {
    findings.push({
      id: `PLUGIN_${meta.name}_integrity-002`,
      severity: 'LOW',
      category: 'plugin_trust',
      path: meta.path,
      message: `插件 "${meta.name}" 缺少数字签名，无法验证来源完整性`,
      remediation: '为插件添加 .signature 文件，或通过信任何种源安装',
    });
  }
}

function auditPluginPermissions(meta: PluginMeta, findings: SecurityAuditFinding[]): void {
  const dangerousPerms = ['filesystem.full', 'network.all', 'process.spawn', 'security.bypass'];
  for (const perm of meta.permissions) {
    if (dangerousPerms.includes(perm)) {
      findings.push({
        id: `PLUGIN_${meta.name}_perm-001`,
        severity: 'HIGH',
        category: 'plugin_trust',
        path: meta.path,
        message: `插件 "${meta.name}" 声明了高风险权限: ${perm}`,
        remediation: `审查插件是否真正需要 ${perm} 权限，考虑限制权限范围`,
      });
    }
  }
}

function auditPluginSource(meta: PluginMeta, findings: SecurityAuditFinding[]): void {
  const indexPath = join(meta.path, 'index.ts');
  if (!existsSync(indexPath)) return;

  try {
    const content = readFileSync(indexPath, 'utf-8');
    if (/child_process/.test(content) && !meta.permissions.includes('process.spawn')) {
      findings.push({
        id: `PLUGIN_${meta.name}_source-001`,
        severity: 'MEDIUM',
        category: 'plugin_trust',
        path: meta.path,
        message: `插件 "${meta.name}" 使用了 child_process 但未声明 process.spawn 权限`,
        remediation: '在 package.json 的 py_app.permissions 中声明 process.spawn 权限',
      });
    }
    if (/https?:\/\/[^\s"']+/.test(content)) {
      findings.push({
        id: `PLUGIN_${meta.name}_source-002`,
        severity: 'LOW',
        category: 'plugin_trust',
        path: meta.path,
        message: `插件 "${meta.name}" 包含外部 URL 引用，请确认安全性`,
        remediation: '审查所有外部 URL，确保不包含恶意地址或数据外泄',
      });
    }
  } catch {
    // 文件读取失败，跳过
  }
}
