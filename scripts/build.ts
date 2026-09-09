import { build } from "esbuild";
import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { initialize, minify } from "wgslender";
import { buildShader } from "../src/model/shader-source.js";
import { weights } from "../src/model/weights.gen.js";

await initialize();
const source = await readFile("src/model/kernel.wgsl", "utf8");
const variants = weights.storage === "f32" ? [false] : [false, true];
const shaders = variants.map((nativeHalf) => {
  const result = minify(buildShader(source, weights, nativeHalf), {
    keepNames: ["classify"],
    mangleExternalBindings: true,
  });
  if (result.errors.length) throw new Error(JSON.stringify(result.errors));
  return result.code;
});

await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/index.ts", "src/schedule.ts", "src/resolve.ts"],
  outdir: "dist",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  plugins: [
    {
      name: "compiled-shader",
      setup(builder) {
        builder.onLoad({ filter: /[/\\]model[/\\]shader\.ts$/ }, () => ({
          contents: `export function shader(nativeHalf) { return ${shaders.length === 1 ? JSON.stringify(shaders[0]) : `nativeHalf ? ${JSON.stringify(shaders[1])} : ${JSON.stringify(shaders[0])}`}; }`,
          loader: "js",
        }));
      },
    },
  ],
});
execFileSync(
  "node",
  ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"],
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
for (const entry of await readdir("dist")) {
  if (entry.endsWith(".d.ts") && !publicTypes.has(entry))
    await rm(`dist/${entry}`);
}
await rm("dist/model", { recursive: true, force: true });

const files = await Promise.all(
  ["index.js", "resolve.js"].map(async (file) => {
    const source = await readFile(`dist/${file}`);
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
const limitBytes = 30_000;
const withinBudget = files[0].brotliBytes <= limitBytes;
await writeFile(
  "dist/size.json",
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
