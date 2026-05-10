import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface BranchUIProps {
  onDone?: () => void;
  args?: string;
}

export function BranchUI({ onDone, args = '' }: BranchUIProps) {
  return (
    <CommandUI
      commandName="branch"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'branchCommand', args)
      }
    />
  );
}
