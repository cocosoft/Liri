import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface KeybindingsUIProps {
  onDone?: () => void;
  args?: string;
}

export function KeybindingsUI({ onDone, args = '' }: KeybindingsUIProps) {
  return (
    <CommandUI
      commandName="keybindings"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'keybindingsCommand', args)
      }
    />
  );
}
