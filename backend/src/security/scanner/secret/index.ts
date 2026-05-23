/**
 * 秘密扫描模块
 *
 * 聚合分散的秘密扫描能力：
 * - MemorySecretScanner（记忆秘密扫描）
 * - TeamMemSecretScanner（团队记忆秘密扫描）
 * - TeamMemSecretGuard（团队记忆写入保护）
 * - PluginSecurityScanner（插件安全扫描）
 */

export {
  scanForSecrets as scanMemoryForSecrets,
  containsSecrets,
  sanitizeSecrets,
  scanMemoryContent,
  validateMemoryContent,
} from '../../../memory/scanners/MemorySecretScanner';
export type {
  SecretMatch as MemorySecretMatch,
  SecretScanResult,
} from '../../../memory/scanners/MemorySecretScanner';

export { scanForSecrets as scanTeamMemForSecrets } from '../../../services/teamMemorySync/SecretScanner';
export type { SecretMatch as TeamMemSecretMatch } from '../../../services/teamMemorySync/SecretScanner';

export {
  isTeamMemPath,
  checkTeamMemSecrets,
} from '../../../services/teamMemorySync/TeamMemSecretGuard';

export { PluginSecurityScanner } from '../../../plugins/utils/pluginSecurityScanner';
export type {
  SecurityIssue,
  SecurityScanResult as PluginSecurityScanResult,
  DangerPattern,
  RiskLevel,
} from '../../../plugins/utils/pluginSecurityScanner';
