// Registers the WGSL raw-import hooks. Scripts that import `packages/core/src`
// directly (rather than the built package) need this; Vite and the package
// build handle `?raw` natively.
import { register } from "node:module";
register("./wgsl-loader.mjs", import.meta.url);
