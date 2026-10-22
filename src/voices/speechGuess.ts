// Ce que l'enfant a voulu répondre, d'après le texte reconnu : un nombre, « passe » ou « réponse »

export type SpeechGuess = { kind: "number"; value: number } | { kind: "pass" } | { kind: "answer" };

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9,
  dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
  vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60,
  // Belgique et Suisse
  septante: 70, huitante: 80, octante: 80, nonante: 90,
  cent: 100, cents: 100
};

// Mots entendus à la place d'un nombre dit seul : « dis » pour dix, « sans » pour cent…
const LONE_HOMOPHONES: Record<string, number> = {
  dis: 10, dit: 10, si: 6, scie: 6, cette: 7, set: 7, sete: 7, oui: 8, wi: 8, sans: 100, sang: 100, cens: 100,
  saint: 5, sein: 5, vin: 20, vain: 20, de: 2, neuve: 9
};

// Mots qui annoncent la question répétée : « sept fois huit » n'est pas une réponse
const TIMES_WORDS = new Set(["fois", "x", "multiplie"]);
const PASS_WORDS = new Set(["passe", "passer", "pass", "passes", "suivant", "suivante"]);
const ANSWER_WORDS = new Set(["reponse", "reponses", "aide"]);
const DONT_KNOW = /\b(?:je )?(?:ne )?(?:sais|sait|sai|chais|chai) pas\b|\baucune idee\b/;

export function normalizeSpeech(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/×/g, " x ")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface Spoken {
  value: number;
  // Nombre de la question répétée, pas de la réponse
  isOperand: boolean;
  // « vingt » suivi d'un mot que la reconnaissance n'a pas compris : vingt-quelque chose, pas vingt
  isIncomplete: boolean;
}

// Mot que Vosk entend sans le trouver dans la liste qu'on lui donne
const UNKNOWN_WORD = "unk";

// Nombres dits, dans l'ordre : « cinquante six » donne 56, « vingt et un » 21, « quatre vingt dix neuf » 99
export function spokenNumbers(tokens: string[]): Spoken[] {
  const numbers: Spoken[] = [];
  let current: { value: number; lastWord: number; isOperand: boolean; isIncomplete: boolean } | null = null;
  let nextIsOperand = false;

  const flush = () => {
    if (current) numbers.push({ value: current.value, isOperand: current.isOperand, isIncomplete: current.isIncomplete });
    current = null;
  };
  const begin = (value: number) => {
    flush();
    current = { value, lastWord: value, isOperand: nextIsOperand, isIncomplete: false };
    nextIsOperand = false;
  };
  // Un mot peut-il prolonger le nombre en cours ?
  const extends_ = (lastWord: number, word: number) => {
    if (lastWord === 100) return word < 100;
    if (lastWord === 60 || lastWord === 80) return word >= 1 && word <= 19;
    if (lastWord >= 20) return word >= 1 && word <= 9;
    if (lastWord === 10) return word >= 7 && word <= 9;
    return false;
  };

  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      begin(Number(token));
      flush();
      continue;
    }
    if (TIMES_WORDS.has(token)) {
      flush();
      const previous = numbers[numbers.length - 1];
      if (previous) previous.isOperand = true;
      nextIsOperand = true;
      continue;
    }
    const word = NUMBER_WORDS[token];
    const open = current as { value: number; lastWord: number; isOperand: boolean; isIncomplete: boolean } | null;
    if (token === "et" && open && open.lastWord >= 20 && open.lastWord < 100) continue;
    if (token === UNKNOWN_WORD && open && open.lastWord >= 20 && open.lastWord < 100) {
      open.isIncomplete = true;
      flush();
      continue;
    }
    if (word === undefined) {
      flush();
      continue;
    }

    if (open && word === 100 && open.value < 10) {
      open.value *= 100;
      open.lastWord = 100;
    } else if (open && word === 20 && open.lastWord === 4) {
      // « quatre vingt » : quatre-vingts
      open.value += 76;
      open.lastWord = 80;
    } else if (open && extends_(open.lastWord, word)) {
      open.value += word;
      open.lastWord = word;
    } else {
      begin(word);
    }
  }
  flush();
  return numbers;
}

// Heuristiques : des suppositions sur ce que l'enfant a voulu dire. Toujours appliquées ;
// chacune est signalée quand elle décide du résultat, pour que l'essai de l'espace parent la montre
export type SpeechRule = "alternatives" | "skipQuestion" | "lastNumber" | "numberOverCommand" | "loneHomophones";

export interface Interpretation {
  guess: SpeechGuess | null;
  // Heuristiques qui ont décidé du résultat
  rulesUsed: SpeechRule[];
}

