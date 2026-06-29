import shutil
import sys
from pathlib import Path

MODELS_DIR = Path(__file__).parent / "models"
SAM_NAME   = "sam2.1_t.pt"
TARGET     = MODELS_DIR / SAM_NAME

def main():
    MODELS_DIR.mkdir(exist_ok=True)

    if TARGET.exists():
        print(f"✓ {SAM_NAME} already in models/, nothing to do")
        return

    try:
        from ultralytics import SAM
    except ImportError:
        sys.exit("ultralytics not installed. run: pip install ultralytics")

    print(f"downloading {SAM_NAME} via ultralytics (resolves the correct release automatically)...")
    SAM(SAM_NAME)

    from ultralytics.utils import SETTINGS
    candidates = [Path(SAM_NAME), Path(SETTINGS["weights_dir"]) / SAM_NAME]
    src = next((c for c in candidates if c.exists()), None)
    if src is None:
        sys.exit(f"downloaded but couldn't locate {SAM_NAME}. check {candidates}")

    shutil.move(src, TARGET)
    print(f"✓ {SAM_NAME} ready at {TARGET}")

if __name__ == "__main__":
    main()
