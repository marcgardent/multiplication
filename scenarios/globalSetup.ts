import fs from "node:fs";
import path from "node:path";
import { ScenarioSnapshot, SnapshotMeta } from "../src/testing/snapshots";
import { CATALOG } from "./catalog";
import { SNAPSHOT_DIR, STAGING_DIR } from "./harness";

export default function setup(): () => void {
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });
  fs.mkdirSync(STAGING_DIR, { recursive: true });

  return () => {
    const missing = CATALOG.filter((entry) => !fs.existsSync(path.join(STAGING_DIR, `${entry.id}.json`)));
    if (missing.length > 0) {
      // public/snapshots reste tel quel : un jeu incomplet ne remplace jamais un jeu complet
      throw new Error(`Snapshots non capturés : ${missing.map((entry) => entry.id).join(", ")}`);
    }

    const index: SnapshotMeta[] = CATALOG.map((entry) => {
      const raw = fs.readFileSync(path.join(STAGING_DIR, `${entry.id}.json`), "utf8");
      const { data: _data, ...meta } = JSON.parse(raw) as ScenarioSnapshot;
      return meta;
    });

    // Fichiers remplacés sur place : supprimer le dossier ferait perdre les snapshots à un `make dev` en cours
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const expected = new Set(["index.json", ...CATALOG.map((entry) => `${entry.id}.json`)]);
    for (const file of fs.readdirSync(SNAPSHOT_DIR)) {
      if (!expected.has(file)) fs.rmSync(path.join(SNAPSHOT_DIR, file));
    }
    for (const entry of CATALOG) {
      fs.copyFileSync(path.join(STAGING_DIR, `${entry.id}.json`), path.join(SNAPSHOT_DIR, `${entry.id}.json`));
    }
    fs.writeFileSync(path.join(SNAPSHOT_DIR, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
    fs.rmSync(STAGING_DIR, { recursive: true, force: true });
  };
}
