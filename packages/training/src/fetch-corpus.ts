import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

import {
  holidayNames,
  month,
  quantities,
  unit,
  weekday,
} from "../../core/src/lexicon.ts";

const execute = promisify(execFile);
const dataRoot = new URL("../data/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("corpus.json", dataRoot), "utf8"),
);
const { url, filter, selection } = manifest.prose;
const downloads = new URL("downloads/", dataRoot);
const prose = new URL("prose/", dataRoot);
const archive = new URL(url.slice(url.lastIndexOf("/") + 1), downloads);
const sentences = new URL("sentences.txt", prose);

const allowedQuantities = new Set<string>(filter.allowedQuantityWords);
const timeWords = new Set<string>([
  ...filter.additionalTimeWords,
  ...Object.keys(holidayNames),
]);

await Promise.all([
  mkdir(downloads, { recursive: true }),
  mkdir(prose, { recursive: true }),
]);

if (!(await exists(archive))) {
  console.log(`fetch ${url}`);
  await execute("curl", ["-f", "-sS", "-L", url, "-o", archive.pathname]);
}

const sha256 = await digest(archive);
if (manifest.prose.sha256 !== sha256) {
  throw new Error(
    `${archive.pathname} is sha256 ${sha256}, pinned ${manifest.prose.sha256}. Tatoeba rebuilds the export weekly; re-pin sha256 and retrievedAt in data/corpus.json to accept it.`,
  );
}

// Numbers are kept: prose containing a plain number is exactly what teaches the
// model that a digit is not automatically a time. Only time-shaped ones go.
const TIME_SHAPED = [
  /\d{1,2}\s*:\s*\d{2}/,
  /\b\d{1,2}\s*(?:am|pm|a\.m|p\.m)\b/i,
  /\b\d{1,2}\s*[\/.-]\s*\d{1,2}\b/,
  /\b(?:19|20)\d{2}/,
  /\b\d{1,3}(?:st|nd|rd|th)\b/i,
];

function timeLikeNumber(text: string): boolean {
  return TIME_SHAPED.some((pattern) => pattern.test(text));
}

const seen = new Set<string>();
const kept: string[] = [];
const dropped = { digits: 0, shape: 0, length: 0, timeWord: 0, duplicate: 0 };
let read = 0;

const decompress = spawn("bunzip2", ["-dc", archive.pathname], {
  stdio: ["ignore", "pipe", "inherit"],
});
for await (const line of createInterface({
  input: decompress.stdout,
  crlfDelay: Infinity,
})) {
  const [, language, text] = line.split("\t");
  if (language !== "eng" || !text) continue;
  read++;

  if (timeLikeNumber(text)) dropped.digits++;
  else if (!/^\p{Lu}[\p{L}\p{M}\d ,.;:'"!?()-]*[.!?]$/u.test(text))
    dropped.shape++;
  else if (!withinLength(text)) dropped.length++;
  else if (hasTimeWord(text)) dropped.timeWord++;
  else if (!seen.add(text.toLowerCase())) dropped.duplicate++;
  else kept.push(text);
}

const stride = Math.max(1, Math.floor(kept.length / selection.limit));
const selected = kept
  .filter((_, index) => index % stride === 0)
  .slice(0, selection.limit);
await writeFile(sentences, `${selected.join("\n")}\n`);

console.log(`read ${read} sentences`);
for (const [reason, count] of Object.entries(dropped))
  console.log(`  drop ${reason}: ${count}`);
console.log(
  `kept ${kept.length}, wrote ${selected.length} to ${sentences.pathname}`,
);

function withinLength(text: string) {
  const words = text.split(" ").length;
  return (
    text.length >= filter.minimumCharacters &&
    text.length <= filter.maximumCharacters &&
    words >= filter.minimumWords &&
    words <= filter.maximumWords
  );
}

function hasTimeWord(text: string) {
  for (const token of text.toLowerCase().match(/[\p{L}][\p{L}'’]*/gu) ?? []) {
    // Apostrophes stay in the token for "o'clock", which let 88 possessives
    // ("a full day's teaching", "a few minutes' walk") through unsplit.
    const normalized = token.replace(/’/g, "'");
    for (const word of [normalized, ...normalized.split("'")]) {
      if (Object.hasOwn(quantities, word) && !allowedQuantities.has(word))
        return true;
      if (timeWords.has(word) || timeWords.has(word.replace(/s$/, "")))
        return true;
      if (weekday(word) || month(word) || unit(word)) return true;
    }
  }
  return false;
}

async function exists(target: URL) {
  return stat(target).then(
    () => true,
    () => false,
  );
}

async function digest(target: URL) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(target)) hash.update(chunk);
  return hash.digest("hex");
}
