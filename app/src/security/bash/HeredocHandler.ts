export type HeredocInfo = {
  fullText: string;
  delimiter: string;
  dash: boolean;
  quoted: boolean;
  contentStartIndex: number;
  contentEndIndex: number;
};

export type HeredocExtractionResult = {
  processedCommand: string;
  heredocs: Map<string, HeredocInfo>;
};

let heredocCounter = 0;

function generatePlaceholder(): string {
  return `__HEREDOC_${heredocCounter++}_${Date.now().toString(36)}__`;
}

const HEREDOC_START_RE = /<<(-)?[ \t]*(?:'([^']+)'|"([^"]+)"|(\\?\w+))/g;

export function extractHeredocs(command: string): HeredocExtractionResult {
  const heredocs = new Map<string, HeredocInfo>();

  if (!command.includes('<<')) {
    return { processedCommand: command, heredocs };
  }

  const regex = new RegExp(HEREDOC_START_RE.source, 'g');
  const matches: Array<{
    fullMatch: string;
    dash: boolean;
    delimiter: string;
    quoted: boolean;
    startIndex: number;
    endIndex: number;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(command)) !== null) {
    const dash = match[1] === '-';
    const singleQuoted = match[2];
    const doubleQuoted = match[3];
    const unquoted = match[4];

    let delimiter: string;
    let quoted: boolean;

    if (singleQuoted !== undefined) {
      delimiter = singleQuoted;
      quoted = true;
    } else if (doubleQuoted !== undefined) {
      delimiter = doubleQuoted;
      quoted = true;
    } else {
      delimiter = unquoted.replace(/^\\/, '');
      quoted = false;
    }

    matches.push({
      fullMatch: match[0],
      dash,
      delimiter,
      quoted,
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  if (matches.length === 0) {
    return { processedCommand: command, heredocs };
  }

  let processedCommand = command;
  let offset = 0;

  for (const m of matches) {
    const heredocStartLineEnd = command.indexOf('\n', m.endIndex);
    if (heredocStartLineEnd === -1) break;

    const contentStart = heredocStartLineEnd + 1;

    const delimPattern = new RegExp(
      `^${m.dash ? '[\\t]*' : ''}${escapeRegex(m.delimiter)}\\s*$`,
      'm'
    );
    delimPattern.lastIndex = contentStart;
    const delimMatch = delimPattern.exec(command.slice(contentStart));

    if (!delimMatch) break;

    const contentEnd = contentStart + delimMatch.index;
    const fullEnd = contentStart + delimMatch.index + delimMatch[0].length;

    const adjustedStart = m.startIndex - offset;
    const adjustedEnd = fullEnd - offset;

    const fullText = command.slice(m.startIndex, fullEnd);
    const placeholder = generatePlaceholder();

    processedCommand =
      processedCommand.slice(0, adjustedStart) +
      placeholder +
      processedCommand.slice(adjustedEnd);

    heredocs.set(placeholder, {
      fullText,
      delimiter: m.delimiter,
      dash: m.dash,
      quoted: m.quoted,
      contentStartIndex: m.startIndex - offset,
      contentEndIndex: m.startIndex - offset + fullText.length,
    });

    offset += fullText.length - placeholder.length;
  }

  return { processedCommand, heredocs };
}

export function restoreHeredocs(
  processedCommand: string,
  heredocs: Map<string, HeredocInfo>
): string {
  let result = processedCommand;
  for (const [placeholder, info] of heredocs) {
    result = result.replace(placeholder, info.fullText);
  }
  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function hasHeredoc(command: string): boolean {
  return HEREDOC_START_RE.test(command);
}

export function isHeredocSafe(info: HeredocInfo, content: string): boolean {
  if (info.quoted) {
    return true;
  }
  const dangerous = [/\$\(/, /`[^`]+`/, /\$\{/];
  return !dangerous.some((p) => p.test(content));
}

/**
 * BashAST 集成：去除heredoc内容的安全预处理
 * 在 parseForSecurity 调用前使用，仅保留命令部分丢弃heredoc体
 */
export function stripHeredocs(command: string): string {
  if (!command.includes('<<')) return command;
  const { processedCommand } = extractHeredocs(command);
  return processedCommand;
}

/**
 * BashAST 集成：检查命令中heredoc是否安全
 * 返回 `false` 表示含有不安全的非引号heredoc（可能含命令替换）
 */
export function checkHeredocSafety(command: string): {
  safe: boolean;
  reason?: string;
} {
  if (!hasHeredoc(command)) return { safe: true };

  const { heredocs } = extractHeredocs(command);
  for (const [placeholder, info] of heredocs) {
    const contentStart = info.fullText.indexOf(
      '\n',
      info.fullText.indexOf(info.delimiter) + info.delimiter.length
    );
    if (contentStart === -1) continue;
    const content = info.fullText.slice(contentStart);

    if (!isHeredocSafe(info, content)) {
      return {
        safe: false,
        reason: `Heredoc '${info.delimiter}' contains unquoted command substitution`,
      };
    }
  }
  return { safe: true };
}
