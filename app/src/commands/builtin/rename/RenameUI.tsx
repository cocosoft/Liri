import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface RenameUIProps {
  onDone?: () => void;
  args?: string;
}

export function RenameUI({ onDone, args = '' }: RenameUIProps) {
  return (
    <CommandUI
      commandName="rename"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'renameCommand', args)
      }
    />
  );
}
