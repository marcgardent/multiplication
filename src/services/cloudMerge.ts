import { AttemptLog, MultiplicationItem, UserProfile } from "../types";
import { WheelDailyState } from "../core/profileData";

// Fusion de deux sauvegardes, selon les règles de docs/sauvegarde-et-fusion.md.
// Fonction pure : l'ordre des fusions et leurs répétitions ne changent pas le résultat.

export interface SyncMeta {
  // Change quand un parent remplace volontairement les données : deux lignées différentes ne se fusionnent pas
  lineage: string;
  // Pour chaque compteur, la part apportée par chaque appareil ; le total est leur somme
  counters: Record<string, Record<string, number>>;
  // Date de dernière modification de chaque réglage
  times: Record<string, number>;
}

export interface SyncDoc {
  data: Record<string, unknown>;
  sync: SyncMeta;
}

export type KeyFamily = "profiles" | "counter" | "items" | "history" | "set" | "wheel" | "device" | "setting";

const HISTORY_LIMIT = 500;
// Part attribuée à un ancien fichier, qui ne disait pas quel appareil avait apporté quoi
const LEGACY_DEVICE = "legacy";

const FAMILY_BY_PREFIX: [string, KeyFamily][] = [
  ["points_", "counter"],
  ["practice_time_", "counter"],
  ["matrix_items_", "items"],
  ["attempt_history_", "history"],
  ["opened_gifts_", "set"],
  ["kept_bgs_", "set"],
  ["wheel_spins_", "wheel"]
];
// Joueurs supprimés : la liste ne fait que grandir, c'est ce qui empêche un autre appareil de les faire revenir
export const DELETED_PROFILES_KEY = "deleted_profiles";
const FAMILY_BY_NAME: Record<string, KeyFamily> = {
  user_profiles_v2: "profiles",
  [DELETED_PROFILES_KEY]: "set",
  active_profile_id_v2: "device",
  test_last_snapshot: "device",
  radio_last_heard: "device",
  brushing_last_heard: "device",
  radio_listen_tab: "device",
  brushing_listen_tab: "device",
  radio_players: "device",
  brushing_players: "device",
  // Son et voix dépendent du téléphone et de l'endroit où l'on joue
  answer_preferences: "device"
};

// La clé complète porte l'espace de stockage devant : « mult_clean_v3:points_<joueur> »
function nameOf(fullKey: string): string {
  return fullKey.slice(fullKey.indexOf(":") + 1);
}

// Toutes les données d'un joueur finissent par son identifiant
export function belongsToProfile(fullKey: string, profileId: string): boolean {
  return nameOf(fullKey).endsWith(`_${profileId}`);
}

export function familyOf(fullKey: string): KeyFamily {
  const name = nameOf(fullKey);
  if (FAMILY_BY_NAME[name]) return FAMILY_BY_NAME[name];
  return FAMILY_BY_PREFIX.find(([prefix]) => name.startsWith(prefix))?.[1] ?? "setting";
}

// Texte identique pour deux valeurs identiques, quel que soit l'ordre de leurs clés
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

// Les données propres à chaque appareil ne comptent pas pour dire si deux sauvegardes sont identiques
export function withoutDeviceKeys(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([key]) => familyOf(key) !== "device"));
}

export function counterVector(doc: SyncDoc, key: string): Record<string, number> {
  const vector = doc.sync.counters[key];
  if (vector) return vector;
  return typeof doc.data[key] === "number" ? { [LEGACY_DEVICE]: doc.data[key] as number } : {};
}

export function sumVector(vector: Record<string, number>): number {
  return Object.keys(vector)
    .sort()
    .reduce((total, device) => total + vector[device], 0);
}

// Départage deux valeurs de façon identique sur tous les appareils
function pickByText<T>(a: T, b: T): T {
  return canonical(a) >= canonical(b) ? a : b;
}

function mergeById<T extends { id: string }>(a: T[], b: T[], pick: (x: T, y: T) => T): T[] {
  const byId = new Map<string, T>();
  [...a, ...b].forEach((entry) => {
    const existing = byId.get(entry.id);
    byId.set(entry.id, existing ? pick(existing, entry) : entry);
  });
  return Array.from(byId.values());
}

function mergeProfiles(a: UserProfile[], b: UserProfile[]): UserProfile[] {
  return mergeById(a, b, pickByText).sort((x, y) => x.createdAt - y.createdAt || x.id.localeCompare(y.id));
}

