import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface CommitUIProps {
  onDone?: () => void;
  args?: string;
}

export function CommitUI({ onDone, args = '' }: CommitUIProps) {
  return (
    <CommandUI
      commandName="commit"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'commitCommand', args)
      }
    />
  );
}
