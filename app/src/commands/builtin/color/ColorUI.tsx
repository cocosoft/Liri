import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface ColorUIProps {
  onDone?: () => void;
  args?: string;
}

export function ColorUI({ onDone, args = '' }: ColorUIProps) {
  return (
    <CommandUI
      commandName="color"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'colorCommand', args)
      }
    />
  );
}
