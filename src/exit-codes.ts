/**
 * Named exit codes used by the GitNexus CLI.
 *
 * Stable across versions so scripts can rely on them.
 */
export const EXIT = {
  OK: 0,
  WARN: 1,
  ERROR: 2,
  BAD_USAGE: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
