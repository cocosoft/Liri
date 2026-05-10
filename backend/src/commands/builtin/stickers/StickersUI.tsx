import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface StickersUIProps {
  onDone?: () => void;
  args?: string;
}

export function StickersUI({ onDone, args = '' }: StickersUIProps) {
  return (
    <CommandUI
      commandName="stickers"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'stickersCommand', args)
      }
    />
  );
}
