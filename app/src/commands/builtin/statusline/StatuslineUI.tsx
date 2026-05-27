import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface StatuslineUIProps {
  onDone?: () => void;
  args?: string;
}

export function StatuslineUI({ onDone, args = '' }: StatuslineUIProps) {
  return (
    <CommandUI
      commandName="statusline"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'statuslineCommand', args)
      }
    />
  );
}
