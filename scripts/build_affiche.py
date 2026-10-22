#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "segno>=1.6",
# ]
# ///

"""Affiche A4 de l'application : PDF à imprimer et aperçu pour la page d'accueil.

La source est scripts/affiche/affiche.html ; ce script y met le QR code de l'adresse du site,
puis la fait imprimer par Chrome sans fenêtre. Lancé par `make affiche`.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

import segno

URL = "https://marcgardent.github.io/multiplication/"
URL_SHORT = "marcgardent.github.io/multiplication"
# Marge blanche autour du QR code, en modules : le cadre blanc de l'affiche complète la zone calme
QR_BORDER = 2

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "scripts" / "affiche" / "affiche.html"
# La page remplie reste à côté de la source : la police y est référencée par un chemin relatif
FILLED = ROOT / "scripts" / "affiche" / "affiche.build.html"
PDF = ROOT / "public" / "affiche-multiplication.pdf"
PREVIEW = ROOT / "public" / "affiche-multiplication.png"
# Largeur de l'aperçu en pixels : assez pour la page d'accueil, même sur un écran à haute densité
PREVIEW_WIDTH = 600


def qr_path(url: str) -> tuple[int, str]:
    """Un carré par module sombre : un tracé plein, net à toutes les tailles d'impression."""
    qr = segno.make(url, error="m")
    size = qr.symbol_size(border=QR_BORDER)[0]
    squares = [
        f"M{x} {y}h1v1h-1z"
        for y, row in enumerate(qr.matrix_iter(border=QR_BORDER))
        for x, dark in enumerate(row)
        if dark
    ]
    return size, "".join(squares)


def find_chrome() -> str:
    for name in (os.environ.get("CHROME"), "google-chrome", "chromium", "chromium-browser"):
        if name and shutil.which(name):
            return shutil.which(name)
    sys.exit("Chrome introuvable : installez-le ou indiquez son chemin dans la variable CHROME.")


def chrome(*args: str) -> None:
    subprocess.run(
        [find_chrome(), "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", *args, FILLED.as_uri()],
        check=True,
        capture_output=True,
    )


def main() -> None:
    size, path = qr_path(URL)
    html = SOURCE.read_text(encoding="utf-8")
    for key, value in {"QR_SIZE": str(size), "QR_PATH": path, "URL_SHORT": URL_SHORT, "URL": URL}.items():
        html = html.replace("{{" + key + "}}", value)
    FILLED.write_text(html, encoding="utf-8")

    try:
        chrome(f"--print-to-pdf={PDF}", "--no-pdf-header-footer", "--virtual-time-budget=3000")
    finally:
        FILLED.unlink(missing_ok=True)

    # Aperçu tiré du PDF lui-même : identique à ce qui s'imprime (pdftoppm, du paquet poppler-utils)
    if not shutil.which("pdftoppm"):
        sys.exit("pdftoppm introuvable : installez poppler-utils.")
    subprocess.run(
        ["pdftoppm", "-png", "-singlefile", "-scale-to-x", str(PREVIEW_WIDTH), "-scale-to-y", "-1", str(PDF), str(PREVIEW.with_suffix(""))],
        check=True,
    )

    print(f"{PDF.relative_to(ROOT)} ({PDF.stat().st_size // 1024} Ko)")
    print(f"{PREVIEW.relative_to(ROOT)} ({PREVIEW.stat().st_size // 1024} Ko)")


if __name__ == "__main__":
    main()
