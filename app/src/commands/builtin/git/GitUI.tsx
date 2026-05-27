import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface GitUIProps {
  onDone?: () => void;
  args?: string;
}

export function GitUI({ onDone, args = '' }: GitUIProps) {
  return (
    <CommandUI
      commandName="git"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'gitCommand', args)
      }
    />
  );
}
