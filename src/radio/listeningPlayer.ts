import { AudioManifest, resolveAudioUrl } from "../services/audioService";
import {
  answerFile,
  AudioProgram,
  BRUSHING_MS,
  buildBrushingProgram,
  buildRadioSegment,
  Calculation,
  encodeWav,
  locateCue,
  ProgramCue,
  questionFile,
  slotCountFor
} from "./program";
import { createSpacedStream } from "./spacedSchedule";

export type ListeningMode = "radio" | "brushing";

// Ce que l'on écoute : les calculs du pool, l'ordre dans lequel ils entrent, et pour qui
export interface ListeningSelection {
  pool: Calculation[];
  // Ordre d'entrée d'un tour ; rappelé quand tout le pool est entré
  nextRound(): Calculation[];
  // « Tables : 2, 3 » ou « Pour Léa et Tom »
  label: string;
  // Calculs entrés depuis le début de l'écoute, à chaque nouveau morceau joué
  onIntroduced?(calcs: Calculation[]): void;
}

export interface ListeningPosition {
  cue: ProgramCue | null;
  isAnswerRevealed: boolean;
  // Temps de brossage restant et part écoulée, de 0 à 1 ; absent en mode radio
  brushing: { remainingS: number; progress: number } | null;
}

export interface ListeningEvents {
  onPlayingChange(isPlaying: boolean): void;
  // Arrêt demandé depuis l'écran verrouillé ou la notification du téléphone
  onStopRequested(): void;
  // Fin du brossage ; la radio, elle, ne finit jamais
  onFinished(): void;
  onError(error: unknown): void;
}

export interface ListeningPlayer {
  // Nul tant que les voix se préparent
  getPosition(): ListeningPosition | null;
  toggle(): void;
  stop(): void;
}

const BRUSHING_PHRASES = {
  intro: "/audio/phrase_brossage_debut.mp3",
  outro: "/audio/phrase_brossage_fin.mp3"
};
// Fréquence d'origine des voix Piper : inutile de décoder plus fin
const DECODE_SAMPLE_RATE = 22050;

async function fetchManifest(): Promise<AudioManifest> {
  const response = await fetch(resolveAudioUrl("/audio/index.json"));
  if (!response.ok) throw new Error(`Liste des voix introuvable (${response.status})`);
  return (await response.json()) as AudioManifest;
}

// Charge et décode les voix une fois pour toutes : ensuite la lecture n'a plus besoin du réseau
async function decodeClips(files: string[]): Promise<{ clips: Map<string, Float32Array>; sampleRate: number }> {
  const OfflineContext =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const context = new OfflineContext(1, 1, DECODE_SAMPLE_RATE);

  const decoded = await Promise.all(
    files.map(async (file) => {
      const response = await fetch(resolveAudioUrl(file));
      if (!response.ok) throw new Error(`Voix introuvable : ${file} (${response.status})`);
      const encoded = await response.arrayBuffer();
      const buffer = await new Promise<AudioBuffer>((resolve, reject) => context.decodeAudioData(encoded, resolve, reject));
      return [file, buffer.getChannelData(0)] as const;
    })
  );
  return { clips: new Map(decoded), sampleRate: context.sampleRate };
}

