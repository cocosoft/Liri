import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface RestartUIProps {
  onDone?: () => void;
  args?: string;
}

export function RestartUI({ onDone, args = '' }: RestartUIProps) {
  return (
    <CommandUI
      commandName="restart"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'restartCommand',
          args
        )
      }
    />
  );
}
