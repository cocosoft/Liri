import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface ThemeUIProps {
  onDone?: () => void;
  args?: string;
}

export function ThemeUI({ onDone, args = '' }: ThemeUIProps) {
  return (
    <CommandUI
      commandName="theme"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'themeCommand', args)
      }
    />
  );
}
