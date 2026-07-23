import sys
from pathlib import Path

MODELS_DIR  = Path(__file__).parent / "models"
DINOV3_NAME = "facebook/dinov3-convnext-base-pretrain-lvd1689m"
TARGET      = MODELS_DIR / "dinov3-convnext-base"

REQUIRED = ["config.json", "preprocessor_config.json", "model.safetensors"]

def main():
    MODELS_DIR.mkdir(exist_ok=True)

    if TARGET.exists() and all((TARGET / f).exists() for f in REQUIRED):
        print(f"✓ dinov3 snapshot already in models/, nothing to do")
        return

    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        sys.exit("huggingface_hub not installed. run: pip install huggingface_hub")

    print(f"downloading {DINOV3_NAME} (gated repo, needs `hf auth login` first)...")
    try:
        snapshot_download(
            repo_id=DINOV3_NAME,
            local_dir=TARGET,
            allow_patterns=["*.json", "*.safetensors", "*.txt"], 
        )
    except Exception as e:
        sys.exit(f"download failed: {e}")

    missing = [f for f in REQUIRED if not (TARGET / f).exists()]
    if missing:
        sys.exit(f"downloaded but missing {missing}. the backend won't start offline without these")

    print(f"✓ dinov3 ready at {TARGET}")

if __name__ == "__main__":
    main()