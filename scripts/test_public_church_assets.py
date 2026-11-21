"""Prevent private church artwork from re-entering public installer assets."""
import hashlib
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PRIVATE_IMAGES = {
    'EWC-White.png': 'cd480186cc252b973f57b42b662b18e0810ede348e44543c969b645b452d98a4',
    'MOMO111.png': '56511fccab4554f503bf84b20430f4ceb3c5b6811763a77894c9d34eda0d2ce1',
    'service-slides/closing-pastor-motion.png': '82501670b16ac9f2827f537774362f7ff9be43e36aecf384dcc1a7c0f8521846',
    'service-slides/ewc-adenta-welcome.png': '76d4d2df36c20054a5aa5d7115f8a4829c24a93378361a21a6f044d348f59d21',
    'service-slides/jesus-atmosphere.png': 'b16b6375936fe3cf61e662c72f3dc4b3ed8c1068bbfaa5e6cf6ce5a5ece417af',
    'service-slides/jesus-motion.png': 'a138032bbaaf9f58a33f4de497ba5769c2896d6b6093f88ad5eaa2b4568efca7',
    'service-slides/momo.png': '97ac470290466f0a2343d2c2b1fb9c1f276ca7ca082f983da297912c513a57e6',
    'service-slides/pastor-john-kennedy-starburst.png': '83286d4e22474787ace1bc35f1a4a921035fdb7b91cf18f0b5b069c7e52cac6b',
    'service-slides/pastor-john-kennedy.png': 'd020823764bffab7bee1db9cc31046b8f81bf218e3938b52738bd10c3e8b889f',
    'service-slides/welcome-motion.png': 'b75f1538f616571e4c1d2aa4f9e26e13b29df3f722843e472f059d0da8a9670c',
}

class PublicChurchAssetsTests(unittest.TestCase):
    def test_private_artwork_is_absent_from_public_and_built_assets(self):
        hashes = set(PRIVATE_IMAGES.values())
        for folder in (ROOT / "public", ROOT / "build"):
            if not folder.is_dir():
                continue
            for name in PRIVATE_IMAGES:
                self.assertFalse((folder / name).exists(), str(folder / name))
            for path in folder.rglob("*"):
                if path.is_file() and path.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"):
                    self.assertNotIn(hashlib.sha256(path.read_bytes()).hexdigest(), hashes, str(path))

    def test_neutral_fallbacks_exist_without_church_or_payment_details(self):
        for name in ("welcome-neutral.svg", "closing-neutral.svg", "jesus-neutral.svg", "giving-placeholder.svg"):
            text = (ROOT / "public" / "service-slides" / name).read_text().lower()
            self.assertIn("<svg", text)
            for private_detail in ("ewc", "adenta", "kennedy", "0240068152"):
                self.assertNotIn(private_detail, text)

if __name__ == "__main__":
    unittest.main()
