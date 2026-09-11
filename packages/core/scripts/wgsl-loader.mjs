// `../src/model/shader.ts` imports its kernel as `./kernel.wgsl?raw`.
// Vite and the package build understand that suffix; plain Node does not, and the
// exporter loads core from source rather than from `dist`. These hooks teach the
// loader to read the file as a string module.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const RAW = /\.wgsl\?raw$/;

export function resolve(specifier, context, next) {
  if (RAW.test(specifier)) {
    return {
      url: new URL(specifier, context.parentURL).href,
      shortCircuit: true,
    };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (RAW.test(url)) {
    const source = await readFile(
      fileURLToPath(url.replace("?raw", "")),
      "utf8",
    );
    return {
      format: "module",
      shortCircuit: true,
      source: `export default ${JSON.stringify(source)};`,
    };
  }
  return next(url, context);
}
