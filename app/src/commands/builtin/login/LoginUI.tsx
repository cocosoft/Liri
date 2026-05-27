import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface LoginUIProps {
  onDone?: () => void;
  args?: string;
}

export function LoginUI({ onDone, args = '' }: LoginUIProps) {
  return (
    <CommandUI
      commandName="login"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'loginCommand', args)
      }
    />
  );
}
