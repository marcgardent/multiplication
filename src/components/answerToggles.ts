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

function show(root: HTMLElement, p: AnswerPreferences, isAllowed: boolean) {
  root.querySelectorAll<HTMLElement>(".btn-toggle-sound").forEach((btn) => {
    btn.textContent = p.sound ? "🔊" : "🔇";
    btn.setAttribute("aria-label", p.sound ? "Couper le son" : "Remettre le son");
    btn.title = p.sound ? "Son allumé" : "Son coupé";
  });
  root.querySelectorAll<HTMLElement>(".btn-toggle-speech").forEach((btn) => {
    btn.textContent = p.speech ? "🎤" : "⌨️";
    btn.classList.toggle("is-locked", !isAllowed);
    btn.setAttribute(
      "aria-label",
      !isAllowed ? `Réponse à voix haute : ${SPEECH_LOCKED_TEXT}` : p.speech ? "Répondre avec le clavier" : "Répondre à la voix"
    );
    btn.title = !isAllowed ? `Réponse à voix haute : ${SPEECH_LOCKED_TEXT}` : p.speech ? "Tu réponds à la voix" : "Tu réponds au clavier";
  });
}

// Renvoie de quoi se désabonner quand la barre disparaît
export function bindAnswerToggles(root: HTMLElement, preferences: AnswerPreferencesStore): () => void {
  root.querySelectorAll(".btn-toggle-sound").forEach((btn) =>
    btn.addEventListener("click", () => preferences.set({ sound: !preferences.get().sound }))
  );
  root.querySelectorAll(".btn-toggle-speech").forEach((btn) =>
    btn.addEventListener("click", () => {
      // Bloqué par le parent : le bouton reste là et dit où l'activer
      if (!preferences.isSpeechAllowed()) {
        showHint(`🔒 Réponse à voix haute : ${SPEECH_LOCKED_TEXT.toLowerCase()}`);
        return;
      }
      preferences.set({ speech: !preferences.get().speech });
    })
  );
  show(root, preferences.get(), preferences.isSpeechAllowed());
  return preferences.subscribe((p) => show(root, p, preferences.isSpeechAllowed()));
}
