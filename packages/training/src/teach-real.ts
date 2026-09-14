// Propose with a teacher, accept with the compiler.
// --emit writes tokenized batches for a teacher subagent to label.
// --verify compiles the teacher's proposals and keeps only rows that hold up.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { compile } from "../../core/src/compile.ts";
import { LABELS, type Label } from "../../core/src/labels.ts";
import { tokenize } from "../../core/src/tokenizer.ts";
import type { Schedule, Token } from "../../core/src/types.ts";

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
  return value;
};

const labelSet = new Set<string>(LABELS);

/** Content tokens are the only ones a teacher is asked to label. */
const content = (text: string, token: Token) => /\S/.test(text.slice(token.start, token.end));

if (process.argv.includes("--emit")) {
  const source = argument("--in")!;
  const outDirectory = argument("--out")!;
  const size = Number(argument("--size") ?? 50);
  const take = Number(argument("--take") ?? 400);
  const filter = argument("--match");
  const pattern = filter ? new RegExp(filter, "i") : undefined;
  const skip = argument("--exclude");
  const excluded = skip ? new RegExp(skip, "i") : undefined;

  const rows = readFileSync(source, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { text: string; reason?: string })
    .filter((row) => (pattern ? pattern.test(row.text) : true))
    .filter((row) => !(excluded && excluded.test(row.text)))
    .slice(0, take);

  let batch = 0;
  for (let start = 0; start < rows.length; start += size) {
    const part = rows.slice(start, start + size).map((row, offset) => {
      const tokens = tokenize(row.text);
      return {
        id: `taught-${start + offset}`,
        text: row.text,
        tokens: tokens
          .map((token, index) => ({ index, text: row.text.slice(token.start, token.end) }))
          .filter((_, index) => content(row.text, tokens[index]!)),
      };
    });
    writeFileSync(
      join(outDirectory, `batch-${String(++batch).padStart(3, "0")}.json`),
      JSON.stringify(part, null, 1),
    );
  }
  console.log(JSON.stringify({ emitted: rows.length, batches: batch, size }));
}

if (process.argv.includes("--verify")) {
  const directory = argument("--in")!;
  const out = argument("--out")!;
  // A row claiming a recurrence must actually compile to one, or it is noise.
  const require = argument("--require");
  const template = argument("--template") ?? "teacher/real-recurrence";

  const tally = {
    read: 0,
    badLabel: 0,
    staleIndex: 0,
    noSchedule: 0,
    wrongShape: 0,
    mismatch: 0,
    accepted: 0,
  };
  const accepted: unknown[] = [];

  for (const name of readdirSync(directory).filter((one) => one.endsWith(".json"))) {
    const proposals = JSON.parse(readFileSync(join(directory, name), "utf8")) as {
      id: string;
      text: string;
      labels: Record<string, string>;
      schedule?: Schedule | "none";
    }[];
    for (const proposal of proposals) {
      tally.read++;
      const raw = tokenize(proposal.text);
      const entries = Object.entries(proposal.labels ?? {});
      if (entries.some(([, label]) => !labelSet.has(label))) {
        tally.badLabel++;
        continue;
      }
      if (entries.some(([index]) => !raw[Number(index)])) {
        tally.staleIndex++;
        continue;
      }
      const tokens = raw.map((token, index): Token => ({
        ...token,
        label: (proposal.labels[String(index)] ?? "O") as Label,
        clauseStart: false,
        score: 1,
      }));
      let expressions;
      try {
        expressions = compile(proposal.text, tokens);
      } catch {
        tally.noSchedule++;
        continue;
      }
      const schedules = expressions.filter((one) => one.schedule);
      // A sentence the teacher read as timeless is kept only if nothing compiles.
      if (proposal.schedule === "none") {
        if (schedules.length) {
          tally.mismatch++;
          continue;
        }
        tally.accepted++;
        accepted.push({
          id: proposal.id,
          template,
          text: proposal.text,
          spans: tokens.map(({ start, end, label }) => ({ start, end, label, clauseStart: false })),
        });
        continue;
      }
      if (schedules.length !== 1) {
        tally.noSchedule++;
        continue;
      }
      // The teacher states the schedule; the compiler decides whether to believe it.
      if (proposal.schedule && !isDeepStrictEqual(schedules[0]!.schedule, proposal.schedule)) {
        tally.mismatch++;
        continue;
      }
      const clause = (schedules[0]!.schedule as { clauses?: unknown[] })?.clauses?.[0] as
        | Record<string, unknown>
        | undefined;
      if (require && !(clause && require in clause)) {
        tally.wrongShape++;
        continue;
      }
      tally.accepted++;
      accepted.push({
        id: proposal.id,
        template,
        text: proposal.text,
        spans: tokens.map(({ start, end, label }) => ({ start, end, label, clauseStart: false })),
        schedule: schedules[0]!.schedule,
      });
    }
  }
  writeFileSync(out, accepted.map((row) => JSON.stringify(row)).join("\n") + "\n");
  console.log(JSON.stringify(tally, null, 2));
}
