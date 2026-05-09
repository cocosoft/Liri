//
/**
 * Ink表单组件
 * 用于构建终端表单
 */

import React, { useState } from 'react';
import Box from './Box';
import Text from './Text';
import { Input } from '../Input';
import { Select, SelectOption } from './Select';

export interface FormField {
  id: string;
  type: 'text' | 'password' | 'select' | 'number';
  label: string;
  placeholder?: string;
  options?: SelectOption[];
  required?: boolean;
  defaultValue?: string | number;
}

export interface FormProps {
  fields: FormField[];
  onSubmit?: (values: Record<string, string | number>) => void;
  onCancel?: () => void;
  submitLabel?: string;
  cancelLabel?: string;
}

export const Form: React.FC<FormProps> = ({
  fields,
  onSubmit,
  onCancel,
  submitLabel = 'Submit',
  cancelLabel = 'Cancel',
}) => {
  const [values, setValues] = useState<Record<string, string | number>>(() => {
    const initial: Record<string, string | number> = {};
    fields.forEach((field) => {
      initial[field.id] = field.defaultValue ?? '';
    });
    return initial;
  });

  const handleChange = (id: string, value: string | number) => {
    setValues((prev) => ({ ...prev, [id]: value }));
  };

  const handleSubmit = () => {
    onSubmit?.(values);
  };

  const handleKeyDown = (key: string) => {
    if (key === 'enter') {
      handleSubmit();
    } else if (key === 'escape') {
      onCancel?.();
    }
  };

  return (
    <Box flexDirection="column" gap={1} onKeyDown={handleKeyDown}>
      {fields.map((field) => (
        <Box key={field.id} flexDirection="column" gap={0.5}>
          <Text bold>
            {field.label}
            {field.required && <Text color="red">*</Text>}
          </Text>
          
          {field.type === 'text' || field.type === 'password' ? (
            <Input
              placeholder={field.placeholder}
              password={field.type === 'password'}
              value={String(values[field.id] ?? '')}
              onChange={(value) => handleChange(field.id, value)}
            />
          ) : field.type === 'select' && field.options ? (
            <Select
              options={field.options}
              defaultValue={String(values[field.id] ?? '')}
              onChange={(value) => handleChange(field.id, value)}
            />
          ) : field.type === 'number' ? (
            <Input
              placeholder={field.placeholder}
              value={String(values[field.id] ?? '')}
              onChange={(value) => handleChange(field.id, parseInt(value) || 0)}
            />
          ) : null}
        </Box>
      ))}

      <Box flexDirection="row" gap={2} justifyContent="flex-end" marginTop={2}>
        {onCancel && (
          <Box
            borderStyle="single"
            paddingX={2}
            paddingY={0.5}
            onClick={onCancel}
          >
            <Text>{cancelLabel}</Text>
          </Box>
        )}
        <Box
          borderStyle="single"
          paddingX={2}
          paddingY={0.5}
          backgroundColor="blue"
          onClick={handleSubmit}
        >
          <Text color="white">{submitLabel}</Text>
        </Box>
      </Box>
    </Box>
  );
};

/**
 * 创建表单组件
 */
export function createForm(props: FormProps): React.ReactElement {
  return <Form {...props} />;
}
