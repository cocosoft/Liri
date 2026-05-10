import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface KeyboardUIProps {
  onDone?: () => void;
  args?: string;
}

export function KeyboardUI({ onDone, args = '' }: KeyboardUIProps) {
  return (
    <CommandUI
      commandName="keyboard"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'keyboardCommand', args)
      }
    />
  );
}
