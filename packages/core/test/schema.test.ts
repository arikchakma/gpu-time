import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { expect, it } from "vitest";

const schemaPath = `${import.meta.dirname}/../schema/schedule.schema.json`;
const goldPath = (name: string) =>
  `${import.meta.dirname}/../../training/data/gold/${name}.jsonl`;

it("validates schedule structure and rejects empty clauses or invalid clock components", () => {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  const validate = new Ajv2020({ strict: true }).compile(schema);

  expect(
    validate({
      clauses: [
        {
          date: { kind: "weekday", days: ["SA", "SU"] },
          time: {
            start: { hour: 13, minute: 0 },
            end: { hour: 20, minute: 0 },
          },
        },
      ],
    }),
  ).toBe(true);
  expect(validate({ clauses: [] })).toBe(false);
  expect(validate({ clauses: [{}] })).toBe(false);
  expect(
    validate({ clauses: [{ date: { kind: "now" }, timeZone: "UTC" }] }),
  ).toBe(false);
  expect(
    validate({ clauses: [{ time: { start: { hour: 26, minute: 0 } } }] }),
  ).toBe(false);
  expect(
    validate({ clauses: [{ recurrence: { freq: "weekly", interval: 0 } }] }),
  ).toBe(false);
  expect(
    validate({
      clauses: [
        { recurrence: { freq: "monthly", interval: 1, byMonthDay: [0] } },
      ],
    }),
  ).toBe(false);
  expect(
    validate({ clauses: [{ date: { kind: "weekday", days: ["XX"] } }] }),
  ).toBe(false);
});

it("accepts every hand-authored adversarial and oracle schedule", () => {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const validate = new Ajv2020({ strict: true }).compile(schema);
  for (const file of ["adversarial", "user-cases", "labels", "chat"]) {
    const records = readFileSync(goldPath(file), "utf8").trim().split("\n");
    for (const line of records) {
      const record = JSON.parse(line);
      expect(
        validate(record.schedule),
        `${record.id}: ${JSON.stringify(validate.errors)}`,
      ).toBe(true);
    }
  }
});
