import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface DebugUIProps {
  onDone?: () => void;
  args?: string;
}

export function DebugUI({ onDone, args = '' }: DebugUIProps) {
  return (
    <CommandUI
      commandName="debug"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'debugCommand',
          args
        )
      }
    />
  );
}