// L'état du calcul est celui de l'appareil qui l'a travaillé en dernier ; un cadeau gagné reste gagné
function mergeItems(a: MultiplicationItem[], b: MultiplicationItem[]): MultiplicationItem[] {
  const pick = (x: MultiplicationItem, y: MultiplicationItem): MultiplicationItem => {
    const xTime = x.lastReviewedAt ?? -1;
    const yTime = y.lastReviewedAt ?? -1;
    const giftEarned = x.giftEarned === true || y.giftEarned === true;
    const winner = xTime !== yTime ? (xTime > yTime ? x : y) : pickByText({ ...x, giftEarned }, { ...y, giftEarned });
    return { ...winner, giftEarned };
  };
  return mergeById(a, b, pick).sort((x, y) => x.a - y.a || x.b - y.b);
}

function mergeHistory(a: AttemptLog[], b: AttemptLog[]): AttemptLog[] {
  return mergeById(a, b, pickByText)
    .sort((x, y) => y.timestamp - x.timestamp || y.id.localeCompare(x.id))
    .slice(0, HISTORY_LIMIT);
}

function mergeSet(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b])).sort();
}

function wheelDay(state: WheelDailyState): number {
  const [year, month, day] = state.date.split("-").map(Number);
  return year * 10000 + month * 100 + day;
}

function mergeWheel(a: WheelDailyState, b: WheelDailyState): WheelDailyState {
  if (wheelDay(a) !== wheelDay(b)) return wheelDay(a) > wheelDay(b) ? a : b;
  return a.usedSpins >= b.usedSpins ? a : b;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

// « local » est l'appareil qui fusionne : seules ses données propres (joueur connecté) passent devant celles du Drive
export function mergeDocs(local: SyncDoc, remote: SyncDoc): SyncDoc {
  const data: Record<string, unknown> = {};
  const counters: Record<string, Record<string, number>> = {};
  const times: Record<string, number> = {};
  const keys = Array.from(new Set([...Object.keys(local.data), ...Object.keys(remote.data)])).sort();

  for (const key of keys) {
    const inLocal = key in local.data;
    const inRemote = key in remote.data;
    const a = local.data[key];
    const b = remote.data[key];
    const family = familyOf(key);

    if (family === "counter") {
      const localVector = counterVector(local, key);
      const remoteVector = counterVector(remote, key);
      const vector: Record<string, number> = {};
      Array.from(new Set([...Object.keys(localVector), ...Object.keys(remoteVector)]))
        .sort()
        .forEach((device) => {
          // Une part nulle n'est pas écrite : deux sauvegardes qui disent la même chose restent identiques au caractère près
          const part = Math.max(localVector[device] ?? 0, remoteVector[device] ?? 0);
          if (part > 0) vector[device] = part;
        });
      counters[key] = vector;
      data[key] = sumVector(vector);
    } else if (family === "device") {
      data[key] = inLocal ? a : b;
    } else if (family === "setting") {
      const localTime = local.sync.times[key] ?? 0;
      const remoteTime = remote.sync.times[key] ?? 0;
      if (!inLocal || !inRemote) data[key] = inLocal ? a : b;
      else if (localTime !== remoteTime) data[key] = localTime > remoteTime ? a : b;
      else data[key] = pickByText(a, b);
      const time = Math.max(inLocal ? localTime : 0, inRemote ? remoteTime : 0);
      if (time > 0) times[key] = time;
    } else if (family === "profiles") {
      data[key] = mergeProfiles(asArray(a), asArray(b));
    } else if (family === "items") {
      data[key] = mergeItems(asArray(a), asArray(b));
    } else if (family === "history") {
      data[key] = mergeHistory(asArray(a), asArray(b));
    } else if (family === "set") {
      data[key] = mergeSet(asArray(a), asArray(b));
    } else {
      data[key] = !inLocal || !inRemote ? (inLocal ? a : b) : mergeWheel(a as WheelDailyState, b as WheelDailyState);
    }
  }

  // Un joueur supprimé quelque part l'est partout : la suppression l'emporte sur tout progrès fait ailleurs
  const tombstonesKey = keys.find((key) => nameOf(key) === DELETED_PROFILES_KEY);
  const deleted = tombstonesKey ? asArray<string>(data[tombstonesKey]) : [];
  if (deleted.length > 0) {
    Object.keys(data).forEach((key) => {
      if (familyOf(key) === "profiles") {
        data[key] = asArray<UserProfile>(data[key]).filter((profile) => !deleted.includes(profile.id));
      } else if (deleted.some((profileId) => belongsToProfile(key, profileId))) {
        delete data[key];
        delete counters[key];
        delete times[key];
      }
    });
  }

  return { data, sync: { lineage: local.sync.lineage || remote.sync.lineage, counters, times } };
}
