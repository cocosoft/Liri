import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from '@modules/ink';
import type { CommandContext, CommandResult } from '../../types/index.js';

/** 成功结果展示时长（毫秒） */
const SUCCESS_DISPLAY_MS = 2000;
/** 错误结果展示时长（毫秒）——F6 修复：错误信息至少留足阅读时间，不再 2s 一闪而过 */
const ERROR_DISPLAY_MS = 8000;

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
  const ranRef = useRef(false);

  useEffect(() => {
    // F6 修复：父组件每次渲染重建 execute 箭头函数，若以其为 effect 依赖，
    // 任何 re-render 都会重新执行命令。用 ref 守卫保证仅执行一次。
    if (ranRef.current) return;
    ranRef.current = true;
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
    const displayMs = state === 'error' ? ERROR_DISPLAY_MS : SUCCESS_DISPLAY_MS;
    const timer = setTimeout(() => onDone?.(), displayMs);
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
  args: string,
  context: CommandContext = {}
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
      return (
        execFn as (
          args: string,
          context: CommandContext
        ) => Promise<CommandResult | void>
      )(args, context);
    }

    const callFn = implRecord.call;
    if (typeof callFn === 'function') {
      return (
        callFn as (
          args: string,
          context: CommandContext
        ) => Promise<CommandResult | void>
      )(args, context);
    }

    return;
  }

  // Pattern B: CommandImplementation directly (execute or call)
  const execFn = exportedRecord.execute;
  if (typeof execFn === 'function') {
    return (
      execFn as (
        args: string,
        context: CommandContext
      ) => Promise<CommandResult | void>
    )(args, context);
  }

  const callFn = exportedRecord.call;
  if (typeof callFn === 'function') {
    return (
      callFn as (
        args: string,
        context: CommandContext
      ) => Promise<CommandResult | void>
    )(args, context);
  }
}
