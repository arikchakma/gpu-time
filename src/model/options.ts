import { weights } from "./weights.gen.js";

// The package build replaces these constants; development retains diagnostic paths.
declare const GPU_TIME_DIAGNOSTICS: boolean;
declare const GPU_TIME_STORAGE: "f16" | "f32";
export const diagnostics =
  typeof GPU_TIME_DIAGNOSTICS === "undefined" || GPU_TIME_DIAGNOSTICS;
export const fullPrecision =
  (typeof GPU_TIME_STORAGE === "undefined"
    ? weights.storage
    : GPU_TIME_STORAGE) === "f32";
