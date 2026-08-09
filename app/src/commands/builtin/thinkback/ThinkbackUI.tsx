import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface ThinkbackUIProps {
  onDone?: () => void;
  args?: string;
}

export function ThinkbackUI({ onDone, args = '' }: ThinkbackUIProps) {
  return (
    <CommandUI
      commandName="thinkback"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'thinkbackCommand',
          args
        )
      }
    />
  );
}
