import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface McpUIProps {
  onDone?: () => void;
  args?: string;
}

export function McpUI({ onDone, args = '' }: McpUIProps) {
  return (
    <CommandUI
      commandName="mcp"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'mcpCommand',
          args
        )
      }
    />
  );
}
