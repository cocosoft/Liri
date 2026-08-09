import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface FilesUIProps {
  onDone?: () => void;
  args?: string;
}

export function FilesUI({ onDone, args = '' }: FilesUIProps) {
  return (
    <CommandUI
      commandName="files"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'filesCommand',
          args
        )
      }
    />
  );
}
