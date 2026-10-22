import { AnswerPreferences, AnswerPreferencesStore } from "../services/answerPreferences";
import { isSpeechSupported } from "../voices/speechListener";

// Deux icônes de la barre du haut, partout : le son, et la façon de répondre (voix ou clavier)
export function answerTogglesHtml(): string {
  return `
    <button type="button" class="icon-btn btn-toggle-sound"></button>
    <button type="button" class="icon-btn btn-toggle-speech" ${isSpeechSupported() ? "" : "hidden"}></button>
  `;
}

export const SPEECH_LOCKED_TEXT = "À activer dans l'espace parent.";
export const SPEECH_TOO_SLOW_TEXT = "Trop lent sur ce téléphone (voir le calibrage dans l'espace parent).";
export const SPEECH_MISHEARD_TEXT = "La voix est mal comprise sur ce téléphone (voir le calibrage dans l'espace parent).";

// Pourquoi l'enfant ne peut pas répondre à voix haute sur cet appareil ; nul s'il le peut
export function speechBlocker(preferences: AnswerPreferencesStore): string | null {
  if (!isSpeechSupported()) return "Pas possible sur ce téléphone.";
  if (!preferences.isSpeechAllowed()) return `🔒 ${SPEECH_LOCKED_TEXT}`;
  const calibration = preferences.speechCalibration();
  if (calibration?.verdict === "unusable") {
    const isMisheard = calibration.correct < Math.ceil((calibration.total * 2) / 3);
    return isMisheard ? `👂 ${SPEECH_MISHEARD_TEXT}` : `🐢 ${SPEECH_TOO_SLOW_TEXT}`;
  }
  return null;
}

// Court message en bas de l'écran, qui s'efface tout seul
function showHint(text: string) {
  document.querySelector(".app-toast")?.remove();
  const toast = document.createElement("p");
  toast.className = "app-toast";
  toast.setAttribute("role", "status");
  toast.textContent = text;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function show(root: HTMLElement, p: AnswerPreferences, blocker: string | null) {
  const isAllowed = blocker === null;
  root.querySelectorAll<HTMLElement>(".btn-toggle-sound").forEach((btn) => {
    btn.textContent = p.sound ? "🔊" : "🔇";
    btn.setAttribute("aria-label", p.sound ? "Couper le son" : "Remettre le son");
    btn.title = p.sound ? "Son allumé" : "Son coupé";
  });
  root.querySelectorAll<HTMLElement>(".btn-toggle-speech").forEach((btn) => {
    btn.textContent = p.speech ? "🎤" : "⌨️";
    btn.classList.toggle("is-locked", !isAllowed);
    btn.setAttribute("aria-label", blocker ? `Réponse à voix haute : ${blocker}` : p.speech ? "Répondre avec le clavier" : "Répondre à la voix");
    btn.title = blocker ? `Réponse à voix haute : ${blocker}` : p.speech ? "Tu réponds à la voix" : "Tu réponds au clavier";
  });
}

// Renvoie de quoi se désabonner quand la barre disparaît
export function bindAnswerToggles(root: HTMLElement, preferences: AnswerPreferencesStore): () => void {
  root.querySelectorAll(".btn-toggle-sound").forEach((btn) =>
    btn.addEventListener("click", () => preferences.set({ sound: !preferences.get().sound }))
  );
  root.querySelectorAll(".btn-toggle-speech").forEach((btn) =>
    btn.addEventListener("click", () => {
      // Bloqué (par le parent, ou téléphone trop lent) : le bouton reste là et dit pourquoi
      const blocker = speechBlocker(preferences);
      if (blocker) {
        showHint(`Réponse à voix haute : ${blocker}`);
        return;
      }
      preferences.set({ speech: !preferences.get().speech });
    })
  );
  show(root, preferences.get(), speechBlocker(preferences));
  return preferences.subscribe((p) => show(root, p, speechBlocker(preferences)));
}
