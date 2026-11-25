/** Username rules shared with the API: stored lowercase, 3–32 characters. */
export const USERNAME_PATTERN = "[A-Za-z][A-Za-z0-9_]{2,31}";
export const USERNAME_HINT =
  "3–32 characters, starting with a letter. Letters, numbers and underscores only. Capitals are lowercased.";

export function normalizeUsername(raw: string): string {
  return (raw || "").trim().toLowerCase();
}

export const USERNAME_FIELD = {
  autoComplete: "username" as const,
  autoCapitalize: "none" as const,
  autoCorrect: "off" as const,
  spellCheck: false,
  minLength: 3,
  maxLength: 32,
  pattern: USERNAME_PATTERN,
  title: USERNAME_HINT,
  inputMode: "text" as const,
};
