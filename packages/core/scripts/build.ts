import { minify as minifyJavaScript } from "terser";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { resolve as resolvePath } from "node:path";
import { createRequire } from "node:module";

const packageRoot = resolvePath(import.meta.dirname, "..");
const tsdownBin = resolvePath(
  createRequire(import.meta.url).resolve("tsdown/package.json"),
  "../dist/run.mjs",
);

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`Missing value for ${name}.`);
  return value;
};
const weightsArgument = argument("--weights");
const modelPath = weightsArgument && resolvePath(weightsArgument);
const outputName = argument("--outdir") ?? "dist";
const outputDirectory = resolvePath(packageRoot, outputName);

// tsdown owns bundling, declarations, and the shader and weight splicing; see
// tsdown.config.ts. Everything below is the release measurement.
execFileSync("node", [tsdownBin], {
  cwd: packageRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    GPU_TIME_OUTDIR: outputName,
    ...(modelPath ? { GPU_TIME_WEIGHTS: modelPath } : {}),
  },
});

const entries = [
  "index.js",
  "schedule.js",
  "languages/en.js",
  "languages/es.js",
];
// Aggressive variable collapsing reduced bytes but slowed CPU inference in Chrome.
for (const name of entries) {
  const path = `${outputDirectory}/${name}`;
  const result = await minifyJavaScript(await readFile(path, "utf8"), {
    module: true,
    compress: {
      passes: 3,
      ...(process.argv.includes("--min-size")
        ? {}
        : {
            sequences: false,
            collapse_vars: false,
            reduce_vars: false,
          }),
    },
    mangle: true,
    format: { comments: false },
  });
  if (!result.code) throw new Error(`No minified output for ${name}.`);
  await writeFile(path, result.code);
}

const files = await Promise.all(
  entries.map(async (file) => {
    const source = await readFile(`${outputDirectory}/${file}`);
    return {
      file,
      bytes: source.byteLength,
      gzipBytes: gzipSync(source, { level: 9 }).byteLength,
      brotliBytes: brotliCompressSync(source, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
      }).byteLength,
    };
  }),
);
const limitBytes = 50_000;
const withinBudget = files[0].brotliBytes <= limitBytes;
await writeFile(
  `${outputDirectory}/size.json`,
  JSON.stringify(
    {
      method:
        "Entire minified ESM entry point, gzip level 9 and Brotli quality 11. Each entry is standalone.",
      limitBytes,
      withinBudget,
      files,
    },
    null,
    2,
  ) + "\n",
);
console.table(files);
if (!withinBudget) {
  console.error(`Main entry exceeds the ${limitBytes}-byte Brotli budget.`);
  if (!process.argv.includes("--report-only")) process.exitCode = 1;
}