// Doit être appelé pendant le clic qui lance l'écoute : le téléphone n'autorise le son qu'à ce moment-là
export function startListeningPlayer(mode: ListeningMode, selection: ListeningSelection, events: ListeningEvents): ListeningPlayer {
  const audio = new Audio();
  const stream = createSpacedStream(selection.nextRound);
  let current: AudioProgram | null = null;
  let upcoming: AudioProgram | null = null;
  // Calculs entrés jusqu'à la fin de chaque morceau préparé, annoncés quand ce morceau commence
  const introducedBy = new WeakMap<AudioProgram, Calculation[]>();
  let currentUrl: string | null = null;
  let buildSegment: (() => AudioProgram) | null = null;
  let isStopped = false;
  let isFinished = false;
  // Faux après une pause, qu'elle vienne de l'écran ou du téléphone (appel, écouteurs débranchés)
  let wantsToPlay = true;

  function setSource(wav: ArrayBuffer) {
    const previousUrl = currentUrl;
    currentUrl = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
    audio.src = currentUrl;
    if (previousUrl) URL.revokeObjectURL(previousUrl);
  }

  function play() {
    audio.play().catch((err) => {
      // Lecture refusée par le navigateur : l'écran passe en pause, un appui la relance
      console.warn("Lecture refusée", err);
      wantsToPlay = false;
      events.onPlayingChange(false);
    });
  }

  function playProgram(program: AudioProgram) {
    current = program;
    const introduced = introducedBy.get(program);
    if (introduced) selection.onIntroduced?.(introduced);
    setSource(program.wav);
    if (wantsToPlay) play();
  }

  function announceToSystem() {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: mode === "radio" ? "Radio des tables" : "Brossage de dents",
      artist: selection.label,
      album: "Multiplications",
      artwork: [{ src: `${import.meta.env.BASE_URL}icons/icon-512.svg`, sizes: "512x512", type: "image/svg+xml" }]
    });
    setSystemAction("play", () => play());
    setSystemAction("pause", () => audio.pause());
    setSystemAction("stop", () => events.onStopRequested());
  }

  function leaveSystem() {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = null;
    (["play", "pause", "stop"] as const).forEach((action) => setSystemAction(action, null));
  }

  // Un téléphone qui ne connaît pas une commande la refuse par une erreur : on s'en passe
  function setSystemAction(action: MediaSessionAction, handler: (() => void) | null) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (err) {
      console.warn(`Commande ${action} indisponible sur ce téléphone`, err);
    }
  }

  audio.addEventListener("play", () => {
    wantsToPlay = true;
    events.onPlayingChange(true);
  });
  audio.addEventListener("pause", () => {
    if (isStopped || audio.ended) return;
    wantsToPlay = false;
    events.onPlayingChange(false);
  });
  audio.addEventListener("ended", () => {
    if (isStopped || !current) return;

    if (buildSegment && upcoming) {
      // Radio : le morceau suivant est déjà prêt, il part sans attendre, puis on prépare celui d'après
      playProgram(upcoming);
      upcoming = buildSegment();
    } else if (current.brushing) {
      isFinished = true;
      leaveSystem();
      events.onFinished();
    }
  });
  audio.addEventListener("error", () => {
    if (!isStopped && current) events.onError(audio.error);
  });

  // Un son vide joué pendant le clic : le lecteur reste autorisé à jouer quand les voix seront prêtes
  setSource(encodeWav([new Float32Array(DECODE_SAMPLE_RATE / 10)], DECODE_SAMPLE_RATE));
  audio.play().catch(() => undefined);

  async function prepare() {
    const calcs = selection.pool;
    const voiceFiles = [...calcs.map((c) => questionFile(c.a, c.b)), ...new Set(calcs.map((c) => answerFile(c.result)))];

    let cheer = "";
    if (mode === "brushing") {
      const cheers = Object.values((await fetchManifest()).cheers ?? {});
      if (cheers.length === 0) throw new Error("Aucune félicitation dans la liste des voix");
      cheer = cheers[Math.floor(Math.random() * cheers.length)].file;
      voiceFiles.push(BRUSHING_PHRASES.intro, cheer, BRUSHING_PHRASES.outro);
    }

    const { clips, sampleRate } = await decodeClips(voiceFiles);
    if (isStopped) return;
    const clipOf = (file: string) => clips.get(file) as Float32Array;

    announceToSystem();
    const withIntroduced = (program: AudioProgram) => {
      introducedBy.set(program, stream.introduced());
      return program;
    };
    if (mode === "radio") {
      buildSegment = () => withIntroduced(buildRadioSegment(() => stream.next(), clipOf, sampleRate));
      playProgram(buildSegment());
      upcoming = buildSegment();
    } else {
      // Le planificateur connaît le nombre de créneaux : aucun calcul n'entre sans le temps de ses reprises
      const slotCount = slotCountFor(calcs, clipOf, sampleRate, BRUSHING_MS);
      let slot = 0;
      const next = () => stream.next(slotCount - slot++);
      playProgram(withIntroduced(buildBrushingProgram(next, clipOf, sampleRate, { ...BRUSHING_PHRASES, cheer })));
    }
  }

  prepare().catch((err) => {
    if (!isStopped) events.onError(err);
  });

  return {
    getPosition(): ListeningPosition | null {
      if (!current) return null;
      const timeS = isFinished ? current.durationS : audio.currentTime;
      const located = locateCue(current.cues, timeS);
      const brushing = current.brushing;
      return {
        cue: located?.cue ?? null,
        isAnswerRevealed: located?.isAnswerRevealed ?? false,
        brushing: brushing
          ? {
              remainingS: Math.max(0, Math.min(brushing.endS - brushing.startS, brushing.endS - timeS)),
              progress: Math.max(0, Math.min(1, (timeS - brushing.startS) / (brushing.endS - brushing.startS)))
            }
          : null
      };
    },

    toggle() {
      if (isStopped || isFinished) return;
      wantsToPlay = !wantsToPlay;
      if (!current) {
        // Les voix se préparent encore : on retient seulement le souhait
        events.onPlayingChange(wantsToPlay);
      } else if (wantsToPlay) {
        play();
      } else {
        audio.pause();
      }
    },

    stop() {
      if (isStopped) return;
      isStopped = true;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      leaveSystem();
    }
  };
}
