import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface MemoryUIProps {
  onDone?: () => void;
  args?: string;
}

export function MemoryUI({ onDone, args = '' }: MemoryUIProps) {
  return (
    <CommandUI
      commandName="memory"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'memoryCommand',
          args
        )
      }
    />
  );
}
