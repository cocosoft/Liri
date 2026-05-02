/**
 * useInput Hook
 * 用于处理输入
 */

import { useState, useCallback, useEffect } from 'react';

export interface UseInputOptions {
  initialValue?: string;
  placeholder?: string;
  mask?: (value: string) => string;
  validate?: (value: string) => boolean;
}

export interface UseInputReturn {
  value: string;
  setValue: (value: string) => void;
  handleInput: (input: string) => void;
  reset: () => void;
}

export const useInput = ({
  initialValue = '',
  placeholder = '',
  mask,
  validate,
}: UseInputOptions = {}): UseInputReturn => {
  const [value, setValue] = useState(initialValue);

  const handleInput = useCallback((input: string) => {
    let newValue = input;

    if (mask) {
      newValue = mask(input);
    }

    if (validate && !validate(newValue)) {
      return;
    }

    setValue(newValue);
  }, [mask, validate]);

  const reset = useCallback(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    if (!value && placeholder) {
      setValue(placeholder);
    }
  }, [value, placeholder]);

  return {
    value,
    setValue,
    handleInput,
    reset,
  };
};