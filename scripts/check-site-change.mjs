import { readFileSync, appendFileSync } from "node:fs";
const next = JSON.parse(readFileSync("_site/public-build.json", "utf8"));
const response = await fetch(
  "https://linkorasolution.com/public-build.json?head=" + next.commit,
  { signal: AbortSignal.timeout(15000) },
);
if (!response.ok && response.status !== 404)
  throw Error("Cannot verify current public build; deployment skipped.");
const current = response.ok ? await response.json() : {};
const changed = next.digest !== current.digest;
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, "changed=" + changed + "\n");
console.log(
  changed
    ? "Code or published content changed."
    : "Current public build already matches; no deployment needed.",
);
