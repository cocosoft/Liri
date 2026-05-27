import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface ChromeUIProps {
  onDone?: () => void;
  args?: string;
}

export function ChromeUI({ onDone, args = '' }: ChromeUIProps) {
  return (
    <CommandUI
      commandName="chrome"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'chromeCommand', args)
      }
    />
  );
}
