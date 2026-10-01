import type { Result } from "./http.ts";
import { issueMarker } from "./report.ts";

export interface Issue {
  number: number;
  body: string;
  state: string;
  user: { login: string };
  pull_request?: unknown;
}
export interface IssueClient {
  list(): Promise<Issue[]>;
  create(body: string): Promise<void>;
  update(number: number, body: string, state: "open" | "closed"): Promise<void>;
}

/** Only maintain bot-owned issues carrying our stable marker. */
export async function syncIssue(
  client: IssueClient,
  results: Result[],
  body: string,
): Promise<void> {
  const existing = (await client.list()).find(
    (issue) =>
      !issue.pull_request &&
      issue.user.login === "github-actions[bot]" &&
      issue.body?.startsWith(issueMarker),
  );
  const actionable = results.some((result) => result.outcome === "fail");
  const complete =
    results.length > 0 && results.every((result) => result.outcome === "pass");
  if (existing)
    await client.update(
      existing.number,
      body,
      actionable || (!complete && existing.state === "open")
        ? "open"
        : "closed",
    );
  else if (actionable) await client.create(body);
}
