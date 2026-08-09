import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface AddDirUIProps {
  onDone?: () => void;
  args?: string;
}

export function AddDirUI({ onDone, args = '' }: AddDirUIProps) {
  return (
    <CommandUI
      commandName="add-dir"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'addDirCommand',
          args
        )
      }
    />
  );
}
