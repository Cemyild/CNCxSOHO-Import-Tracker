export type Role = "admin" | "accountant" | "user";

/** True if the user's role is one of the allowed roles. */
export function roleSatisfies(
  userRole: string | undefined | null,
  allowed: readonly Role[],
): boolean {
  return !!userRole && (allowed as readonly string[]).includes(userRole);
}