function commandOf(normalized: string, tokens: string[]): SpeechGuess | null {
  if (DONT_KNOW.test(normalized) || tokens.some((t) => ANSWER_WORDS.has(t))) return { kind: "answer" };
  if (tokens.some((t) => PASS_WORDS.has(t))) return { kind: "pass" };
  return null;
}

export function interpretSpeech(text: string): Interpretation {
  const rulesUsed: SpeechRule[] = [];
  const normalized = normalizeSpeech(text);
  if (!normalized) return { guess: null, rulesUsed };
  const tokens = normalized.split(" ");

  const spoken = spokenNumbers(tokens);
  const numbers = spoken.filter((n) => !n.isOperand);
  if (numbers.length < spoken.length) rulesUsed.push("skipQuestion");

  let value: number | null = null;
  if (numbers.length > 0) {
    const last = numbers[numbers.length - 1];
    // Un nombre dont la fin n'a pas été comprise : mieux vaut faire répéter que deviner
    if (last.isIncomplete) return { guess: null, rulesUsed };
    value = last.value;
    if (numbers.length > 1) rulesUsed.push("lastNumber");
  } else if (tokens.length === 1 && LONE_HOMOPHONES[tokens[0]] !== undefined) {
    value = LONE_HOMOPHONES[tokens[0]];
    rulesUsed.push("loneHomophones");
  }

  const command = commandOf(normalized, tokens);
  if (value === null) return { guess: command, rulesUsed };
  if (command) rulesUsed.push("numberOverCommand");
  return { guess: { kind: "number", value }, rulesUsed };
}

export function guessSpeech(text: string): SpeechGuess | null {
  return interpretSpeech(text).guess;
}

export interface AlternativesInterpretation extends Interpretation {
  // Phrase retenue parmi celles proposées par la reconnaissance
  transcript: string;
}

// La reconnaissance propose plusieurs phrases, de la plus probable à la moins probable :
// si la première ne veut rien dire, la suivante qui contient un nombre ou une commande
export function interpretAlternatives(alternatives: string[]): AlternativesInterpretation {
  const first = { ...interpretSpeech(alternatives[0] ?? ""), transcript: alternatives[0] ?? "" };
  if (first.guess) return first;
  for (const transcript of alternatives.slice(1)) {
    const other = interpretSpeech(transcript);
    if (other.guess) return { guess: other.guess, transcript, rulesUsed: ["alternatives", ...other.rulesUsed] };
  }
  return first;
}

// Liste donnée à Vosk : il ne répond qu'avec ces mots, et « [unk] » pour tout le reste.
// Tous les nombres de 0 à 100, pas seulement la bonne réponse : sinon une mauvaise réponse proche
// (« trente-cinq » pour 36) serait recollée sur la bonne et comptée juste
const UNITS = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"];
const TENS: Record<number, string> = { 2: "vingt", 3: "trente", 4: "quarante", 5: "cinquante", 6: "soixante" };

// Écriture en mots du vocabulaire du modèle : « cinquante six », « soixante et onze », « quatre-vingt-dix »
export function spellNumber(n: number): string {
  if (n < 20) return UNITS[n];
  if (n === 100) return "cent";
  if (n < 70) {
    const tens = Math.floor(n / 10);
    const unit = n % 10;
    if (unit === 0) return TENS[tens];
    if (unit === 1) return tens === 2 ? "vingt-et-un" : `${TENS[tens]} et un`;
    return `${TENS[tens]} ${UNITS[unit]}`;
  }
  if (n < 80) return n === 71 ? "soixante et onze" : `soixante ${UNITS[n - 60]}`;
  if (n === 80) return "quatre-vingts";
  if (n === 90) return "quatre-vingt-dix";
  return `quatre-vingt ${UNITS[n - 80]}`;
}

export const SPEECH_COMMANDS = ["passe", "je passe", "suivant", "réponse", "la réponse", "je ne sais pas", "je sais pas"];

// Le modèle connaît aussi la plupart des nombres en un seul mot (« quatre-vingt-un ») : les proposer aide,
// 81 n'était compris qu'ainsi lors de l'essai sur les voix de l'application
const NUMBERS = Array.from({ length: 101 }, (_, n) => spellNumber(n));
const HYPHENATED = NUMBERS.map((spelled) => spelled.replace(/ /g, "-")).filter((spelled) => !NUMBERS.includes(spelled));

// « fois » et « égal » : l'enfant qui répète la question (« sept fois huit égal cinquante-six ») est compris
const REPEATED_QUESTION_WORDS = ["fois", "égal"];

export const ANSWER_GRAMMAR: string[] = [...NUMBERS, ...HYPHENATED, ...SPEECH_COMMANDS, ...REPEATED_QUESTION_WORDS, "[unk]"];

export function guessLabel(guess: SpeechGuess): string {
  if (guess.kind === "number") return String(guess.value);
  return guess.kind === "pass" ? "PASSE" : "RÉPONSE";
}
