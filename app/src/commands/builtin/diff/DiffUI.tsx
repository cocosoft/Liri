import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface DiffUIProps {
  onDone?: () => void;
  args?: string;
}

export function DiffUI({ onDone, args = '' }: DiffUIProps) {
  return (
    <CommandUI
      commandName="diff"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'diffCommand', args)
      }
    />
  );
}
