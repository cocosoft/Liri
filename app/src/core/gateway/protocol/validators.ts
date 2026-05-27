import Ajv, { type ValidateFunction } from 'ajv';
import {
  RequestFrameSchema,
  ResponseFrameSchema,
  EventFrameSchema,
  ErrorFrameSchema,
  GatewayFrameSchema,
  InboundFrameSchema,
} from './schema/frames.js';

const ajv = new Ajv({
  strict: true,
  allErrors: true,
  verbose: false,
});

export interface ValidationResult {
  valid: boolean;
  data?: unknown;
  errors?: string[];
}

const requestValidate = ajv.compile(RequestFrameSchema);
const responseValidate = ajv.compile(ResponseFrameSchema);
const eventValidate = ajv.compile(EventFrameSchema);
const errorValidate = ajv.compile(ErrorFrameSchema);
const gatewayFrameValidate = ajv.compile(GatewayFrameSchema);
const inboundFrameValidate = ajv.compile(InboundFrameSchema);

function runValidation(
  validate: ValidateFunction,
  data: unknown
): ValidationResult {
  const valid = validate(data);
  if (valid) {
    return { valid: true, data };
  }
  return {
    valid: false,
    errors: validate.errors?.map(
      (e: { instancePath?: string; message?: string }) =>
        `${e.instancePath ?? ''} ${e.message ?? ''}`
    ),
  };
}

export function validateRequestFrame(data: unknown): ValidationResult {
  return runValidation(requestValidate, data);
}

export function validateResponseFrame(data: unknown): ValidationResult {
  return runValidation(responseValidate, data);
}

export function validateEventFrame(data: unknown): ValidationResult {
  return runValidation(eventValidate, data);
}

export function validateErrorFrame(data: unknown): ValidationResult {
  return runValidation(errorValidate, data);
}

export function validateGatewayFrame(data: unknown): ValidationResult {
  return runValidation(gatewayFrameValidate, data);
}

export function validateInboundFrame(data: unknown): ValidationResult {
  return runValidation(inboundFrameValidate, data);
}

export function getFrameType(data: unknown): string | null {
  if (
    data &&
    typeof data === 'object' &&
    'type' in data &&
    typeof data.type === 'string'
  ) {
    return data.type;
  }
  return null;
}
