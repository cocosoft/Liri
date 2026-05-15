import Ajv from 'ajv';

const ajv = new Ajv({ strict: false, allErrors: true });

export function validate(schema: any, data: unknown): boolean {
  const validateFn = ajv.compile(schema);
  return !!validateFn(data);
}
