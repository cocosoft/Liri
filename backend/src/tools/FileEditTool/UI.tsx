// @ts-nocheck
/**
 * FileEditTool UI 组件
 *
 * 显示编辑前后行级 diff 对比，辅助用户理解代码变更
 *
 * 参考: cc_code/backend/tools/FileEditTool/UI.tsx
 */

import React from 'react';
import { Box, Text } from '../../ink.js';

export type FileEditUIOutput = {
  filePath?: string;
  oldContent?: string;
  newContent?: string;
  diff?: string;
  created?: boolean;
  linesChanged?: number;
};

export function userFacingName(
  input:
    | Partial<{ file_path: string; old_string: string; edits: unknown[] }>
    | undefined
): string {
  if (!input) return 'Edit';
  if (input.old_string === '') return 'Create';
  if (input.edits != null) return 'Edit';
  return 'Edit';
}

export function renderToolUseMessage(
  input: Partial<{ file_path: string; old_string: string; new_string: string }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { file_path, old_string, new_string } = input;
  if (!file_path) return null;

  const isNew = !old_string;
  const operation = isNew ? 'Create' : 'Edit';

  if (verbose) {
    return (
      <Box flexDirection="column">
        <Text bold>
          {operation}: {file_path}
        </Text>
        {!isNew && old_string ? (
          <Box marginLeft={2}>
            <Text dimColor>- {old_string.slice(0, 80)}</Text>
          </Box>
        ) : null}
        {new_string ? (
          <Box marginLeft={2}>
            <Text color="green">+ {new_string.slice(0, 80)}</Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text dimColor>{operation}: </Text>
      <Text>{file_path}</Text>
    </Box>
  );
}

export function renderToolResultMessage(
  output: FileEditUIOutput,
  _progressMessages: unknown[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { filePath, created, linesChanged, diff } = output;

  if (created) {
    return (
      <Box flexDirection="row">
        <Text color="green">✓ </Text>
        <Text>Created: {filePath}</Text>
      </Box>
    );
  }

  if (verbose && diff) {
    const diffLines = diff.split('\n');
    const addedLines = diffLines.filter((l) => l.startsWith('+')).length;
    const removedLines = diffLines.filter((l) => l.startsWith('-')).length;
    const displayDiff = diffLines.slice(0, 30);

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">✓ </Text>
          <Text>Updated: {filePath}</Text>
          <Text dimColor>
            {' '}
            (+{addedLines} -{removedLines} / {linesChanged ?? 0} lines)
          </Text>
        </Box>
        <Box marginTop={1} marginLeft={2} flexDirection="column">
          {displayDiff.map((line, i) => {
            const isAdd = line.startsWith('+');
            const isRemove = line.startsWith('-');
            const isHeader = line.startsWith('@@');
            const color = isAdd
              ? 'green'
              : isRemove
                ? 'red'
                : isHeader
                  ? 'blue'
                  : undefined;
            return (
              <Text key={i} color={color} dimColor={!isAdd && !isRemove}>
                {line}
              </Text>
            );
          })}
          {diffLines.length > 30 ? (
            <Text dimColor>… ({diffLines.length - 30} more diff lines)</Text>
          ) : null}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text color="green">✓ </Text>
      <Text>Updated: {filePath}</Text>
      {linesChanged !== undefined ? (
        <Text dimColor> ({linesChanged} lines)</Text>
      ) : null}
    </Box>
  );
}

export function renderToolUseRejectedMessage(
  input: Partial<{ file_path: string }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  return (
    <Box flexDirection="row">
      <Text dimColor>✗ </Text>
      <Text dimColor>
        Edit rejected{verbose && input.file_path ? `: ${input.file_path}` : ''}
      </Text>
    </Box>
  );
}

export function renderToolUseErrorMessage(
  _result: unknown,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  return (
    <Box flexDirection="row">
      <Text color="red">✗ </Text>
      <Text color="red">Error editing file</Text>
      {verbose ? <Text dimColor> — see details above</Text> : null}
    </Box>
  );
}

export function getToolUseSummary(
  input: Partial<{ file_path: string }> | undefined
): string | null {
  if (!input?.file_path) return null;
  return input.file_path;
}
