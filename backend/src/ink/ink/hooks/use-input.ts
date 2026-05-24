import { useLayoutEffect, useRef, useCallback } from 'react';
import type { InputEvent, Key } from '../events/input-event.js';
import useStdin from './use-stdin.js';

type Handler = (input: string, key: Key, event: InputEvent) => void;

type Options = {
  isActive?: boolean;
};

const useInput = (inputHandler: Handler, options: Options = {}) => {
  const handlerRef = useRef(inputHandler);
  const optionsRef = useRef(options);

  useLayoutEffect(() => {
    handlerRef.current = inputHandler;
    optionsRef.current = options;
  });

  const { setRawMode, internal_exitOnCtrlC, internal_eventEmitter } =
    useStdin();

  useLayoutEffect(() => {
    if (optionsRef.current.isActive === false) {
      return;
    }

    setRawMode(true);

    return () => {
      setRawMode(false);
    };
  }, [setRawMode]);

  useLayoutEffect(() => {
    const handleData = (event: InputEvent) => {
      if (optionsRef.current.isActive === false) {
        return;
      }
      const { input, key } = event;

      if (!(input === 'c' && key.ctrl) || !internal_exitOnCtrlC) {
        handlerRef.current(input, key, event);
      }
    };

    internal_eventEmitter?.on('input', handleData);

    return () => {
      internal_eventEmitter?.removeListener('input', handleData);
    };
  }, [internal_eventEmitter]);
};

export { useInput };
export default useInput;
