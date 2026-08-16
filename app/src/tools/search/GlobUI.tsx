// import React from 'react'
import { Box, Text } from '@modules/ink';

export type GlobOutput = {
  pattern?: string;
  path?: string;
  files?: string[];
  fileCount?: number;
  truncated?: boolean;
};

export function renderToolUseMessage(
  input: Partial<{ pattern: string; path: string }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { pattern, path } = input;
  if (!pattern) return null;

  if (verbose) {
    return (
      <Box flexDirection="row">
        <Text dimColor>Searching files matching </Text>
        <Text bold>{pattern}</Text>
        {path ? <Text dimColor> in {path}</Text> : null}
      </Box>
    );
  }

  return (
    <Text>
      <Text dimColor>Searching </Text>
      <Text bold>{pattern.slice(0, 60)}</Text>
    </Text>
  );
}

export function renderToolResultMessage(
  output: GlobOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { fileCount, files } = output;

  if (verbose && files && files.length > 0) {
    const tree = buildFileTree(files);
    return (
      <Box flexDirection="column">
        <Text>
          Found <Text bold>{fileCount ?? files.length}</Text> file
          {files.length !== 1 ? 's' : ''}
        </Text>
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>{renderFileTree(tree, '')}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Text>
      Found <Text bold>{fileCount ?? files?.length ?? 0}</Text> file
      {(fileCount ?? files?.length ?? 0) !== 1 ? 's' : ''}
    </Text>
  );
}

export function getToolUseSummary(
  input: Partial<{ pattern: string; path: string }> | undefined
): string | null {
  if (!input?.pattern) return null;
  return `glob ${input.pattern.slice(0, 40)}`;
}

type FileTree = Map<string, FileTree | string>;

function buildFileTree(paths: string[]): FileTree {
  const root: FileTree = new Map();

  for (const path of paths) {
    const parts = path.replace(/\\/g, '/').split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        current.set(part, part);
      } else {
        if (!current.has(part)) {
          current.set(part, new Map());
        }
        const next = current.get(part);
        if (next instanceof Map) {
          current = next;
        }
      }
    }
  }

  return root;
}

function renderFileTree(tree: FileTree, prefix: string): string {
  const entries = [...tree.entries()];
  const lines: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const [name, value] = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const nextPrefix = prefix + (isLast ? '    ' : '│   ');

    if (value instanceof Map) {
      lines.push(`${prefix}${connector}${name}/`);
      lines.push(renderFileTree(value, nextPrefix));
    } else {
      lines.push(`${prefix}${connector}${name}`);
    }
  }

  return lines.join('\n');
}
