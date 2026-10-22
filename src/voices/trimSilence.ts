// Nettoyage d'un enregistrement : on retire les blancs avant et après la voix, puis on règle son volume

// Fenêtre de mesure du volume
const WINDOW_MS = 10;
// Est considéré comme voix ce qui dépasse cette part du passage le plus fort
const RELATIVE_THRESHOLD = 0.12;
// En dessous, c'est du silence quel que soit le reste : un enregistrement muet n'a pas de voix
const ABSOLUTE_THRESHOLD = 0.01;
// Marges gardées autour de la voix, pour ne couper ni l'attaque ni la fin d'un mot
const MARGIN_BEFORE_MS = 60;
const MARGIN_AFTER_MS = 150;
// Volume de crête visé, proche de celui de la voix de synthèse
export const TARGET_PEAK = 0.7;

function windowLevels(samples: Float32Array, windowSize: number): number[] {
  const levels: number[] = [];
  for (let start = 0; start < samples.length; start += windowSize) {
    const end = Math.min(samples.length, start + windowSize);
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    levels.push(Math.sqrt(sum / (end - start)));
  }
  return levels;
}

// Renvoie un extrait vide quand aucune voix n'est entendue
export function trimSilence(samples: Float32Array, sampleRate: number): Float32Array {
  const windowSize = Math.max(1, Math.round((WINDOW_MS * sampleRate) / 1000));
  const levels = windowLevels(samples, windowSize);
  const loudest = Math.max(0, ...levels);
  if (loudest < ABSOLUTE_THRESHOLD) return new Float32Array(0);

  const threshold = Math.max(ABSOLUTE_THRESHOLD, loudest * RELATIVE_THRESHOLD);
  const first = levels.findIndex((level) => level >= threshold);
  const last = levels.length - 1 - [...levels].reverse().findIndex((level) => level >= threshold);

  const start = Math.max(0, first * windowSize - Math.round((MARGIN_BEFORE_MS * sampleRate) / 1000));
  const end = Math.min(samples.length, (last + 1) * windowSize + Math.round((MARGIN_AFTER_MS * sampleRate) / 1000));
  return samples.slice(start, end);
}

export function normalizePeak(samples: Float32Array, target = TARGET_PEAK): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak === 0) return samples;
  const gain = target / peak;
  return samples.map((s) => s * gain);
}
