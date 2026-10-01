import React from 'react';
// 2026-10-01 子批 B1：本渲染器（连同其统一解析入口）由 `knowledge/tools/` 归位到 ui 层；
// 领域输出类型经 `@modules/knowledge/tools/types`（`types` 段 ⇒ R03-002 豁免）反向引用（ui -> app 合法）。
import { Text, Box } from '@modules/ink';
import { parseToolOutput } from '../knowledge/parseToolOutput';
import type { KnowledgeRestoreOutput } from '@modules/knowledge/tools/types';

export function renderToolUseMessage(
  input: Partial<{ title: string; snapshot: string }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const title = input?.title;
  const snapshot = input?.snapshot;
  if (!title) return null;
  if (verbose) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text dimColor>Restoring: </Text>
          <Text bold>{title}</Text>
        </Box>
        {snapshot && (
          <Box marginTop={1}>
            <Text dimColor>From snapshot: {snapshot}</Text>
          </Box>
        )}
      </Box>
    );
  }
  return (
    <Box flexDirection="row">
      <Text dimColor>Knowledge restore: </Text>
      <Text bold>{title.slice(0, 60)}</Text>
    </Box>
  );
}

export function renderToolResultMessage(
  output: unknown,
  _progressMessages: unknown[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  // 工具契约：result = { title, snapshot }
  const parsed = parseToolOutput(output) as KnowledgeRestoreOutput;
  const title = parsed.title || '';
  const snapshot = parsed.snapshot || '';

  if (verbose && snapshot) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">Restored: </Text>
          <Text bold>{title}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>From snapshot: {snapshot}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color="green">Restored: </Text>
        <Text bold>{title}</Text>
      </Box>
      {snapshot && (
        <Box marginTop={1}>
          <Text dimColor>Snapshot: {snapshot}</Text>
        </Box>
      )}
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  if (!verbose) return <Text color="red">Knowledge restore failed</Text>;
  return <Text color="red">Knowledge restore failed: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ title: string; snapshot: string }> | undefined
): string | null {
  if (!input?.title) return null;
  return `Knowledge restore: ${input.title.slice(0, 60)}`;
}
