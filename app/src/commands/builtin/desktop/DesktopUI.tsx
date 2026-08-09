import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface DesktopUIProps {
  onDone?: () => void;
  args?: string;
}

export function DesktopUI({ onDone, args = '' }: DesktopUIProps) {
  return (
    <CommandUI
      commandName="desktop"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'desktopCommand',
          args
        )
      }
    />
  );
}
