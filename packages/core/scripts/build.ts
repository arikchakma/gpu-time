import { build } from "esbuild";
import { minify as minifyJavaScript } from "terser";
import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { initialize, minify } from "wgslender";
import { buildShader } from "../src/model/shader-source.ts";
import { weights as sourceWeights } from "../src/model/weights.gen.ts";
import type { EncodedWeights } from "../src/model/decode.js";
import { resolve as resolvePath, join } from "node:path";
import { createRequire } from "node:module";

const packageRoot = resolvePath(import.meta.dirname, "..");
const typescriptBin = createRequire(import.meta.url).resolve(
  "typescript/bin/tsc",
);

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`Missing value for ${name}.`);
  return value;
};
const modelPath = argument("--weights");
const outputDirectory = resolvePath(
  packageRoot,
  argument("--outdir") ?? "dist",
);
const weights: EncodedWeights = modelPath
  ? (await import(resolvePath(modelPath))).weights
  : sourceWeights;

await initialize();
const source = await readFile(
  join(packageRoot, "src/model/kernel.wgsl"),
  "utf8",
);
const variants = weights.storage === "f32" ? [false] : [false, true];
const shaders = variants.map((nativeHalf) => {
  const result = minify(buildShader(source, weights, nativeHalf), {
    keepNames: ["classify"],
    mangleExternalBindings: true,
  });
  if (result.errors.length) throw new Error(JSON.stringify(result.errors));
  return result.code;
});

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [
    join(packageRoot, "src/index.ts"),
    join(packageRoot, "src/schedule.ts"),
  ],
  outdir: outputDirectory,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  define: {
    GPU_TIME_DIAGNOSTICS: "false",
    GPU_TIME_STORAGE: JSON.stringify(weights.storage ?? "f16"),
  },
  plugins: [
    {
      name: "compiled-shader",
      setup(builder) {
        builder.onLoad({ filter: /[/\\]model[/\\]weights\.gen\.ts$/ }, () => ({
          contents: `export const weights = ${JSON.stringify({
            featureRows: weights.featureRows,
            roleClasses: weights.roleClasses,
            storage: weights.storage,
            boundaryThreshold: weights.boundaryThreshold,
            ...(weights.layers && weights.layers > 1
              ? { layers: weights.layers }
              : {}),
            ...(weights.transitions ? { transitions: true } : {}),
            q: weights.q,
            segments: weights.segments.map((segment) => ({
              name: segment.name,
              offset: segment.offset,
              length: segment.length,
              scale: segment.scale,
              ...("rowScales" in segment
                ? { rowScales: segment.rowScales }
                : {}),
            })),
          })};`,
          loader: "js",
        }));
        builder.onLoad({ filter: /[/\\]model[/\\]shader\.ts$/ }, () => ({
          contents: `export function shader(nativeHalf) { return ${shaders.length === 1 ? JSON.stringify(shaders[0]) : `nativeHalf ? ${JSON.stringify(shaders[1])} : ${JSON.stringify(shaders[0])}`}; }`,
          loader: "js",
        }));
      },
    },
  ],
});
// Aggressive variable collapsing reduced bytes but slowed CPU inference in Chrome.
for (const name of ["index", "schedule"]) {
  const path = `${outputDirectory}/${name}.js`;
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
execFileSync(
  "node",
  [
    typescriptBin,
    "-p",
    join(packageRoot, "tsconfig.build.json"),
    "--outDir",
    outputDirectory,
  ],
  {
    stdio: "inherit",
  },
);

// Only these declarations are reachable from the two public entry points.
// In particular, the package does not need a second copy of the weight string
// embedded in an internal declaration file.
const publicTypes = new Set([
  "index.d.ts",
  "schedule.d.ts",
  "resolve.d.ts",
  "types.d.ts",
  "labels.d.ts",
]);
for (const entry of await readdir(outputDirectory)) {
  if (entry.endsWith(".d.ts") && !publicTypes.has(entry))
    await rm(`${outputDirectory}/${entry}`);
}
await rm(`${outputDirectory}/model`, { recursive: true, force: true });

const files = await Promise.all(
  ["index.js", "schedule.js"].map(async (file) => {
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
