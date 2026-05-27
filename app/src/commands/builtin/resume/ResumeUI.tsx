import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface ResumeUIProps {
  onDone?: () => void;
  args?: string;
}

export function ResumeUI({ onDone, args = '' }: ResumeUIProps) {
  return (
    <CommandUI
      commandName="resume"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'resumeCommand', args)
      }
    />
  );
}
