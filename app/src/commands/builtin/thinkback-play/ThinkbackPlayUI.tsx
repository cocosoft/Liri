import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface ThinkbackPlayUIProps {
  onDone?: () => void;
  args?: string;
}

export function ThinkbackPlayUI({ onDone, args = '' }: ThinkbackPlayUIProps) {
  return (
    <CommandUI
      commandName="thinkback-play"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'thinkbackPlayCommand',
          args
        )
      }
    />
  );
}
