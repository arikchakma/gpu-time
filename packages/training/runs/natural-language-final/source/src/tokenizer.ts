import type { RawToken } from "./types.js";

const tokenPattern = /[\p{L}_]+(?:['’][\p{L}]+)*|\d+|\s+|[^\s]/gu;
const punctuationPattern = /^[^\p{L}\d\s]$/u;
const punctuationCharacters = ":-/.,(');&+@!?_=<>[]{}\\\"%#*~`";
const punctuationClasses = [
  ":",
  "-",
  "/",
  ".",
  ",",
  "(",
  "'",
  ";",
  "&",
  "+",
  "@",
];
const lengthBuckets = [1, 2, 3, 4, 6, 8, 12, Infinity];
const numberBuckets = [
  0,
  1,
  2,
  9,
  12,
  23,
  24,
  31,
  59,
  99,
  999,
  1899,
  2099,
  Infinity,
];

function hash(text: string): number {
  let value = 2166136261;

  for (let index = 0; index < text.length; index++) {
    value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  }

  return value >>> 0;
}

function characterClass(character: string): number {
  const code = character.toLowerCase().charCodeAt(0);

  if (code >= 97 && code <= 122) return code - 97;
  if (code >= 48 && code <= 57) return code - 48 + 26;

  const punctuation = Math.max(0, punctuationCharacters.indexOf(character));
  return 36 + (punctuation % 28);
}

function punctuationClass(text: string | undefined): number {
  if (!text || !punctuationPattern.test(text)) return 0;

  const normalized = text.replace(/[–—]/, "-");
  const index = punctuationClasses.indexOf(normalized);
  return index < 0 ? 12 : index + 1;
}

function tokenKind(text: string): RawToken["kind"] {
  if (/^\s/.test(text)) return 3;
  if (/^\d/.test(text)) return 1;
  if (/^[\p{L}_]/u.test(text)) return 0;
  return 2;
}

function numberBucket(text: string, kind: RawToken["kind"]): number {
  if (kind !== 1) return 15;
  if (text.length > 1 && text.startsWith("0")) return 14;

  const value = Number(text);
  return numberBuckets.findIndex((upperBound) => value <= upperBound);
}

interface TokenShape {
  kind: RawToken["kind"];
  identity: number;
  hash: number;
  flags: number;
  punctuation: number;
  ordinal: boolean;
}

const shapes = new Map<string, TokenShape>();

function shape(word: string): TokenShape {
  const cached = shapes.get(word);
  if (cached) return cached;
  const folded = word.toLowerCase();
  const kind = tokenKind(word);
  const lengthBucket = lengthBuckets.findIndex(
    (upperBound) => word.length <= upperBound,
  );
  const hasUppercase = /[A-Z]/.test(word);
  const result: TokenShape = {
    kind,
    identity:
      (kind |
        (lengthBucket << 2) |
        (characterClass(word[0]) << 5) |
        (characterClass(word.at(-1)!) << 11) |
        ((hash(folded) & 255) << 17) |
        (numberBucket(word, kind) << 25)) >>>
      0,
    hash: hash(folded.replace(/[aeiou]/g, "")) & 127,
    flags:
      Number(hasUppercase) |
      (Number(hasUppercase && word === word.toUpperCase()) << 1) |
      (Number(/\d/.test(word)) << 2),
    punctuation: punctuationClass(word),
    ordinal: /^(st|nd|rd|th)$/.test(folded),
  };
  // Bound both the entry count and retained word length. Context and predictions
  // are never cached: the same word can mean something different elsewhere.
  if (word.length <= 64) {
    if (shapes.size >= 2048) shapes.delete(shapes.keys().next().value!);
    shapes.set(word, result);
  }
  return result;
}

export function tokenize(text: string): RawToken[] {
  const parts = [...text.matchAll(tokenPattern)];
  const facts = parts.map((part) => shape(part[0]));
  return parts.map((match, index) => {
    const current = facts[index];
    const previous = facts[index - 1];
    const next = facts[index + 1];
    let flags = current.flags;
    if (index === 0) flags |= 1 << 3;
    if (index === parts.length - 1) flags |= 1 << 4;
    if (previous?.kind === 3) flags |= 1 << 5;
    if (next?.kind === 3) flags |= 1 << 6;
    if (current.ordinal && previous?.kind === 1) flags |= 1 << 7;
    const context =
      (current.hash |
        (flags << 7) |
        ((previous?.punctuation ?? 0) << 15) |
        ((next?.punctuation ?? 0) << 19)) >>>
      0;
    return {
      start: match.index!,
      end: match.index! + match[0].length,
      text: match[0],
      kind: current.kind,
      features: [current.identity, context],
    };
  });
}

export function featureRows([identity, context]: [number, number]): number[] {
  // Each feature owns a disjoint region of the 580-row embedding table.
  const rows = [
    identity & 3, // Kind
    4 + ((identity >>> 2) & 7), // Length
    12 + ((identity >>> 5) & 63), // First character
    76 + ((identity >>> 11) & 63), // Last character
    140 + ((identity >>> 17) & 255), // Word hash
    396 + (context & 127), // Consonant hash
    532 + ((context >>> 15) & 15), // Previous punctuation
    548 + ((context >>> 19) & 15), // Next punctuation
    564 + ((identity >>> 25) & 15), // Number bucket
  ];

  const flags = (context >>> 7) & 255;
  for (let bit = 0; bit < 8; bit++) {
    if (flags & (1 << bit)) rows.push(524 + bit);
  }

  return rows;
}
