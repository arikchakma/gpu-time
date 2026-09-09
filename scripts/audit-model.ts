import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const report = JSON.parse(
  await readFile("training/export-report.json", "utf8"),
);
if (
  sha256(await readFile("src/model/weights.gen.ts")) !== report.artifactSha256
)
  throw new Error("Generated weights differ from the selected export report.");
for (const [name, expected] of Object.entries(report.exportSourceHashes)) {
  if (
    sha256(await readFile(`${report.exportSourceDirectory}/${name}`)) !==
    expected
  )
    throw new Error(`Export source changed: ${name}`);
}
const results = [];
for (const ancestor of report.lineage) {
  const checkpoint = await readFile(ancestor.checkpoint);
  if (sha256(checkpoint) !== ancestor.sha256)
    throw new Error(`Checkpoint changed: ${ancestor.checkpoint}`);
  const directory = ancestor.checkpoint.slice(
    0,
    ancestor.checkpoint.lastIndexOf("/"),
  );
  const training = JSON.parse(
    await readFile(`${directory}/report.json`, "utf8"),
  );
  for (const [source, expected] of Object.entries(training.sourceHashes)) {
    const snapshot = await readFile(`${directory}/source/${source}`);
    if (sha256(snapshot) !== expected)
      throw new Error(`Training source changed: ${directory}/source/${source}`);
  }
  results.push({
    checkpoint: ancestor.checkpoint,
    checkpointHashMatches: true,
    matchingSourceFiles: Object.keys(training.sourceHashes).length,
  });
}
await writeFile(
  "training/provenance.json",
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
