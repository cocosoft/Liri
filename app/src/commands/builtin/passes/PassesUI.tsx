import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface PassesUIProps {
  onDone?: () => void;
  args?: string;
}

export function PassesUI({ onDone, args = '' }: PassesUIProps) {
  return (
    <CommandUI
      commandName="passes"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'passesCommand', args)
      }
    />
  );
}
