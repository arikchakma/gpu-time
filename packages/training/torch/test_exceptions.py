import json
import random
import subprocess
import unittest
from pathlib import Path

from generate import Sentence
from natural import RESERVED, render


class ExceptionTests(unittest.TestCase):
    def test_exclusion_targets_roundtrip_with_independent_labels(self):
        cases = []
        targets = set()
        clocks = set()
        for seed in range(600):
            sentence = Sentence(random.Random(seed), augment=False)
            spec = render(sentence, family="monthly-exception", bare=seed % 2 == 0)
            clause = spec.schedule["clauses"][0]
            excluded = clause["recurrence"]["except"][0]
            targets.add((excluded["kind"], tuple(sorted(excluded))))
            clocks.add("time" in clause)
            self.assertTrue(
                any(span["label"] == "EXCEPT" for span in sentence.spans)
            )
            self.assertFalse(
                any(phrase in sentence.text.lower() for phrase in RESERVED)
            )
            cases.append(
                {
                    "seed": seed,
                    "text": sentence.text,
                    "spans": sentence.spans,
                    "schedule": spec.schedule,
                }
            )
        self.assertEqual(clocks, {False, True})
        self.assertEqual(
            targets,
            {
                ("ordinalWeekday", ("day", "kind", "of", "ordinal", "recurring")),
                ("holiday", ("kind", "name")),
                ("calendar", ("day", "kind")),
                ("calendar", ("kind", "month")),
                ("calendar", ("day", "kind", "month")),
                ("calendar", ("day", "kind", "month", "year")),
            },
        )
        result = subprocess.run(
            [
                "npx", "tsx", "--eval", """
                import { readFileSync } from "node:fs";
                import { isDeepStrictEqual } from "node:util";
                import { tokenize } from "./packages/core/src/tokenizer.ts";
                import { compile } from "./packages/core/src/compile.ts";
                const cases = JSON.parse(readFileSync(0, "utf8"));
                const failures = [];
                for (const example of cases) {
                    const tokens = tokenize(example.text).map(token => {
                        const span = example.spans.find(span =>
                            token.start >= span.start && token.end <= span.end);
                        if (token.kind !== 3 && !span)
                            throw new Error(`Unaligned supervision: ${example.seed}`);
                        return {...token, label: span?.label ?? "O", score: 1,
                            clauseStart: Boolean(span?.clauseStart && token.start === span.start)};
                    });
                    const actual = compile(example.text, tokens);
                    if (actual.length !== 1 || !isDeepStrictEqual(actual[0].schedule, example.schedule))
                        failures.push({seed: example.seed, text: example.text,
                            expected: example.schedule, actual});
                }
                process.stdout.write(JSON.stringify(failures));
                """,
            ],
            cwd=Path(__file__).resolve().parents[3],
            input=json.dumps(cases),
            text=True,
            capture_output=True,
            check=True,
        )
        failures = json.loads(result.stdout)
        self.assertEqual(failures, [], json.dumps(failures[:5], indent=2))


if __name__ == "__main__":
    unittest.main()
