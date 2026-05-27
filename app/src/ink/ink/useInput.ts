import { useEffect } from 'react';

export interface Key {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

export function useInput(
  inputHandler: (input: string, key: Key) => void,
  options?: { isActive?: boolean }
) {
  useEffect(() => {
    if (options?.isActive === false) return;

    const handleKeyPress = (event: KeyboardEvent) => {
      const key: Key = {
        name: event.key,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        shift: event.shiftKey,
      };
      inputHandler(event.key, key);
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [inputHandler, options?.isActive]);
}
