import {
  isValidPhoneNumber,
  normalizePhoneNumber,
  PHONE_NUMBER_INVALID,
} from '@hansard/shared';

export interface ParsedNumber {
  raw: string;
  normalized: string;
}

/**
 * Parse and normalize a number from user input. Throws a stable error message
 * matching the shared `PHONE_NUMBER_INVALID` constant so command replies stay aligned
 * with API and service-layer responses.
 */
export function parseNumberOrThrow(input: string): ParsedNumber {
  if (!isValidPhoneNumber(input)) {
    throw new Error(PHONE_NUMBER_INVALID);
  }
  return {
    raw: input.trim(),
    normalized: normalizePhoneNumber(input),
  };
}

/** True if a number is plausibly valid (used in autocomplete and lookups). */
export function isParseableNumber(input: string): boolean {
  return isValidPhoneNumber(input);
}
