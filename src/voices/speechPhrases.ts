// Vosk répond dans l'ordre exact de ce qu'on lui envoie : un message par paquet de son (un résultat s'il a repéré
// lui-même une fin de phrase, sinon une supposition), et un résultat par fin de phrase demandée.
// En notant chaque envoi, on sait à quelle phrase appartient chaque message, et lequel est le dernier.
// Sans ça, une pause au milieu d'un appui (« sept… », doigt encore posé) coupait la réponse en deux,
// et seul le dernier morceau, vide, était lu
export interface VoskWord {
  word: string;
  end: number;
}

export type VoskMessage = { kind: "partial"; partial: string } | { kind: "result"; text: string; words?: VoskWord[] } | { kind: "error" };

export interface PhraseUpdate {
  phrase: number;
  // Tout ce qui a été reconnu dans la phrase jusqu'ici
  text: string;
  isFinal: boolean;
  // Fin du dernier mot reconnu, en secondes de son reçu par Vosk
  lastWordEnd?: number;
}

export interface PhraseTracker {
  // Un paquet de son de cette phrase vient d'être envoyé à Vosk
  fed(phrase: number): void;
  // La fin de cette phrase vient d'être demandée à Vosk
  finished(phrase: number): void;
  // Message reçu de Vosk ; nul s'il n'était pas attendu
  receive(message: VoskMessage): PhraseUpdate | null;
  reset(): void;
}

export function createPhraseTracker(): PhraseTracker {
  const expected: { phrase: number; isFinal: boolean }[] = [];
  // Morceaux déjà reconnus des phrases pas encore finies
  const pieces = new Map<number, { texts: string[]; lastWordEnd?: number }>();

  return {
    fed(phrase) {
      expected.push({ phrase, isFinal: false });
    },

    finished(phrase) {
      expected.push({ phrase, isFinal: true });
    },

    receive(message) {
      const slot = expected.shift();
      if (!slot) return null;
      const known = pieces.get(slot.phrase) ?? { texts: [] };
      if (message.kind === "result" && message.text) {
        known.texts.push(message.text);
        const last = message.words?.[message.words.length - 1];
        if (last) known.lastWordEnd = last.end;
      }
      const partial = message.kind === "partial" ? message.partial : "";
      const text = [...known.texts, partial].filter(Boolean).join(" ");
      if (slot.isFinal) {
        pieces.delete(slot.phrase);
        return { phrase: slot.phrase, text, isFinal: true, lastWordEnd: known.lastWordEnd };
      }
      pieces.set(slot.phrase, known);
      return { phrase: slot.phrase, text, isFinal: false };
    },

    reset() {
      expected.length = 0;
      pieces.clear();
    }
  };
}
