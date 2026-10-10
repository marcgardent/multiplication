#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10,<3.14"
# dependencies = [
#     "piper-tts>=1.8",
#     "lameenc>=1.8",
# ]
# ///

import json
import sys
from pathlib import Path

import lameenc
from piper import PiperVoice, SynthesisConfig
from piper.download_voices import download_voice

# Voix française Piper, synthétisée sur la machine : aucun service en ligne.
# Le modèle est téléchargé une seule fois dans scripts/.voices/.
# Changer un de ces réglages régénère tous les fichiers.
VOICE = "fr_FR-siwis-medium"
# Durée des sons : au-dessus de 1 la diction ralentit
LENGTH_SCALE = 1.0
# Niveau de la voix, de 0 à 1 : à 1 elle couvre les sons de l'application
VOLUME = 0.6
# Silence ajouté après chaque phrase, pour qu'elle ne soit pas coupée net
TAIL_SILENCE_MS = 300
MP3_BITRATE_KBPS = 64

VOICES_DIR = Path(__file__).parent / ".voices"
OUTPUT_DIR = Path(__file__).parent.parent / "public" / "audio"
MANIFEST_FILE = OUTPUT_DIR / "index.json"

# Félicitations dites à la roue et à l'ouverture d'un cadeau, une tirée au hasard.
# Clé = nom du fichier (cheer_<clé>.mp3), valeur = phrase prononcée.
# Ajouter, modifier ou retirer une ligne puis lancer `make audio`.
CHEERS = {
    "bravo": "Bravo !",
    "felicitations": "Félicitations !",
    "genial": "Génial !",
    "magnifique": "Magnifique !",
    "super": "Super !",
    "excellent": "Excellent !",
    "formidable": "Formidable !",
    "fantastique": "Fantastique !",
    "incroyable": "Incroyable !",
    "merveilleux": "Merveilleux !",
    "youpi": "Youpi !",
    "hourra": "Hourra !",
}

# Phrases dites par les modes d'écoute (brossage de dents).
# Clé = nom du fichier (phrase_<clé>.mp3), valeur = phrase prononcée.
PHRASES = {
    "brossage_debut": "Début du brossage des dents.",
    "brossage_fin": "Fin du brossage des dents.",
}

VOICE_SETTINGS = {
    "name": VOICE,
    "lengthScale": LENGTH_SCALE,
    "volume": VOLUME,
    "tailSilenceMs": TAIL_SILENCE_MS,
}


def load_baked_texts() -> dict[str, str]:
    """Phrase déjà enregistrée pour chaque fichier, si le manifeste précédent utilise la même voix."""
    if not MANIFEST_FILE.exists():
        return {}
    with open(MANIFEST_FILE, encoding="utf-8") as f:
        previous = json.load(f)
    if previous.get("voice") != VOICE_SETTINGS:
        return {}
    return {
        entry["file"].rsplit("/", 1)[-1]: entry["text"]
        for section in ("questions", "answers", "cheers", "phrases")
        for entry in previous.get(section, {}).values()
    }


def load_voice() -> PiperVoice:
    VOICES_DIR.mkdir(parents=True, exist_ok=True)
    model_path = VOICES_DIR / f"{VOICE}.onnx"
    if not model_path.exists():
        print(f"Téléchargement de la voix {VOICE} (une seule fois)...")
    download_voice(VOICE, VOICES_DIR)
    return PiperVoice.load(model_path)


def generate_speech(voice: PiperVoice, text: str, output_path: Path):
    chunks = list(voice.synthesize(text, SynthesisConfig(length_scale=LENGTH_SCALE, volume=VOLUME)))
    sample_rate = chunks[0].sample_rate
    speech = b"".join(chunk.audio_int16_bytes for chunk in chunks)
    tail = bytes(2 * (sample_rate * TAIL_SILENCE_MS // 1000))

    encoder = lameenc.Encoder()
    encoder.set_bit_rate(MP3_BITRATE_KBPS)
    encoder.set_in_sample_rate(sample_rate)
    encoder.set_channels(1)
    encoder.set_quality(2)
    encoder.silence()
    mp3 = encoder.encode(speech + tail) + encoder.flush()

    # Écriture dans un fichier provisoire : un échec ne doit pas abîmer l'audio existant
    partial_path = output_path.with_name(output_path.name + ".part")
    try:
        partial_path.write_bytes(mp3)
        partial_path.replace(output_path)
    finally:
        partial_path.unlink(missing_ok=True)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        "voice": VOICE_SETTINGS,
        "questions": {},
        "answers": {},
        "cheers": {},
        "phrases": {}
    }
    baked_texts = load_baked_texts()

    print(f"🎙️ Génération audio Piper ({VOICE}) dans {OUTPUT_DIR}...")
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

    # 3. Génération des félicitations
    for key, text in CHEERS.items():
        filename = f"cheer_{key}.mp3"
        manifest["cheers"][key] = {
            "file": f"/audio/{filename}",
            "text": text
        }
        tasks.append((text, OUTPUT_DIR / filename))

    # 4. Génération des phrases des modes d'écoute
    for key, text in PHRASES.items():
        filename = f"phrase_{key}.mp3"
        manifest["phrases"][key] = {
            "file": f"/audio/{filename}",
            "text": text
        }
        tasks.append((text, OUTPUT_DIR / filename))

    # On ne régénère que les fichiers absents ou dont la phrase a changé
    total_files = len(tasks)
    tasks = [
        (text, path) for text, path in tasks
        if not path.exists() or path.stat().st_size == 0 or baked_texts.get(path.name) != text
    ]
    print(f"{total_files} fichiers audio (100 questions + {len(unique_results)} réponses + {len(CHEERS)} félicitations + {len(PHRASES)} phrases), {len(tasks)} à générer")

    if tasks:
        try:
            voice = load_voice()
            for done, (text, path) in enumerate(tasks, start=1):
                generate_speech(voice, text, path)
                if done % 20 == 0 or done == len(tasks):
                    print(f"Progression : {done}/{len(tasks)} fichiers traités...")
        except Exception as error:
            # Le manifeste n'est pas réécrit : les phrases en attente seront retentées au prochain lancement
            sys.exit(f"❌ La synthèse vocale a échoué.\n   {type(error).__name__}: {error}")

    # Une félicitation retirée de la liste perd son fichier
    for stale in OUTPUT_DIR.glob("cheer_*.mp3"):
        if stale.stem.removeprefix("cheer_") not in CHEERS:
            stale.unlink()
            print(f"Supprimé : {stale.name}")

    # Même règle pour une phrase retirée
    for stale in OUTPUT_DIR.glob("phrase_*.mp3"):
        if stale.stem.removeprefix("phrase_") not in PHRASES:
            stale.unlink()
            print(f"Supprimé : {stale.name}")

    # Sauvegarder le manifeste JSON
    with open(MANIFEST_FILE, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print("✅ Tous les fichiers audios et le fichier index.json sont à jour.")


if __name__ == "__main__":
    main()
