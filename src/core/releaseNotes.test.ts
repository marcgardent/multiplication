import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import { compareVersions, notesSince, notesToShow, notesUpTo, RELEASE_NOTES, seriesOf, VERSION_HISTORY } from "./releaseNotes";

describe("Nouveautés", () => {
  it("la version publiée a sa ligne d'historique, et sa série sa note : on les écrit en montant la version", () => {
    expect(VERSION_HISTORY.map((entry) => entry.version)).toContain(packageJson.version);
    expect(RELEASE_NOTES.map((note) => note.series)).toContain(seriesOf(packageJson.version));
  });

  it("l'historique et les notes vont du plus récent au plus ancien, sans doublon", () => {
    for (let i = 1; i < VERSION_HISTORY.length; i++) {
      expect(compareVersions(VERSION_HISTORY[i - 1].version, VERSION_HISTORY[i].version)).toBeGreaterThan(0);
    }
    for (let i = 1; i < RELEASE_NOTES.length; i++) {
      expect(compareVersions(RELEASE_NOTES[i - 1].series, RELEASE_NOTES[i].series)).toBeGreaterThan(0);
    }
    RELEASE_NOTES.forEach((note) => expect(note.title.length).toBeGreaterThan(0));
  });

  it("chaque série de l'historique a sa note de version majeure", () => {
    const series = new Set(VERSION_HISTORY.map((entry) => seriesOf(entry.version)));
    expect([...series].sort()).toEqual(RELEASE_NOTES.map((note) => note.series).sort());
  });

  it("compare les versions nombre par nombre", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.7", "1.8")).toBeLessThan(0);
    expect(compareVersions("1.7.5", "1.7.5")).toBe(0);
  });

  it("seules les versions majeures parues depuis la dernière vue s'affichent", () => {
    expect(notesSince("1.6.0", "1.8.0").map((n) => n.series)).toEqual(["1.8", "1.7"]);
    // Une version corrective ne montre rien de nouveau
    expect(notesSince("1.7.2", "1.7.4")).toEqual([]);
  });

  it("l'historique de l'application s'arrête à la version installée", () => {
    expect(notesUpTo("1.7.4")[0].series).toBe("1.7");
    expect(notesUpTo("1.7.4").at(-1)?.series).toBe("1.0");
  });

  it("rien à la toute première ouverture ; les deux dernières versions majeures pour une famille qui utilisait déjà l'application", () => {
    expect(notesToShow(null, "1.8.0", false)).toEqual([]);
    expect(notesToShow(null, "1.8.0", true).map((n) => n.series)).toEqual(["1.8", "1.7"]);
    expect(notesToShow("1.7.4", "1.8.0", true).map((n) => n.series)).toEqual(["1.8"]);
  });
});
