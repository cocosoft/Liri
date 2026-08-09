import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface RewindUIProps {
  onDone?: () => void;
  args?: string;
}

export function RewindUI({ onDone, args = '' }: RewindUIProps) {
  return (
    <CommandUI
      commandName="rewind"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'rewindCommand',
          args
        )
      }
    />
  );
}
