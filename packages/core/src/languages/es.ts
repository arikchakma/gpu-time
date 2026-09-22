import type { DateSpec, Unit, Weekday } from "../types.js";
import { weekdays } from "../lexicon.js";
import { fold, type Language } from "./language.js";
import { weights as model } from "../model/weights-es.gen.js";

const DAY_NAMES = [
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
  "domingo",
];
const DAY_ABBR = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const MONTH_ABBR = MONTH_NAMES.map((name) => name.slice(0, 3));

const UNIT_WORDS: Record<string, Unit> = {
  segundo: "second",
  segundos: "second",
  minuto: "minute",
  minutos: "minute",
  hora: "hour",
  horas: "hour",
  dia: "day",
  dias: "day",
  semana: "week",
  semanas: "week",
  mes: "month",
  meses: "month",
  ano: "year",
  anos: "year",
};

// 0-30 spell as one token; 31 ("treinta y uno") needs the tens+ones combiner.
const NUMBER_WORDS: Record<string, number> = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiuno: 21,
  veintiun: 21,
  veintiuna: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  treinta: 30,
  // Ordinals: 1st-5th match the "primer"/"tercer" apocope used before a noun.
  primero: 1,
  primer: 1,
  primera: 1,
  segundo: 2,
  tercero: 3,
  tercer: 3,
  tercera: 3,
  cuarto: 4,
  quinto: 5,
  ultimo: -1,
  ultima: -1,
};
const TENS_WORDS: Record<string, number> = { treinta: 30 };

const HOLIDAYS: Record<string, Extract<DateSpec, { kind: "holiday" }>["name"]> =
  {
    navidad: "christmas",
    nochebuena: "christmas-eve",
    anonuevo: "new-year",
    nochevieja: "new-years-eve",
    halloween: "halloween",
    sanvalentin: "valentines",
  };

function key(text: string): string {
  return fold(text.toLowerCase()).replace(/\.$/, "");
}

function weekday(text: string): Weekday | undefined {
  let word = key(text);
  if (!DAY_NAMES.includes(word) && DAY_NAMES.includes(word.replace(/s$/, "")))
    word = word.replace(/s$/, "");
  const index =
    DAY_NAMES.indexOf(word) >= 0
      ? DAY_NAMES.indexOf(word)
      : DAY_ABBR.indexOf(word);
  return index < 0 ? undefined : weekdays[index];
}

function month(text: string): number | undefined {
  const word = key(text);
  const index =
    MONTH_NAMES.indexOf(word) >= 0
      ? MONTH_NAMES.indexOf(word)
      : MONTH_ABBR.indexOf(word);
  return index < 0 ? undefined : index + 1;
}

function unit(text: string): Unit | undefined {
  const word = key(text);
  return Object.hasOwn(UNIT_WORDS, word) ? UNIT_WORDS[word] : undefined;
}

function number(text: string): number {
  const word = key(text);
  if (Object.hasOwn(NUMBER_WORDS, word)) return NUMBER_WORDS[word];
  return /^-?\d+$/.test(text) ? Number(text) : NaN;
}

function compoundOrdinal(tens: string, ones: string): number {
  const base = Object.hasOwn(TENS_WORDS, key(tens))
    ? TENS_WORDS[key(tens)]
    : undefined;
  const onesValue = number(ones);
  if (base === undefined || onesValue < 1 || onesValue > 9) return NaN;
  return base + onesValue;
}

const timeWords = new Set([
  "hoy",
  "ayer",
  "manana",
  "pasado",
  "anteayer",
  "ahora",
  "ya",
  "mediodia",
  "medianoche",
  "madrugada",
  "tarde",
  "noche",
  "cada",
  "diario",
  "semanal",
  "quincenal",
  "mensual",
  "anual",
  "proximo",
  "proxima",
  "siguiente",
  "anterior",
  "este",
  "esta",
]);

/** A cheap check for input that mentions time but compiled to no expression. */
function mentionsTime(text: string): boolean {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .some((word) => {
      if (word === "") return false;
      const folded = fold(word);
      return (
        /\d/.test(word) ||
        timeWords.has(folded) ||
        weekday(folded) !== undefined ||
        month(folded) !== undefined ||
        unit(folded) !== undefined ||
        Object.hasOwn(HOLIDAYS, folded)
      );
    });
}

