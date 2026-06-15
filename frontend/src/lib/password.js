/**
 * Password strength utilities — mirror of the backend validate_password_policy().
 * Used by ChangePasswordModal to drive the strength meter + inline validation.
 */
export const PASSWORD_POLICY = [
  { id: "len",   label: "At least 8 characters",    test: (p) => p.length >= 8 },
  { id: "upper", label: "One uppercase letter",     test: (p) => /[A-Z]/.test(p) },
  { id: "lower", label: "One lowercase letter",     test: (p) => /[a-z]/.test(p) },
  { id: "digit", label: "One number",               test: (p) => /\d/.test(p) },
  { id: "spec",  label: "One special character",    test: (p) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?`~]/.test(p) },
];

/**
 * Returns a strength score 0..4 and a label.
 *
 *   0 — Empty
 *   1 — Weak (only 1 of 5 rules)
 *   2 — Fair (2-3 rules)
 *   3 — Good (4 rules)
 *   4 — Strong (all 5 rules and length >= 12)
 */
export function scorePassword(pw) {
  if (!pw) return { score: 0, label: "Empty", color: "bg-gray-200" };
  const passed = PASSWORD_POLICY.filter((r) => r.test(pw)).length;
  if (passed <= 1) return { score: 1, label: "Weak",   color: "bg-red-500" };
  if (passed <= 3) return { score: 2, label: "Fair",   color: "bg-orange-400" };
  if (passed === 4) return { score: 3, label: "Good",  color: "bg-yellow-400" };
  // All five rules pass — boost to Strong only if length >= 12
  if (pw.length >= 12) return { score: 4, label: "Strong", color: "bg-emerald-500" };
  return { score: 3, label: "Good", color: "bg-yellow-400" };
}

export function validatePassword(pw) {
  for (const rule of PASSWORD_POLICY) if (!rule.test(pw)) return rule.label;
  return null;
}
