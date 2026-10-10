export interface AudioManifest {
  questions: Record<string, { file: string; text: string; a: number; b: number }>;
  answers: Record<string, { file: string; text: string; val: number }>;
  cheers?: Record<string, { file: string; text: string }>;
  phrases?: Record<string, { file: string; text: string }>;
}

export function resolveAudioUrl(path: string): string {
  if (path.startsWith("/")) {
    return `${import.meta.env.BASE_URL}${path.slice(1)}`;
  }
  return path;
}

export interface AudioService {
  init(): Promise<void>;
  playQuestion(a: number, b: number): Promise<void>;
  playAnswer(result: number): Promise<void>;
  playFeedback(type: "correct" | "wrong" | "finish"): Promise<void>;
  playCheer(): Promise<void>;
  playWheelTick(): void;
  playPointTick(): void;
  playCoinSound(): void;
  stop(): void;
  isMuted(): boolean;
  toggleMute(): boolean;
}

export function createAudioService(): AudioService {
  let isMutedState = false;
  let currentAudio: HTMLAudioElement | null = null;
  const audioCache = new Map<string, HTMLAudioElement>();
  // Félicitations déclarées dans scripts/generate_audio.py, lues depuis le manifeste
  let cheerFiles: string[] = [];

  // Web Audio API synthétiseur léger pour les sons d effets bips de succès ou erreur
  let audioCtx: AudioContext | null = null;

  function getAudioContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxClass) {
        audioCtx = new AudioCtxClass();
      }
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playTone(freq: number, type: OscillatorType, duration: number, delay = 0) {
    if (isMutedState) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      setTimeout(() => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
      }, delay * 1000);
    } catch (e) {
      console.warn("Erreur AudioContext tone", e);
    }
  }

  function playAudioFile(url: string): Promise<void> {
    if (isMutedState) return Promise.resolve();
    const resolvedUrl = resolveAudioUrl(url);

    return new Promise((resolve) => {
      try {
        if (currentAudio) {
          currentAudio.pause();
          currentAudio.currentTime = 0;
        }

        let audio = audioCache.get(resolvedUrl);
        if (!audio) {
          audio = new Audio(resolvedUrl);
          audio.preload = "auto";
          audioCache.set(resolvedUrl, audio);
        } else {
          audio.currentTime = 0;
        }

        currentAudio = audio;

        const onEnded = () => {
          audio?.removeEventListener("ended", onEnded);
          audio?.removeEventListener("error", onError);
          resolve();
        };

        const onError = (e: Event) => {
          console.warn(`Erreur lecture audio ${resolvedUrl}`, e);
          audio?.removeEventListener("ended", onEnded);
          audio?.removeEventListener("error", onError);
          resolve();
        };

        audio.addEventListener("ended", onEnded);
        audio.addEventListener("error", onError);

        audio.play().catch((err) => {
          console.warn(`Lecture audio bloquée ou échouée: ${resolvedUrl}`, err);
          resolve();
        });
      } catch (err) {
        console.warn("Exception playAudioFile", err);
        resolve();
      }
    });
  }

  return {
    async init(): Promise<void> {
      try {
        const resp = await fetch(resolveAudioUrl("/audio/index.json"));
        if (resp.ok) {
          const manifest = (await resp.json()) as AudioManifest;
          cheerFiles = Object.values(manifest.cheers ?? {}).map((cheer) => cheer.file);
          Object.values(manifest.answers).forEach((ans) => {
            const resolved = resolveAudioUrl(ans.file);
            const a = new Audio(resolved);
            a.preload = "auto";
            audioCache.set(ans.file, a);
            audioCache.set(resolved, a);
          });
        }
      } catch (e) {
        console.warn("Initialisation audio offline fallback", e);
      }
    },

    playQuestion(a: number, b: number): Promise<void> {
      return playAudioFile(`/audio/q_${a}_${b}.mp3`);
    },

    playAnswer(result: number): Promise<void> {
      return playAudioFile(`/audio/ans_${result}.mp3`);
    },

    playFeedback(type: "correct" | "wrong" | "finish"): Promise<void> {
      if (type === "correct") {
        playTone(523.25, "sine", 0.12, 0);       // C5
        playTone(659.25, "sine", 0.18, 0.08);    // E5
      } else if (type === "wrong") {
        playTone(250, "sawtooth", 0.25, 0);
      } else if (type === "finish") {
        playTone(523.25, "sine", 0.15, 0);
        playTone(659.25, "sine", 0.15, 0.12);
        playTone(783.99, "sine", 0.3, 0.24);     // G5
      }
      return Promise.resolve();
    },

    playCheer(): Promise<void> {
      if (cheerFiles.length === 0) return Promise.resolve();
      return playAudioFile(cheerFiles[Math.floor(Math.random() * cheerFiles.length)]);
    },

    playWheelTick(): void {
      if (isMutedState) return;
      try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(800 + Math.random() * 200, ctx.currentTime);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.04);
      } catch (e) {
        // Ignorer
      }
    },

    // Décompte des points : plus aigu et plus doux que le cliquetis de la roue
    playPointTick(): void {
      playTone(1567.98, "triangle", 0.03, 0); // G6
    },

    playCoinSound(): void {
      if (isMutedState) return;
      playTone(987.77, "sine", 0.08, 0);    // B5
      playTone(1318.51, "sine", 0.18, 0.06); // E6
    },

    stop(): void {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      }
    },

    isMuted(): boolean {
      return isMutedState;
    },

    toggleMute(): boolean {
      isMutedState = !isMutedState;
      if (isMutedState && currentAudio) {
        currentAudio.pause();
      }
      return isMutedState;
    }
  };
}
