import { AudioManifest, resolveAudioUrl } from "../services/audioService";
import { nextToRecord, recordingOrder, VoiceClip, voiceCatalog } from "../voices/voiceCatalog";
import { VoiceStore } from "../voices/voiceStore";
import { openFeatureModal } from "./parentArea";
import { openVoiceRecordModal } from "./voiceRecordModal";

export interface VoiceStudioOptions {
  store: VoiceStore;
}

// « Enregistrer votre voix » : félicitations, tableau des multiplications et réponses, chacun cliquable
export function openVoiceStudio(options: VoiceStudioOptions): HTMLElement {
  const { modal, body } = openFeatureModal("🎙️ Votre voix", "voice-studio-modal");
  const area = document.createElement("div");
  area.className = "parent-area voice-studio";
  area.innerHTML = `<p class="voice-loading">Chargement…</p>`;
  body.appendChild(area);

  Promise.all([
    fetch(resolveAudioUrl("/audio/index.json")).then((r) => r.json() as Promise<AudioManifest>),
    options.store.list()
  ])
    .then(([manifest, files]) => {
      const order = recordingOrder(voiceCatalog(manifest));
      const recorded = new Set(files);
      const draw = () => drawStudio(area, order, recorded, options.store, draw);
      draw();
    })
    .catch((err) => {
      console.warn("Voix indisponibles", err);
      area.innerHTML = `<p class="voice-loading">Impossible de charger la liste des voix.</p>`;
    });
  return modal;
}

function cell(clip: VoiceClip, recorded: Set<string>, text = clip.label): string {
  const isRecorded = recorded.has(clip.file);
  return `
    <button type="button" class="voice-cell ${isRecorded ? "is-recorded" : ""}" data-file="${clip.file}"
      aria-label="${clip.text}${isRecorded ? ", voix enregistrée" : ""}">${text}</button>
  `;
}

function drawStudio(area: HTMLElement, order: VoiceClip[], recorded: Set<string>, store: VoiceStore, redraw: () => void) {
  const byFile = new Map(order.map((clip) => [clip.file, clip]));
  const of = (file: string) => byFile.get(file) as VoiceClip;
  const messages = order.filter((clip) => clip.kind === "cheer" || clip.kind === "phrase");
  const answers = order.filter((clip) => clip.kind === "answer").sort((x, y) => Number(x.label) - Number(y.label));
  const next = nextToRecord(order, recorded);
  const total = order.length;
  const done = order.filter((clip) => recorded.has(clip.file)).length;

  area.innerHTML = `
    <section class="parent-card voice-intro">
      <p>Votre voix remplace la voix de synthèse partout : séances, radio et brossage. Ce qui n'est pas enregistré garde la voix de synthèse. Les enregistrements restent sur cet appareil.</p>
      <div class="voice-progress">
        <div class="progress-bar-container"><div class="progress-bar-fill" style="width: ${Math.round((done / total) * 100)}%;"></div></div>
        <span>${done} / ${total} enregistrées</span>
      </div>
      ${
        next
          ? `<button type="button" class="btn-confirm-launch" id="btn-voice-continue">🎙️ ${done === 0 ? "Commencer" : "Continuer"} : « ${next.text} »</button>`
          : `<p class="voice-all-done">Toutes les voix sont enregistrées 🎉</p>`
      }
    </section>

    <section class="parent-card">
      <div class="parent-card-head"><h3>🎉 Félicitations et annonces</h3></div>
      <div class="voice-message-list">
        ${messages.map((clip) => cell(clip, recorded, `${recorded.has(clip.file) ? "✓ " : ""}${clip.label}`)).join("")}
      </div>
    </section>

    <section class="parent-card">
      <div class="parent-card-head"><h3>✖️ Multiplications</h3></div>
      <div class="voice-table" role="grid">
        ${Array.from({ length: 10 }, (_, i) => i + 1)
          .map((a) => Array.from({ length: 10 }, (_, j) => cell(of(`/audio/q_${a}_${j + 1}.mp3`), recorded, `${a}×${j + 1}`)).join(""))
          .join("")}
      </div>
    </section>

    <section class="parent-card">
      <div class="parent-card-head"><h3>🔢 Réponses</h3></div>
      <div class="voice-answers">
        ${answers.map((clip) => cell(clip, recorded)).join("")}
      </div>
    </section>

    <p class="voice-key"><span class="voice-key-swatch is-recorded"></span> votre voix <span class="voice-key-swatch"></span> voix de synthèse</p>
  `;

  const open = (clip: VoiceClip) => openVoiceRecordModal({ clip, order, recorded, store, onChange: redraw });

  area.querySelector("#btn-voice-continue")?.addEventListener("click", () => {
    if (next) open(next);
  });
  area.querySelectorAll<HTMLElement>(".voice-cell").forEach((btn) => {
    btn.addEventListener("click", () => open(of(btn.dataset.file ?? "")));
  });
}
