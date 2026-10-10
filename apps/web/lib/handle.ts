// Handle rules match the opaq_registry program: 3-32 chars of a-z0-9_.
export const HANDLE_PATTERN = /^[a-z0-9_]{3,32}$/;

export function validateHandle(value: string): string | null {
  return HANDLE_PATTERN.test(value)
    ? null
    : "Use 3 to 32 characters: a to z, 0 to 9 and underscore.";
}
