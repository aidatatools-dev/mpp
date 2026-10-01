import type { ServiceDef } from "../../schemas/services.ts";
import {
  createProbeRunner,
  type ProbeRunner,
  type RequestOptions,
  type Result,
} from "./http.ts";

export type HealthCheck = (
  service: ServiceDef,
  context: { probe: ProbeRunner },
) => Promise<Result[]>;

/** Map services through an explicit pipeline, then flatten their findings. */
export async function checkServices(
  services: ServiceDef[],
  checks: readonly HealthCheck[],
  options: RequestOptions & { concurrency?: number } = {},
): Promise<Result[]> {
  const concurrency = options.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error("Concurrency must be a positive integer");
  const queue = [...services];
  const results: Result[] = [];
  const context: { probe: ProbeRunner } = {
    probe: createProbeRunner(options),
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, services.length) }, async () => {
      for (let service = queue.shift(); service; service = queue.shift()) {
        for (const check of checks)
          results.push(...(await check(service, context)));
      }
    }),
  );
  return results.sort((a, b) =>
    `${a.service} ${a.target} ${a.url}`.localeCompare(
      `${b.service} ${b.target} ${b.url}`,
    ),
  );
}
