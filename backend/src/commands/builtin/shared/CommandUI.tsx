import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { CommandResult } from '../../types/index.js';

interface CommandUIProps {
  commandName: string;
  args?: string;
  onDone?: () => void;
  execute: () => Promise<CommandResult | void>;
}

export function CommandUI({
  commandName,
  args,
  onDone,
  execute,
}: CommandUIProps) {
  const [state, setState] = useState<'loading' | 'success' | 'error'>(
    'loading'
  );
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string>('');

  useEffect(() => {
    const run = async () => {
      try {
        const result = await execute();
        if (result && 'message' in result && result.message) {
          setOutput(result.message);
        }
        setState('success');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setState('error');
      }
    };
    run();
  }, [execute]);

  useEffect(() => {
    if (state === 'loading') return;
    const timer = setTimeout(() => onDone?.(), 2000);
    return () => clearTimeout(timer);
  }, [state, onDone]);

  if (state === 'loading') {
    return (
      <Box>
        <Text>
          <Text color="yellow">⟳</Text> Running /{commandName}
          {args ? ` ${args}` : ''}...
        </Text>
      </Box>
    );
  }

  if (state === 'error') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box>
          <Text color="red">✗ Error: {error}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="green">
          ✓ /{commandName} completed
        </Text>
      </Box>
      {output ? (
        <Box>
          <Text>{output}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export async function resolveCommandExecutor(
  modulePromise: Promise<Record<string, unknown>>,
  exportName: string,
  args: string
): Promise<CommandResult | void> {
  const mod = await modulePromise;
  const exported = mod[exportName];

  if (!exported) {
    return;
  }

  const exportedRecord = exported as Record<string, unknown>;

  // Pattern A: Command with load()
  if (typeof exportedRecord.load === 'function') {
    const loadFn = exportedRecord.load as () => Promise<unknown>;
    const impl = await loadFn();
    const implRecord = impl as Record<string, unknown>;

    const execFn = implRecord.execute;
    if (typeof execFn === 'function') {
      return (execFn as (args: string) => Promise<CommandResult | void>)(args);
    }

    const callFn = implRecord.call;
    if (typeof callFn === 'function') {
      return (callFn as (args: string) => Promise<CommandResult | void>)(args);
    }

    return;
  }

  // Pattern B: CommandImplementation directly (execute or call)
  const execFn = exportedRecord.execute;
  if (typeof execFn === 'function') {
    return (execFn as (args: string) => Promise<CommandResult | void>)(args);
  }

  const callFn = exportedRecord.call;
  if (typeof callFn === 'function') {
    return (callFn as (args: string) => Promise<CommandResult | void>)(args);
  }
}
