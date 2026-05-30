// import React from 'react'
import { Box, Text } from 'ink';

export type WebFetchOutput = {
  url?: string;
  statusCode?: number;
  statusText?: string;
  contentLength?: number;
  contentType?: string;
  title?: string;
  content?: string;
  error?: string;
};

export function renderToolUseMessage(
  input: Partial<{ url: string; prompt: string }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { url } = input;
  if (!url) return null;
  return verbose ? (
    <Text dimColor>Fetching: {url}</Text>
  ) : (
    <Text dimColor>{url}</Text>
  );
}

export function renderToolUseProgressMessage(): React.ReactNode {
  return <Text dimColor>Fetching...</Text>;
}

export function renderToolResultMessage(
  output: WebFetchOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { statusCode, statusText, contentLength, title, error, content } =
    output;

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">Fetch failed</Text>
        <Text dimColor>{error}</Text>
      </Box>
    );
  }

  const sizeStr = contentLength
    ? contentLength > 1024 * 1024
      ? `${(contentLength / (1024 * 1024)).toFixed(1)} MB`
      : contentLength > 1024
        ? `${(contentLength / 1024).toFixed(1)} KB`
        : `${contentLength} B`
    : 'unknown size';

  if (verbose) {
    return (
      <Box flexDirection="column">
        <Text>
          Received <Text bold>{sizeStr}</Text>
          {statusCode ? (
            <Text>
              {' '}
              (HTTP {statusCode}
              {statusText ? ` ${statusText}` : ''})
            </Text>
          ) : null}
          {title ? <Text dimColor> — {title}</Text> : null}
        </Text>
        {content ? (
          <Box marginTop={1}>
            <Text dimColor>{content.slice(0, 500)}</Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  return (
    <Text>
      Received <Text bold>{sizeStr}</Text>
      {statusCode ? <Text> (HTTP {statusCode})</Text> : null}
      {title ? <Text dimColor> — {title}</Text> : null}
    </Text>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  _options: { verbose: boolean }
): React.ReactNode {
  return <Text color="red">网页请求失败: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ url: string }> | undefined
): string | null {
  if (!input?.url) return null;
  return input.url.slice(0, 80);
}
