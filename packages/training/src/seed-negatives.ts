import { writeFileSync } from "node:fs";

const gold = new URL("../data/gold/", import.meta.url);

// Deliberately non-temporal sentences, including words that can be time words
// in other contexts. These are authored development checks, not training data.
const texts = [
  "May I have your second opinion?",
  "Could you send the second draft to May?",
  "May wrote the introduction to the book.",
  "We may publish another edition.",
  "The soldiers march through the square.",
  "Please march in a straight line.",
  "Our second attempt succeeded.",
  "The first prize went to Alex.",
  "This is the last item in the list.",
  "The next step is to open the file.",
  "The previous version had a different title.",
  "At the beginning of the book, the narrator speaks.",
  "The end of the story surprised everyone.",
  "Start the program and open the menu.",
  "The table contains 12 columns and 31 rows.",
  "Build 2026 failed with 3 warnings.",
  "Please choose option 2 from section 3.",
  "The report has 90 pages.",
  "Call 5 people about the document.",
  "Room 10 contains 8 chairs.",
  "Send the file to Jordan.",
  "Please close the window.",
  "This change looks correct.",
  "From Alice to Bob, the message says hello.",
  "Between the two choices, I prefer the first.",
  "Every example in the list contains a number.",
  "Each paragraph needs a title.",
  "The second column is empty.",
  "A month is a unit in this glossary.",
  "The field named year contains a string.",
  "The timestamp column is empty.",
  "The word midnight appears in the glossary.",
];
writeFileSync(
  new URL("negatives.jsonl", gold),
  texts
    .map((text, index) =>
      JSON.stringify({
        id: `negative-${String(index + 1).padStart(3, "0")}`,
        family: "non-temporal",
        text,
        schedule: null,
      }),
    )
    .join("\n") + "\n",
);
console.log(`Authored ${texts.length} negative controls.`);
