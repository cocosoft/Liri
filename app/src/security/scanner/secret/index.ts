// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
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
