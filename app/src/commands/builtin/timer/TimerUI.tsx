import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface TimerUIProps {
  onDone?: () => void;
  args?: string;
}

export function TimerUI({ onDone, args = '' }: TimerUIProps) {
  return (
    <CommandUI
      commandName="timer"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(
          import('../command-registry.js'),
          'timerCommand',
          args
        )
      }
    />
  );
}
