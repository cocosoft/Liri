import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface CopyUIProps {
  onDone?: () => void;
  args?: string;
}

export function CopyUI({ onDone, args = '' }: CopyUIProps) {
  return (
    <CommandUI
      commandName="copy"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'copyCommand', args)
      }
    />
  );
}
