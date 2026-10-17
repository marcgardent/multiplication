// Programme d'écoute : des voix et des silences assemblés en un seul son continu de plusieurs minutes.
// Le téléphone le lit comme une musique : la lecture ne dépend d'aucune minuterie et continue écran éteint.

export interface Calculation {
  a: number;
  b: number;
  result: number;
}

// Position d'un calcul dans le programme, en secondes
export interface ProgramCue extends Calculation {
  startS: number;
  answerS: number;
  endS: number;
}

export interface AudioProgram {
  wav: ArrayBuffer;
  durationS: number;
  cues: ProgramCue[];
  // Début et fin du temps de brossage, absents en mode radio
  brushing: { startS: number; endS: number } | null;
}

export interface BrushingPhrases {
  intro: string;
  cheer: string;
  outro: string;
}

// Renvoie les échantillons d'une voix déjà décodée
export type ClipSource = (file: string) => Float32Array;

// Mêmes pauses que l'atelier d'écoute de la révision guidée
export const THINK_PAUSE_MS = 1800;
export const NEXT_PAUSE_MS = 1200;
export const BRUSHING_MS = 3 * 60 * 1000;
// Un morceau de radio dure environ 2 min 30 ; le suivant s'enchaîne à la fin
export const RADIO_SEGMENT_CALCULATIONS = 30;
const AFTER_INTRO_PAUSE_MS = 600;

export function questionFile(a: number, b: number): string {
  return `/audio/q_${a}_${b}.mp3`;
}

export function answerFile(result: number): string {
  return `/audio/ans_${result}.mp3`;
}

export function calculationsOf(tables: number[]): Calculation[] {
  return tables.flatMap((a) => Array.from({ length: 10 }, (_, i) => ({ a, b: i + 1, result: a * (i + 1) })));
}

// Nombre de créneaux qu'offre une durée d'écoute, d'après la longueur moyenne des calculs du pool
export function slotCountFor(pool: Calculation[], clips: ClipSource, sampleRate: number, durationMs: number): number {
  const toSamples = (ms: number) => Math.round((ms * sampleRate) / 1000);
  const total = pool.reduce(
    (sum, c) => sum + clips(questionFile(c.a, c.b)).length + toSamples(THINK_PAUSE_MS) + clips(answerFile(c.result)).length + toSamples(NEXT_PAUSE_MS),
    0
  );
  // La pause qui suit le dernier calcul peut manquer
  return Math.floor((toSamples(durationMs) + toSamples(NEXT_PAUSE_MS)) / (total / pool.length));
}

export function encodeWav(chunks: Float32Array[], sampleRate: number): ArrayBuffer {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const dataSize = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeTag = (offset: number, tag: string) => {
    for (let i = 0; i < tag.length; i++) view.setUint8(offset + i, tag.charCodeAt(i));
  };

  // En-tête PCM 16 bits mono
  writeTag(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeTag(8, "WAVE");
  writeTag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeTag(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const sample = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, Math.round(sample * 32767), true);
      offset += 2;
    }
  }
  return buffer;
}

function createWriter(clips: ClipSource, sampleRate: number) {
  const chunks: Float32Array[] = [];
  const cues: ProgramCue[] = [];
  let sampleCount = 0;

  const toSamples = (ms: number) => Math.round((ms * sampleRate) / 1000);
  const toSeconds = (samples: number) => samples / sampleRate;

  function addSamples(chunk: Float32Array) {
    chunks.push(chunk);
    sampleCount += chunk.length;
  }

  return {
    position: () => sampleCount,
    toSamples,
    toSeconds,

    addClip(file: string) {
      addSamples(clips(file));
    },

    addSilence(samples: number) {
      if (samples > 0) addSamples(new Float32Array(samples));
    },

    // Longueur d'un calcul jusqu'à la fin de sa réponse, sans la pause qui le suit
    spokenLength(calc: Calculation): number {
      return clips(questionFile(calc.a, calc.b)).length + toSamples(THINK_PAUSE_MS) + clips(answerFile(calc.result)).length;
    },

    // Question, temps de réflexion, réponse, puis une pause d'au plus maxPauseSamples
    addCalculation(calc: Calculation, maxPauseSamples = Infinity) {
      const start = sampleCount;
      addSamples(clips(questionFile(calc.a, calc.b)));
      addSamples(new Float32Array(toSamples(THINK_PAUSE_MS)));
      const answer = sampleCount;
      addSamples(clips(answerFile(calc.result)));
      this.addSilence(Math.min(toSamples(NEXT_PAUSE_MS), maxPauseSamples));
      cues.push({ ...calc, startS: toSeconds(start), answerS: toSeconds(answer), endS: toSeconds(sampleCount) });
    },

    finish(brushing: AudioProgram["brushing"]): AudioProgram {
      return { wav: encodeWav(chunks, sampleRate), durationS: toSeconds(sampleCount), cues, brushing };
    }
  };
}

export function buildRadioSegment(
  next: () => Calculation,
  clips: ClipSource,
  sampleRate: number,
  count = RADIO_SEGMENT_CALCULATIONS
): AudioProgram {
  const writer = createWriter(clips, sampleRate);
  for (let i = 0; i < count; i++) writer.addCalculation(next());
  return writer.finish(null);
}

// Annonce de début, 3 minutes de calculs, puis félicitation et annonce de fin
export function buildBrushingProgram(
  next: () => Calculation,
  clips: ClipSource,
  sampleRate: number,
  phrases: BrushingPhrases
): AudioProgram {
  const writer = createWriter(clips, sampleRate);
  writer.addClip(phrases.intro);
  writer.addSilence(writer.toSamples(AFTER_INTRO_PAUSE_MS));

  const start = writer.position();
  const end = start + writer.toSamples(BRUSHING_MS);

  // Un calcul n'entre que si sa réponse finit avant la fin du brossage : aucun n'est coupé
  for (let calc = next(); writer.position() + writer.spokenLength(calc) <= end; calc = next()) {
    writer.addCalculation(calc, end - writer.position() - writer.spokenLength(calc));
  }
  writer.addSilence(end - writer.position());

  writer.addClip(phrases.cheer);
  writer.addClip(phrases.outro);
  return writer.finish({ startS: writer.toSeconds(start), endS: writer.toSeconds(end) });
}

// Calcul en cours à l'instant donné, et si sa réponse a déjà été dite
export function locateCue(cues: ProgramCue[], timeS: number): { cue: ProgramCue; isAnswerRevealed: boolean } | null {
  const cue = cues.find((c) => timeS >= c.startS && timeS < c.endS);
  return cue ? { cue, isAnswerRevealed: timeS >= cue.answerS } : null;
}
