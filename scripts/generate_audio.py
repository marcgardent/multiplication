#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "edge-tts>=6.1.19",
#     "asyncio",
# ]
# ///

import asyncio
import json
from pathlib import Path
import edge_tts

# Voix neuronale française haute fidélité
VOICE = "fr-FR-DeniseNeural"
RATE = "+0%"
VOLUME = "+0%"

OUTPUT_DIR = Path(__file__).parent.parent / "public" / "audio"

async def generate_speech(text: str, output_path: Path):
    if output_path.exists() and output_path.stat().st_size > 0:
        return
    communicate = edge_tts.Communicate(text, voice=VOICE, rate=RATE, volume=VOLUME)
    await communicate.save(str(output_path))

async def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        "questions": {},
        "answers": {}
    }

    print(f"🎙️ Génération audio TTS Français ({VOICE}) dans {OUTPUT_DIR}...")
    tasks = []

    # 1. Génération des 100 questions : "{a} fois {b}"
    for a in range(1, 11):
        for b in range(1, 11):
            key = f"{a}x{b}"
            filename = f"q_{a}_{b}.mp3"
            filepath = OUTPUT_DIR / filename
            text = f"{a} fois {b}"
            manifest["questions"][key] = {
                "file": f"/audio/{filename}",
                "text": text,
                "a": a,
                "b": b
            }
            tasks.append((text, filepath))

    # 2. Génération des réponses uniques pour les tables de 1 à 10
    unique_results = sorted({a * b for a in range(1, 11) for b in range(1, 11)})
    for res in unique_results:
        filename = f"ans_{res}.mp3"
        filepath = OUTPUT_DIR / filename
        text = str(res)
        manifest["answers"][str(res)] = {
            "file": f"/audio/{filename}",
            "text": text,
            "val": res
        }
        tasks.append((text, filepath))

    print(f"Total fichiers audio à générer : {len(tasks)} (100 questions + {len(unique_results)} réponses uniques)")

    # Limiter la concurrence pour être poli avec l'API
    semaphore = asyncio.Semaphore(5)

    async def sem_generate(text: str, path: Path):
        async with semaphore:
            await generate_speech(text, path)

    done = 0
    total = len(tasks)
    batch_size = 20
    for i in range(0, total, batch_size):
        batch = tasks[i:i + batch_size]
        await asyncio.gather(*(sem_generate(text, path) for text, path in batch))
        done += len(batch)
        print(f"Progression : {done}/{total} fichiers traités...")

    # Sauvegarder le manifeste JSON
    manifest_file = OUTPUT_DIR / "index.json"
    with open(manifest_file, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print(f"✅ Tous les fichiers audios et le fichier index.json ont été générés avec succès !")

if __name__ == "__main__":
    asyncio.run(main())
