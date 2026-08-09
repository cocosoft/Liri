import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface TagUIProps {
  onDone?: () => void;
  args?: string;
}

export function TagUI({ onDone, args = '' }: TagUIProps) {
  return (
    <CommandUI
      commandName="tag"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'tagCommand',
          args
        )
      }
    />
  );
}
