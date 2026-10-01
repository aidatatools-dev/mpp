import type { Result } from "./http.ts";

export const issueMarker = "<!-- mpp-service-health -->";
export function renderReport(
  results: Result[],
  checkedAt: string,
  runUrl: string,
): string {
  const counts = Object.fromEntries(
    (["pass", "fail", "inconclusive", "skipped"] as const).map((outcome) => [
      outcome,
      results.filter((result) => result.outcome === outcome).length,
    ]),
  );
  const lines = [
    issueMarker,
    "## Weekly service health",
    "",
    `Checked: ${checkedAt}`,
    `Run and complete JSON report: ${runUrl}`,
    "",
    `${counts.pass} passed; ${counts.fail} failed; ${counts.inconclusive} inconclusive; ${counts.skipped} skipped.`,
    "",
    "These checks do not pay or verify fulfillment. Skipped and inconclusive checks are coverage gaps, not evidence of downtime. GET/HEAD redirects follow up to three HTTPS hops. Each unique request is made once per run.",
    "",
    "Update broken catalog URLs, contact the provider for repeat failures, or add safe endpoint fixtures in schemas/services.ts. Do not remove services based only on a failed API root URL.",
    "",
    "Existing issues stay open while checks are inconclusive or skipped; automatic closure requires every check to pass.",
    "",
  ];
  // Keep well below GitHub's issue body limit; the artifact retains every result.
  const findings = results.filter((result) => result.outcome === "fail");
  if (findings.length)
    lines.push(
      "| Service | Endpoint or link | HTTP | Finding | URL |",
      "| --- | --- | --- | --- | --- |",
    );
  for (const result of findings.slice(0, 100)) {
    const cells = [
      result.service,
      result.target,
      result.status ? String(result.status) : "—",
      result.reason,
      result.url,
    ].map((value, index) =>
      value
        .replace(/[\r\n<>`]/g, "")
        .replace(/@/g, "＠")
        .replace(/\\/g, "&#92;")
        .replace(/\|/g, "&#124;")
        .slice(0, [60, 90, 10, 150, 200][index]),
    );
    lines.push(`| ${cells.join(" | ")} |`);
  }
  if (findings.length > 100)
    lines.push(
      "",
      `Showing 100 of ${findings.length} findings. See the complete JSON artifact for all services and endpoints.`,
    );
  return lines.join("\n");
}
