/**
 * 团队记忆密钥守护
 *
 * 在写入团队记忆文件前检查文件内容是否包含密钥。
 * 如检测到密钥则拒绝写入，因为团队记忆会同步给所有协作者。
 */

import { scanForSecrets, type SecretMatch } from './SecretScanner';

const TEAM_MEM_DIR_PATTERN =
  /[\\/]\.(?:claude|claude-code|codex|kairos)[\\/](?:team-?mem(?:ory)?|shared)[\\/]/i;

export function isTeamMemPath(filePath: string): boolean {
  return TEAM_MEM_DIR_PATTERN.test(filePath);
}

export function checkTeamMemSecrets(
  filePath: string,
  content: string
): string | null {
  if (!isTeamMemPath(filePath)) {
    return null;
  }

  const matches: SecretMatch[] = scanForSecrets(content);
  if (matches.length === 0) {
    return null;
  }

  const labels = matches.map((m) => m.label).join(', ');
  return (
    `Content contains potential secrets (${labels}) and cannot be written to team memory. ` +
    'Team memory is shared with all repository collaborators. ' +
    'Remove the sensitive content and try again.'
  );
}
