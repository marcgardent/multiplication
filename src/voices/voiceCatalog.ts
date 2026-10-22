// Liste de tout ce que l'on peut enregistrer, et ordre dans lequel l'application le propose

import { DEFAULT_LEARNING_TABLES } from "../core/matrixStore";
import { AudioManifest } from "../services/audioService";

export type VoiceKind = "cheer" | "phrase" | "question" | "answer";

export interface VoiceClip {
  // Chemin de la voix de synthèse qu'il remplace : c'est aussi sa clé d'enregistrement
  file: string;
  kind: VoiceKind;
  // Ce qu'il faut dire
  text: string;
  // Comment le montrer dans les listes : « 7 × 8 », « 56 », « Bravo ! »
  label: string;
}

export const KIND_TITLES: Record<VoiceKind, string> = {
  cheer: "Félicitation",
  phrase: "Annonce",
  question: "Multiplication",
  answer: "Réponse"
};

export function voiceCatalog(manifest: AudioManifest): VoiceClip[] {
  return [
    ...Object.values(manifest.cheers ?? {}).map((c) => ({ file: c.file, kind: "cheer" as const, text: c.text, label: c.text })),
    ...Object.values(manifest.phrases ?? {}).map((p) => ({ file: p.file, kind: "phrase" as const, text: p.text, label: p.text })),
    ...Object.values(manifest.questions).map((q) => ({ file: q.file, kind: "question" as const, text: q.text, label: `${q.a} × ${q.b}` })),
    ...Object.values(manifest.answers).map((r) => ({ file: r.file, kind: "answer" as const, text: r.text, label: String(r.val) }))
  ];
}

// Ordre de la file : félicitations et annonces, entendues à chaque séance ; puis table par table dans l'ordre
// d'apprentissage par défaut (1, 10, 2, 5…), chaque table suivie des réponses qu'elle ajoute
export function recordingOrder(catalog: VoiceClip[], tableOrder: number[] = DEFAULT_LEARNING_TABLES): VoiceClip[] {
  const byFile = new Map(catalog.map((clip) => [clip.file, clip]));
  const ordered: VoiceClip[] = catalog.filter((clip) => clip.kind === "cheer" || clip.kind === "phrase");
  const seen = new Set(ordered.map((clip) => clip.file));
  const push = (file: string) => {
    const clip = byFile.get(file);
    if (clip && !seen.has(file)) {
      ordered.push(clip);
      seen.add(file);
    }
  };

  for (const a of tableOrder) {
    for (let b = 1; b <= 10; b++) push(`/audio/q_${a}_${b}.mp3`);
    for (let b = 1; b <= 10; b++) push(`/audio/ans_${a * b}.mp3`);
  }
  // Ce que l'ordre des tables n'a pas couvert, pour ne rien oublier
  catalog.forEach((clip) => push(clip.file));
  return ordered;
}

// Prochain enregistrement à faire après celui-ci, en reprenant au début de la file si besoin
export function nextToRecord(order: VoiceClip[], recorded: Set<string>, currentFile: string | null = null): VoiceClip | null {
  const start = currentFile ? order.findIndex((clip) => clip.file === currentFile) + 1 : 0;
  for (let i = 0; i < order.length; i++) {
    const clip = order[(start + i) % order.length];
    if (clip.file !== currentFile && !recorded.has(clip.file)) return clip;
  }
  return null;
}
