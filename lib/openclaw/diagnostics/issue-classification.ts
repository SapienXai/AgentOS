const workspaceContextIssuePrefix = "workspaceContext:";

export function isTransientOpenClawRefreshIssue(issue: string) {
  return (
    issue.includes("Reusing the last successful payload while a slow OpenClaw command refreshes in the background.") ||
    issue.includes("Reusing the last successful gateway status after a transient OpenClaw check failure.")
  );
}

export function countHealthAffectingOpenClawIssues(
  issues: string[],
  workspaceContextHasActiveIssues: boolean
) {
  return issues.filter((issue) => {
    if (isTransientOpenClawRefreshIssue(issue)) {
      return false;
    }

    return workspaceContextHasActiveIssues || !issue.startsWith(workspaceContextIssuePrefix);
  }).length;
}
