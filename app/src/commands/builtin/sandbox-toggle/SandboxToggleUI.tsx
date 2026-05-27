import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface SandboxToggleUIProps {
  onDone?: () => void;
  args?: string;
}

export function SandboxToggleUI({ onDone, args = '' }: SandboxToggleUIProps) {
  return (
    <CommandUI
      commandName="sandbox-toggle"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('./index.js'),
          'sandboxToggleCommand',
          args
        )
      }
    />
  );
}
