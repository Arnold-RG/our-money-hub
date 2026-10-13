export function emailProblem(email) {
  const value = String(email || "").trim();
  if (!value) return "Add your email.";
  if (value.length > 160) return "That email is too long.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Enter a valid email.";
  return "";
}

export function passwordProblem(password, email = "") {
  const value = String(password || "");
  if (value.length < 10) return "Use at least 10 characters.";
  if (value.length > 72) return "That password is too long.";
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return "Use both letters and numbers.";
  if (email && value.toLowerCase() === String(email).trim().toLowerCase()) {
    return "Don't use your email as the password.";
  }
  return "";
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}
