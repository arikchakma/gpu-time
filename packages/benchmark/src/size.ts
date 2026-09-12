import { build } from "esbuild";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";

const packageRoot = join(import.meta.dirname, "..");

const shipped = join(packageRoot, "..", "core", "dist", "index.js");
const entries = {
  "gpu-time": "packages/core/dist/index.js",
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
    const source =
      library === "gpu-time"
        ? await readFile(shipped)
        : (
            await build({
              stdin: { contents, resolveDir: packageRoot },
              bundle: true,
              minify: true,
              format: "esm",
              platform: "browser",
              mainFields: ["module", "main"],
              target: "es2022",
              legalComments: "none",
              write: false,
            })
          ).outputFiles[0].contents;
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
await mkdir(join(packageRoot, "results"), { recursive: true });
await writeFile(
  join(packageRoot, "results", "size.json"),
  JSON.stringify(
    {
      method:
        "Gzip level 9, Brotli quality 11. gpu-time is measured as published, so these bytes are the same artifact the release gate scores. Every other library is a standalone minified browser ESM bundle built from the import expression recorded below. Chrono uses its English entry; Recognizers' public entry includes its shipped language coverage.",
      imports: entries,
      versions: JSON.parse(
        await readFile(join(packageRoot, "package.json"), "utf8"),
      ).dependencies,
      results,
    },
    null,
    2,
  ) + "\n",
);
console.table(results);
