import { mkdirSync, writeFileSync } from "node:fs";
import { createGenerator, type Schema } from "ts-json-schema-generator";

const schema = createGenerator({
  path: "src/types.ts",
  type: "Schedule",
  additionalProperties: false,
}).createSchema("Schedule");

const numericBounds: Record<string, [number, number]> = {
  year: [1, 9999],
  month: [1, 12],
  day: [1, 31],
  hour: [0, 24],
  minute: [0, 59],
  second: [0, 59],
  ordinal: [-5, 5],
  amount: [0, 10000],
  endAmount: [0, 10000],
  offset: [-10000, 10000],
  interval: [1, 10000],
  count: [1, 1000000],
  timesPer: [1, 24],
};

function constrain(node: Schema): void {
  if (node.type === "number") node.type = "integer";

  for (const [name, property] of Object.entries(node.properties ?? {})) {
    if (typeof property !== "object") continue;
    const bounds = numericBounds[name];
    if (bounds && (property.type === "number" || property.type === "integer")) {
      [property.minimum, property.maximum] = bounds;
    }
    if (name === "ordinal") property.not = { const: 0 };

    if (["byMonthDay", "byMonth", "bySetPos"].includes(name)) {
      const maximum =
        name === "byMonth" ? 12 : name === "byMonthDay" ? 31 : 366;
      property.items = {
        type: "integer",
        minimum: name === "byMonth" ? 1 : -maximum,
        maximum,
        not: { const: 0 },
      };
      property.minItems = 1;
      property.uniqueItems = true;
    }
    if (["byDay", "days"].includes(name) && property.type === "array") {
      property.minItems = 1;
      property.maxItems = 7;
      property.uniqueItems = true;
    }
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value)
        if (child && typeof child === "object") constrain(child);
    } else if (value && typeof value === "object") {
      constrain(value);
    }
  }
}

constrain(schema);
const definitions = schema.definitions!;
const clause = definitions.Clause;
const schedule = definitions.Schedule;
if (typeof clause === "object") {
  clause.anyOf = ["date", "time", "shift", "duration", "recurrence"].map(
    (name) => ({ properties: { [name]: {} }, required: [name] }),
  );
}
if (
  typeof schedule === "object" &&
  typeof schedule.properties?.clauses === "object"
) {
  schedule.properties.clauses.minItems = 1;
  schedule.properties.clauses.maxItems = 128;
}

const output = {
  ...schema,
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:gpu-time:schedule:1",
  $defs: definitions,
};
delete output.definitions;
const serialized = JSON.stringify(output, null, 2).replaceAll(
  "#/definitions/",
  "#/$defs/",
);
mkdirSync("schema", { recursive: true });
writeFileSync("schema/schedule.schema.json", serialized + "\n");
console.log("Generated schema/schedule.schema.json from src/types.ts");
