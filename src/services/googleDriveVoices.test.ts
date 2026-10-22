import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadDriveVoice, listDriveVoices, uploadDriveVoice } from "./googleDriveService";

function stubFetch(responses: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const body = responses.shift();
    return new Response(body instanceof Blob ? body : JSON.stringify(body ?? {}), { status: 200 });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Voix dans le Drive", () => {
  it("crée le fichier d'une voix dans le dossier caché, avec sa date dans ses propriétés", async () => {
    const calls = stubFetch([{ id: "f1" }]);
    await uploadDriveVoice("jeton", { file: "/audio/q_7_8.mp3", at: 1234, wav: new Blob(["RIFF"]) }, null);

    expect(calls[0].url).toContain("upload/drive/v3/files?uploadType=multipart");
    expect(calls[0].init.method).toBe("POST");
    const body = await (calls[0].init.body as Blob).text();
    expect(body).toContain('"name":"voix_q_7_8.wav"');
    expect(body).toContain('"parents":["appDataFolder"]');
    expect(body).toContain('"appProperties":{"voice":"/audio/q_7_8.mp3","at":"1234","deleted":"0"}');
    expect(body).toContain("Content-Type: audio/wav\r\n\r\nRIFF");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer jeton");
  });

  it("remplace le fichier existant ; un retrait est un fichier vide marqué supprimé", async () => {
    const calls = stubFetch([{ id: "f1" }]);
    await uploadDriveVoice("jeton", { file: "/audio/q_7_8.mp3", at: 99, wav: null }, "f1");

    expect(calls[0].url).toContain("/files/f1?uploadType=multipart");
    expect(calls[0].init.method).toBe("PATCH");
    const body = await (calls[0].init.body as Blob).text();
    expect(body).not.toContain('"name"');
    expect(body).toContain('"deleted":"1"');
  });

  it("liste les voix sur plusieurs pages, sans les autres fichiers", async () => {
    const calls = stubFetch([
      { nextPageToken: "p2", files: [{ id: "f1", appProperties: { voice: "/audio/q_7_8.mp3", at: "5", deleted: "0" } }] },
      { files: [{ id: "f2", appProperties: { voice: "/audio/ans_56.mp3", at: "7", deleted: "1" } }, { id: "f3" }] }
    ]);
    const voices = await listDriveVoices("jeton");

    expect(voices).toEqual([
      { id: "f1", file: "/audio/q_7_8.mp3", at: 5, deleted: false },
      { id: "f2", file: "/audio/ans_56.mp3", at: 7, deleted: true }
    ]);
    expect(calls[0].url).toContain("spaces=appDataFolder");
    expect(calls[1].url).toContain("pageToken=p2");
  });

  it("télécharge le son d'une voix", async () => {
    stubFetch([new Blob(["RIFF-son"])]);
    expect(await (await downloadDriveVoice("jeton", "f1")).text()).toBe("RIFF-son");
  });
});
