import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface SkillUIProps {
  onDone?: () => void;
  args?: string;
}

export function SkillUI({ onDone, args = '' }: SkillUIProps) {
  return (
    <CommandUI
      commandName="skill"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'skillCommand', args)
      }
    />
  );
}