const approximately = new Set(["sobre"]);

// "el/la/los/las/a/al/de/del/en/por/para/entre" are grammar words, the Spanish
// counterpart of English "the"/"at"/"on"/"of".
const filler = new Set([
  ...approximately,
  "a",
  "al",
  "el",
  "la",
  "los",
  "las",
  "de",
  "del",
  "en",
  "por",
  "para",
  "entre",
  ",",
  ";",
  "&",
  ":",
  "-",
  "–",
  "—",
  ".",
  "¿",
  "?",
]);

const dayGroup = (text: string): "weekday" | "weekend" | undefined => {
  if (text === "findesemana" || text === "finesdesemana") return "weekend";
  if (text === "dialaborable" || text === "diaslaborables") return "weekday";
};

const isSameTimeCue = (first: string, second: string) =>
  ["misma", "este", "esta"].includes(first) && second === "hora";

const spanish: Language = {
  model,
  code: "es",
  dateOrder: "DMY",

  weekday,
  month,
  unit,
  number,
  compoundOrdinal,
  mentionsTime,
  // Only the full name pluralizes; "lun" stays an abbreviation.
  isPluralWeekday: (text) =>
    DAY_NAMES.includes(key(text).replace(/s$/, "")) && /s$/i.test(text),
  // "lunes"-"viernes" are invariant nouns; only "los"/"las" marks them plural.
  pluralArticles: new Set(["los", "las"]),
  dayGroup,
  isSameTimeCue,

  filler,
  approximately,
  relativeDays: {
    hoy: 0,
    ayer: -1,
    manana: 1,
    // "mañ" is the texting abbreviation for "mañana"; folds to "man".
    man: 1,
    "pasado manana": 2,
    anteayer: -2,
    antier: -2,
  },
  dayParts: {
    manana: "morning",
    tarde: "afternoon",
    noche: "night",
    // "de la madrugada" names the small hours (12am-6am), which reads the
    // same way "morning" does: hour % 12.
    madrugada: "morning",
  },
  modifiers: {
    este: "this",
    esta: "this",
    proximo: "next",
    proxima: "next",
    "que viene": "next",
    siguiente: "next",
    pasado: "last",
    pasada: "last",
    anterior: "last",
  },
  frequencyWords: {
    diario: "daily",
    semanal: "weekly",
    quincenal: "weekly",
    mensual: "monthly",
    anual: "yearly",
  },
  frequencyIntervals: {
    quincenal: 2,
  },
  holidays: HOLIDAYS,

  now: new Set(["ahora", "ya", "ahora mismo", "justo ahora"]),
  edges: {
    principio: "start",
    principios: "start",
    inicio: "start",
    inicios: "start",
    comienzo: "start",
    comienzos: "start",
    final: "end",
    finales: "end",
    fin: "end",
    fines: "end",
  },
  endAbbreviations: new Set(),
  timeNamed: { mediodia: "noon", medianoche: "midnight" },
  meridiemPhrases: {
    delamanana: "am",
    delatarde: "pm",
    delanoche: "night",
    porlamanana: "am",
    porlatarde: "pm",
    porlanoche: "night",
    enlamanana: "am",
    enlatarde: "pm",
    enlanoche: "night",
    enpunto: "o'clock",
  },
  meridiemLead: new Set(["a"]),
  // "pico" names an unspecified few minutes past the hour, encoded as the
  // hour itself: "cuatro y pico" reads no more precisely than "four-ish".
  clockFractions: { media: 30, cuarto: 15, pico: 0 },
  clockDirections: { y: "past", menos: "to" },
  ordinalMarks: new Set(["º", "ª"]),
  deadlineWords: new Set(["hasta"]),
  tonightWords: new Set(),
  fortnightWords: new Set(["quincena", "quincenas"]),
  fromWords: new Set(["desde"]),
  lastingWords: new Set(),
  conjunctions: new Set(["y"]),
  keepGlue: new Set(["y", "menos", "a", "los", "las"]),
  articles: new Set(["un", "una"]),
  ofWords: new Set(),
  andWords: new Set(["y"]),
};

export default spanish;
