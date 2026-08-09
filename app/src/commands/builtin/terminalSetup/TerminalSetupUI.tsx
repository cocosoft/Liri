import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface TerminalSetupUIProps {
  onDone?: () => void;
  args?: string;
}

export function TerminalSetupUI({ onDone, args = '' }: TerminalSetupUIProps) {
  return (
    <CommandUI
      commandName="terminalSetup"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'terminalSetupCommand',
          args
        )
      }
    />
  );
}
