/**
 * 客户端密钥扫描器
 *
 * 在上传团队记忆前扫描内容中的凭证密钥。
 * 基于 gitleaks 的高置信度规则子集（MIT 许可证），仅包含具有特异性前缀、假阳性率极低的规则。
 */

import { capitalize } from '@modules/common/utils.js';

interface SecretRule {
  id: string
  source: string
  flags?: string
}

export interface SecretMatch {
  ruleId: string
  label: string
}

const SECRET_RULES: SecretRule[] = [
  {
    id: 'github-pat',
    source: 'ghp_[a-zA-Z0-9]{36}',
  },
  {
    id: 'github-fine-grained-pat',
    source: 'github_pat_[a-zA-Z0-9_]{36,}',
  },
  {
    id: 'aws-access-token',
    source: 'AKIA[0-9A-Z]{16}',
  },
  {
    id: 'aws-secret-key',
    source: '(?:"|\\x27|`|\\s|^)(?:[A-Za-z0-9+/]{40})(?:"|\\x27|`|\\s|$)',
  },
  {
    id: 'openai-api-key',
    source: 'sk-[a-zA-Z0-9]{32,}',
  },
  {
    id: 'google-api-key',
    source: 'AIza[0-9A-Za-z_-]{35}',
  },
  {
    id: 'private-key',
    source: '-----BEGIN(?: RSA| EC| DSA| PRIVATE| OPENSSH)',
  },
  {
    id: 'jwt-token',
    source: 'eyJ[a-zA-Z0-9_-]{10,}\\.[a-zA-Z0-9_-]{10,}\\.[a-zA-Z0-9_-]{10,}',
  },
  {
    id: 'slack-token',
    source: 'xox[baprs]-[0-9A-Za-z-]{10,}',
  },
  {
    id: 'discord-token',
    source: '[MNO][a-zA-Z\\d_-]{23,25}\\.[a-zA-Z\\d_-]{6}\\.[a-zA-Z\\d_-]{27}',
  },
  {
    id: 'password-in-url',
    source: '://[^:/]+:[^/@]+@',
  },
  {
    id: 'generic-secret',
    source: '(?i)(?:secret|password|token|key|credential)[\x27"]?\\s*[:=]\\s*[\x27"][^\\s]{8,}[\x27"]',
  },
]

let compiledRules: Array<{ regex: RegExp; ruleId: string }> | null = null

function getCompiledRules(): Array<{ regex: RegExp; ruleId: string }> {
  if (!compiledRules) {
    compiledRules = SECRET_RULES.map((rule) => ({
      regex: new RegExp(rule.source, rule.flags || 'g'),
      ruleId: rule.id,
    }))
  }
  return compiledRules
}

function ruleIdToLabel(ruleId: string): string {
  return ruleId
    .split('-')
    .map(capitalize)
    .join(' ')
    .replace('Pat', 'PAT')
    .replace('Aws', 'AWS')
    .replace('Openai', 'OpenAI')
    .replace('Jwt', 'JWT')
    .replace('Url', 'URL')
}

export function scanForSecrets(content: string): SecretMatch[] {
  const matches: SecretMatch[] = []
  const rules = getCompiledRules()
  const seen = new Set<string>()

  for (const rule of rules) {
    rule.regex.lastIndex = 0
    const result = rule.regex.exec(content)
    if (result && !seen.has(rule.ruleId)) {
      seen.add(rule.ruleId)
      matches.push({
        ruleId: rule.ruleId,
        label: ruleIdToLabel(rule.ruleId),
      })
    }
  }

  return matches
}
