export const PLATFORM_HINTS: Record<string, string> = {
  telegram:
    'This conversation is happening on Telegram. Format messages with MarkdownV2.',
  discord:
    'This conversation is happening on Discord. Use ```code blocks``` and > quotes.',
  slack:
    'This conversation is happening on Slack. Use `code` and *bold* formatting.',
  wechat:
    'This conversation is happening on WeChat. Keep responses concise (max 2048 chars).',
  feishu:
    'This conversation is happening on Feishu. Use interactive cards where appropriate.',
  dingtalk:
    'This conversation is happening on DingTalk. Use markdown formatting.',
  wecom:
    'This conversation is happening on WeChat Work. Keep responses concise (max 2048 chars).',
  qq: 'This conversation is happening on QQ. Keep responses concise (max 4096 chars).',
  whatsapp:
    'This conversation is happening on WhatsApp. Keep responses brief and mobile-friendly.',
  signal:
    'This conversation is happening on Signal. Messages are end-to-end encrypted.',
  matrix:
    'This conversation is happening on Matrix. Format messages with HTML or Markdown.',
};

export function buildEnvironmentHints(): string {
  const hints: string[] = [];

  hints.push(`OS: ${process.platform}`);
  hints.push(
    `Shell: ${process.env['SHELL'] || process.env['ComSpec'] || 'unknown'}`
  );
  hints.push(`CWD: ${process.cwd()}`);
  hints.push(`Date: ${new Date().toISOString()}`);

  const username = process.env['USER'] || process.env['USERNAME'];
  if (username) {
    hints.push(`User: ${username}`);
  }

  return hints.join('\n');
}

export function getPlatformHint(platform: string): string {
  return PLATFORM_HINTS[platform.toLowerCase()] || '';
}
