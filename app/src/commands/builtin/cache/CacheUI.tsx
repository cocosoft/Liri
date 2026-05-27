import React from 'react';
import { CommandUI, resolveCommandExecutor } from '../shared/CommandUI.js';

interface CacheUIProps {
  onDone?: () => void;
  args?: string;
}

export function CacheUI({ onDone, args = '' }: CacheUIProps) {
  return (
    <CommandUI
      commandName="cache"
      args={args}
      onDone={onDone}
      execute={() =>
        resolveCommandExecutor(import('./index.js'), 'cacheCommand', args)
      }
    />
  );
}
