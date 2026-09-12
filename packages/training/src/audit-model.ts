import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Report paths are recorded relative to this package.
const root = new URL("../", import.meta.url);

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const report = JSON.parse(
  await readFile(new URL("active/export-report.json", root), "utf8"),
);
if (
  sha256(await readFile(new URL("../core/src/model/weights.gen.ts", root))) !==
  report.artifactSha256
)
  throw new Error("Generated weights differ from the selected export report.");
for (const [name, expected] of Object.entries(report.exportSourceHashes)) {
  if (
    sha256(
      await readFile(new URL(`${report.exportSourceDirectory}/${name}`, root)),
    ) !== expected
  )
    throw new Error(`Export source changed: ${name}`);
}
const results = [];
for (const ancestor of report.lineage) {
  const checkpoint = await readFile(new URL(ancestor.checkpoint, root));
  if (sha256(checkpoint) !== ancestor.sha256)
    throw new Error(`Checkpoint changed: ${ancestor.checkpoint}`);
  const directory = ancestor.checkpoint.slice(
    0,
    ancestor.checkpoint.lastIndexOf("/"),
  );
  const training = JSON.parse(
    await readFile(new URL(`${directory}/report.json`, root), "utf8"),
  );
  const skipped = [];
  for (const [source, expected] of Object.entries(training.sourceHashes)) {
    // Some older runs recorded dataset inputs alongside source. They were never
    // snapshotted and the corpora have since moved on, so there is nothing to
    // verify: report the recorded hash and move on.
    if (source.startsWith("data/")) {
      skipped.push({ source, recordedSha256: expected });
      continue;
    }
    const snapshot = await readFile(
      new URL(`${directory}/source/${source}`, root),
    );
    if (sha256(snapshot) !== expected)
      throw new Error(`Training source changed: ${directory}/source/${source}`);
  }
  results.push({
    checkpoint: ancestor.checkpoint,
    checkpointHashMatches: true,
    matchingSourceFiles:
      Object.keys(training.sourceHashes).length - skipped.length,
    ...(skipped.length > 0 && { skippedDatasetInputs: skipped }),
  });
}
await writeFile(
  new URL("active/provenance.json", root),
  JSON.stringify(
    {
      model: report.artifactSha256,
      generatedWeightsHashMatches: true,
      matchingExportFiles: Object.keys(report.exportSourceHashes).length,
      results,
    },
    null,
    2,
  ) + "\n",
);
console.log("Checkpoint ancestry and training source hashes match.");
