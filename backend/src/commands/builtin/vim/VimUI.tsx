import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface VimUIProps {
  onDone?: () => void;
  args?: string;
}

export function VimUI({ onDone, args = '' }: VimUIProps) {
  return (
    <CommandUI
      commandName="vim"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'vimCommand', args)
      }
    />
  );
}
