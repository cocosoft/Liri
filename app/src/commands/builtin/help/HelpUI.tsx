import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface HelpUIProps {
  onDone?: () => void;
  args?: string;
}

export function HelpUI({ onDone, args = '' }: HelpUIProps) {
  return (
    <CommandUI
      commandName="help"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'helpCommand', args)
      }
    />
  );
}
