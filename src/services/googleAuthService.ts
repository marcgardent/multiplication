import { CloudAuth, CloudUnavailableError } from "./cloudSyncService";
import { DRIVE_APP_DATA_SCOPE, GOOGLE_CLIENT_ID, loadGsiScript } from "./googleDriveService";

// Connexion Google pour la sauvegarde.
// Google ne donne à une application web qu'un jeton d'une heure, et seulement à travers une fenêtre
// ouverte pendant un geste de l'utilisateur. Pour rester discret, on le redemande au premier toucher
// sur un écran calme : la fenêtre Google s'ouvre et se referme seule quand l'autorisation est déjà donnée.

const TOKEN_KEY = "mult_cloud:token";
// On cesse d'utiliser un jeton une minute avant sa fin : un envoi commencé ne doit pas expirer en route
const EXPIRY_MARGIN_MS = 60 * 1000;

interface StoredToken {
  token: string;
  expiresAt: number;
}

export interface GoogleAuth extends CloudAuth {
  // Charge le service de connexion de Google à l'avance, pour qu'un clic puisse ouvrir la fenêtre sans attendre
  prepare(): Promise<void>;
}

export function createGoogleAuth(isBusy: () => boolean): GoogleAuth {
  // Gardé le temps de la session : un rechargement de la page ne redemande pas la connexion, une fermeture l'oublie
  function read(): StoredToken | null {
    try {
      const raw = sessionStorage.getItem(TOKEN_KEY);
      return raw ? (JSON.parse(raw) as StoredToken) : null;
    } catch {
      return null;
    }
  }

  function getToken(): string | null {
    const stored = read();
    return stored && stored.expiresAt - EXPIRY_MARGIN_MS > Date.now() ? stored.token : null;
  }

  function forgetToken() {
    sessionStorage.removeItem(TOKEN_KEY);
  }

  function requestToken(mode: "choose" | "silent"): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!window.google?.accounts?.oauth2) {
        reject(new CloudUnavailableError("La connexion Google n'est pas disponible pour l'instant"));
        return;
      }
      try {
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: DRIVE_APP_DATA_SCOPE,
          callback: (resp: { access_token?: string; expires_in?: number | string; error?: string; error_description?: string }) => {
            if (resp.error || !resp.access_token) {
              reject(new Error(resp.error_description || resp.error || "Connexion Google refusée"));
              return;
            }
            const lifetimeMs = Number(resp.expires_in ?? 3600) * 1000;
            sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: resp.access_token, expiresAt: Date.now() + lifetimeMs }));
            resolve(resp.access_token);
          },
          // Fenêtre fermée ou bloquée par le navigateur
          error_callback: (err: { type?: string; message?: string }) => {
            reject(new Error(err?.message || err?.type || "Fenêtre Google fermée"));
          }
        });
        // Une chaîne vide ne montre la fenêtre de consentement que si l'autorisation n'a pas déjà été donnée
        client.requestAccessToken(mode === "silent" ? { prompt: "" } : {});
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Erreur d'ouverture de la fenêtre Google"));
      }
    });
  }

  async function prepare(): Promise<void> {
    try {
      await loadGsiScript();
    } catch {
      throw new CloudUnavailableError("Service de connexion Google injoignable");
    }
  }

  return {
    getToken,
    forgetToken,
    requestToken,
    prepare,

    async requestTokenOnNextGesture(): Promise<string> {
      await prepare();
      return new Promise((resolve, reject) => {
        const onClick = () => {
          // Jamais au milieu d'une séance, de la radio ou du brossage : on attend un toucher sur un écran calme
          if (isBusy()) return;
          document.removeEventListener("click", onClick, true);
          requestToken("silent").then(resolve, reject);
        };
        document.addEventListener("click", onClick, true);
      });
    }
  };
}
