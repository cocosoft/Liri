import React from 'react';
import { Text, Box } from '../../../components/ink.js';
import { parseToolOutput } from '../parseToolOutput.js';
import type { KnowledgeSnapshotsOutput } from '../types.js';

/** 快照条目显示名：工具 result 直接是文件名数组（字符串元素），兼容对象形式 */
function snapshotLabel(s: unknown, i: number): string {
  if (typeof s === 'string') return s;
  if (s && typeof s === 'object') {
    const o = s as { filename?: unknown; name?: unknown };
    if (typeof o.filename === 'string') return o.filename;
    if (typeof o.name === 'string') return o.name;
  }
  return `snapshot_${i}`;
}

export function renderToolUseMessage(
  input: Partial<{ title: string }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const title = input?.title;
  if (!title) return null;
  if (verbose) {
    return (
      <Box flexDirection="row">
        <Text dimColor>Listing snapshots for: </Text>
        <Text bold>{title}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="row">
      <Text dimColor>Knowledge snapshots: </Text>
      <Text bold>{title.slice(0, 60)}</Text>
    </Box>
  );
}

export function renderToolResultMessage(
  output: unknown,
  _progressMessages: unknown[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  // 工具契约：result 直接是 string[]（文件名）；兼容对象包裹形式 { snapshots } / { versions }
  const parsed = parseToolOutput(output) as KnowledgeSnapshotsOutput;
  const snapshots = Array.isArray(parsed)
    ? parsed
    : (parsed.snapshots ?? parsed.versions ?? []);
  const title = Array.isArray(parsed) ? '' : (parsed.title ?? '');

  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return (
      <Box flexDirection="row">
        <Text dimColor>No snapshots found</Text>
        {title && <Text dimColor> for "{title}"</Text>}
      </Box>
    );
  }

  if (verbose) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text bold>{snapshots.length}</Text>
          <Text> snapshots</Text>
          {title && (
            <Text>
              {' '}
              for <Text italic>{title}</Text>
            </Text>
          )}
        </Box>
        <Box marginTop={1} marginLeft={2} flexDirection="column">
          {snapshots.slice(0, 10).map((s, i) => (
            <Box key={i} flexDirection="row">
              <Text dimColor>[{i + 1}]</Text>
              <Text> {snapshotLabel(s, i)}</Text>
            </Box>
          ))}
          {snapshots.length > 10 && (
            <Text dimColor>... {snapshots.length - 10} more</Text>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text bold>{snapshots.length}</Text>
        <Text> snapshots</Text>
        {title && (
          <Text>
            {' '}
            for <Text bold>{title}</Text>
          </Text>
        )}
      </Box>
      <Box marginTop={1} marginLeft={2} flexDirection="column">
        {snapshots.slice(0, 5).map((s, i) => (
          <Text key={i} dimColor>
            {snapshotLabel(s, i)}
          </Text>
        ))}
        {snapshots.length > 5 && (
          <Text dimColor>... {snapshots.length - 5} more</Text>
        )}
      </Box>
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  if (!verbose) return <Text color="red">Snapshot listing failed</Text>;
  return <Text color="red">Snapshot listing failed: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ title: string }> | undefined
): string | null {
  if (!input?.title) return null;
  return `Knowledge snapshots: ${input.title.slice(0, 60)}`;
}
