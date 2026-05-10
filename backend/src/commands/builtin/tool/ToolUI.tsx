import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface ToolUIProps {
  onDone?: () => void;
  args?: string;
}

export function ToolUI({ onDone, args = '' }: ToolUIProps) {
  return (
    <CommandUI
      commandName="tool"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'toolCommand', args)
      }
    />
  );
}
