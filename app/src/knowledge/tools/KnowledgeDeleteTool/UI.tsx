import React from 'react';
import { Text, Box } from '../../../components/ink.js';
import { parseToolOutput } from '../parseToolOutput.js';
import type { KnowledgeDeleteOutput } from '../types.js';

export function renderToolUseMessage(
  input: Partial<{ title: string; docPath: string }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const label = input?.title || input?.docPath;
  if (!label) return null;
  if (verbose) {
    return (
      <Box flexDirection="row">
        <Text dimColor>Deleting knowledge document: </Text>
        <Text bold>{label}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="row">
      <Text dimColor>Knowledge delete: </Text>
      <Text bold>{label.slice(0, 60)}</Text>
    </Box>
  );
}

export function renderToolResultMessage(
  output: unknown,
  _progressMessages: unknown[],
  _options: { verbose: boolean }
): React.ReactNode {
  // 工具契约：候选列表 result 为数组 [{ title, docPath }]；删除成功 result 为 { title, filePath }
  const parsed = parseToolOutput(output) as KnowledgeDeleteOutput;
  if (Array.isArray(parsed)) {
    const multi = parsed.length > 1;
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="yellow">
            {multi ? `Multiple matches (${parsed.length})` : 'No exact match'}
          </Text>
        </Box>
        <Box marginTop={1} marginLeft={2} flexDirection="column">
          {parsed.map((c, i) => (
            <Text key={i} dimColor>
              [{i + 1}] {c.title || c.docPath || c.filePath}
              {c.category ? ` (${c.category})` : ''}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            Not deleted. Specify the exact docPath to delete.
          </Text>
        </Box>
      </Box>
    );
  }

  const title = parsed.title || parsed.filePath || '';
  return (
    <Box flexDirection="row">
      <Text color="green">Deleted: </Text>
      <Text bold>{title || 'document'}</Text>
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  if (!verbose) return <Text color="red">Knowledge delete failed</Text>;
  return <Text color="red">Knowledge delete failed: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ title: string; docPath: string }> | undefined
): string | null {
  if (!input) return null;
  const label = input.title || input.docPath;
  if (!label) return null;
  return `Knowledge delete: ${label.slice(0, 60)}`;
}
