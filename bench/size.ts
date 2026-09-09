import { build } from "esbuild";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";

const entries = {
  "gpu-time": 'export * from "./dist/index.js"',
  chrono: 'export { en } from "chrono-node"',
  compromise:
    'import nlp from "compromise"; import dates from "compromise-dates"; export default nlp.extend(dates)',
  rrule: 'export { RRule } from "rrule"',
  recognizers:
    'export { recognizeDateTime } from "@microsoft/recognizers-text-date-time"',
  later: 'export { default } from "@breejs/later"',
};
const results = [];
const temporary = await mkdtemp(join(tmpdir(), "gpu-time-size-"));
try {
  for (const [library, contents] of Object.entries(entries)) {
    const output = await build({
      stdin: { contents, resolveDir: process.cwd() },
      bundle: true,
      minify: true,
      format: "esm",
      platform: "browser",
      mainFields: ["module", "main"],
      target: "es2022",
      legalComments: "none",
      write: false,
    });
    const source = output.outputFiles[0].contents;
    const path = join(temporary, `${library}.mjs`);
    await writeFile(path, source);
    const namespace = await import(pathToFileURL(path).href);
    if (!Object.values(namespace).some((value) => value !== undefined))
      throw new Error(
        `${library} has no usable exports in its measured bundle.`,
      );
    results.push({
      library,
      bytes: source.byteLength,
      gzipBytes: gzipSync(source, { level: 9 }).byteLength,
      brotliBytes: brotliCompressSync(source, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
      }).byteLength,
    });
  }
} finally {
  await rm(temporary, { recursive: true });
}
await mkdir("bench/results", { recursive: true });
await writeFile(
  "bench/results/size.json",
  JSON.stringify(
    {
      method:
        "Standalone minified browser ESM bundles, gzip level 9, Brotli quality 11. Exact import expressions included. Chrono uses its English entry; Recognizers' public entry includes its shipped language coverage.",
      imports: entries,
      versions: JSON.parse(await readFile("package-lock.json", "utf8"))
        .packages,
      results,
    },
    null,
    2,
  ) + "\n",
);
console.table(results);
