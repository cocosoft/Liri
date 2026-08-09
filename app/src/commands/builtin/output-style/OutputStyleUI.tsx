import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface OutputStyleUIProps {
  onDone?: () => void;
  args?: string;
}

export function OutputStyleUI({ onDone, args = '' }: OutputStyleUIProps) {
  return (
    <CommandUI
      commandName="output-style"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'outputStyleCommand',
          args
        )
      }
    />
  );
}
