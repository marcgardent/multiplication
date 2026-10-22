import { describe, expect, it } from "vitest";
import { RemoteVoice } from "../services/googleDriveService";
import { createMemoryStorage } from "../services/storageService";
import { createVoiceSync, planVoiceSync, VoiceDrive, VoiceRecords } from "./voiceSync";
import { VoiceRecord } from "./voiceStore";

// Faux Drive partagé par les appareils : un fichier par voix, avec sa date et son contenu
function fakeDrive() {
  const files = new Map<string, RemoteVoice & { content: string }>();
  let nextId = 1;
  const drive: VoiceDrive = {
    list: async () => [...files.values()].map(({ id, file, at, deleted }) => ({ id, file, at, deleted })),
    upload: async (_token, voice, existingId) => {
      const id = existingId ?? `f${nextId++}`;
      files.set(id, { id, file: voice.file, at: voice.at, deleted: !voice.wav, content: voice.wav ? await voice.wav.text() : "" });
    },
    download: async (_token, id) => new Blob([files.get(id)?.content ?? ""])
  };
  return { drive, files };
}

// Appareil : ses voix, et ce qu'il dit avoir enregistré ou retiré
function device(drive: VoiceDrive) {
  const records = new Map<string, VoiceRecord>();
  const voices: VoiceRecords = {
    records: async () => new Map(records),
    write: async (file, record) => {
      records.set(file, record);
    }
  };
  const sync = createVoiceSync({
    voices,
    drive,
    settings: createMemoryStorage(),
    getToken: () => "jeton",
    isEnabled: () => true,
    isOnline: () => true,
    debounceMs: 0
  });
  return {
    records,
    record(file: string, text: string, at: number) {
      records.set(file, { wav: new Blob([text]), at });
      sync.notifyLocalChange();
    },
    remove(file: string, at: number) {
      records.set(file, { wav: null, at });
      sync.notifyLocalChange();
    },
    sync: () => sync.requestCheck(),
    async text(file: string) {
      const wav = records.get(file)?.wav;
      return wav ? await wav.text() : null;
    }
  };
}

const Q78 = "/audio/q_7_8.mp3";

describe("Règle de fusion des voix", () => {
  it("la plus récente l'emporte, dans un sens comme dans l'autre ; à date égale, rien ne bouge", () => {
    const local = new Map([["a", { at: 5 }], ["b", { at: 1 }], ["c", { at: 3 }], ["d", { at: 2 }]]);
    const remote = new Map([["a", { at: 4 }], ["b", { at: 9 }], ["c", { at: 3 }], ["e", { at: 1 }]]);
    expect(planVoiceSync(local, remote)).toEqual({ upload: ["a", "d"], download: ["b", "e"] });
  });
});

describe("Voix entre deux appareils", () => {
  it("une voix enregistrée sur un appareil arrive sur l'autre", async () => {
    const { drive } = fakeDrive();
    const a = device(drive);
    const b = device(drive);
    a.record(Q78, "voix de papa", 100);
    await a.sync();
    await b.sync();
    expect(await b.text(Q78)).toBe("voix de papa");
    expect(b.records.get(Q78)?.at).toBe(100);
  });

  it("la plus récente gagne quand les deux appareils ont enregistré la même voix", async () => {
    const { drive } = fakeDrive();
    const a = device(drive);
    const b = device(drive);
    a.record(Q78, "ancienne", 100);
    b.record(Q78, "nouvelle", 200);
    await a.sync();
    await b.sync();
    await a.sync();
    expect(await a.text(Q78)).toBe("nouvelle");
    expect(await b.text(Q78)).toBe("nouvelle");
  });

  it("même dans l'ordre inverse : l'ancienne n'écrase pas la nouvelle déjà dans le Drive", async () => {
    const { drive } = fakeDrive();
    const a = device(drive);
    const b = device(drive);
    b.record(Q78, "nouvelle", 200);
    await b.sync();
    a.record(Q78, "ancienne", 100);
    await a.sync();
    expect(await a.text(Q78)).toBe("nouvelle");
  });

  it("un retour à la voix de synthèse se propage, et une voix retirée ne revient pas d'un autre appareil", async () => {
    const { drive } = fakeDrive();
    const a = device(drive);
    const b = device(drive);
    a.record(Q78, "voix de papa", 100);
    await a.sync();
    await b.sync();
    b.remove(Q78, 300);
    await b.sync();
    await a.sync();
    expect(await a.text(Q78)).toBeNull();
    // A se resynchronise encore : sa voix plus ancienne ne repart pas
    await a.sync();
    await b.sync();
    expect(await b.text(Q78)).toBeNull();
  });

  it("un réenregistrement après un retrait l'emporte sur le retrait", async () => {
    const { drive } = fakeDrive();
    const a = device(drive);
    const b = device(drive);
    a.remove(Q78, 300);
    await a.sync();
    b.record(Q78, "de nouveau", 400);
    await b.sync();
    await a.sync();
    expect(await a.text(Q78)).toBe("de nouveau");
  });

  it("n'envoie rien quand rien n'a changé", async () => {
    const { drive, files } = fakeDrive();
    const a = device(drive);
    a.record(Q78, "voix", 100);
    await a.sync();
    const before = JSON.stringify([...files.values()]);
    await a.sync();
    expect(JSON.stringify([...files.values()])).toBe(before);
    expect(files.size).toBe(1);
  });

  it("garde un seul fichier par voix, même réenregistrée plusieurs fois", async () => {
    const { drive, files } = fakeDrive();
    const a = device(drive);
    for (let at = 1; at <= 3; at++) {
      a.record(Q78, `prise ${at}`, at);
      await a.sync();
    }
    expect(files.size).toBe(1);
  });
});

describe("Sans connexion Google", () => {
  it("attend un jeton sans rien perdre, puis envoie", async () => {
    const { drive, files } = fakeDrive();
    let token: string | null = null;
    const records = new Map<string, VoiceRecord>([[Q78, { wav: new Blob(["voix"]), at: 1 }]]);
    const sync = createVoiceSync({
      voices: { records: async () => records, write: async () => undefined },
      drive,
      settings: createMemoryStorage(),
      getToken: () => token,
      isEnabled: () => true,
      isOnline: () => true,
      debounceMs: 0
    });
    sync.notifyLocalChange();
    await sync.run();
    expect(files.size).toBe(0);
    token = "jeton";
    await sync.run();
    expect(files.size).toBe(1);
  });
});
