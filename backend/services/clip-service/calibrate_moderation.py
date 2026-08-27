"""Print the moderation score every image in two folders gets, so the
NSFW_LOGIT_SCALE / NSFW_THRESHOLD pair can be chosen from real data instead of
guessed.

The point of the two folders is the SEPARATION between them, not the absolute
numbers: a good setting is one where the highest "safe" score sits clearly below
the lowest "unsafe" score, and the threshold goes in the gap. If the two ranges
overlap, no threshold can separate them and the fix is better prompts (see
SAFE_LABELS / NSFW_LABELS in main.py), not a different number.

Usage, with the clip-service NOT required to be running (this imports the
scoring path directly):

    python calibrate_moderation.py ./samples/safe ./samples/unsafe

Put images that were being wrongly rejected (bikini, lingerie, suggestive but
clothed) in the first folder, and genuinely explicit ones in the second.
"""

from __future__ import annotations

import sys
from pathlib import Path

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def score_folder(folder: Path, score_image) -> list[tuple[str, float]]:
    results: list[tuple[str, float]] = []
    for path in sorted(folder.iterdir()):
        if path.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        try:
            results.append((path.name, score_image(path.read_bytes())))
        except Exception as error:  # noqa: BLE001 - one bad file must not stop the run
            print(f"  !! {path.name}: {error}")
    return results


def report(label: str, results: list[tuple[str, float]]) -> tuple[float, float] | None:
    print(f"\n=== {label} ({len(results)} ảnh) ===")
    if not results:
        print("  (không có ảnh nào)")
        return None
    for name, score in sorted(results, key=lambda row: row[1]):
        print(f"  {score:.4f}  {name}")
    scores = [score for _, score in results]
    lo, hi = min(scores), max(scores)
    print(f"  -> thấp nhất {lo:.4f} | cao nhất {hi:.4f}")
    return lo, hi


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2

    safe_dir, unsafe_dir = Path(sys.argv[1]), Path(sys.argv[2])
    for folder in (safe_dir, unsafe_dir):
        if not folder.is_dir():
            print(f"Không phải thư mục: {folder}")
            return 2

    # Imported here, after argument validation, because loading the CLIP model
    # takes a while and there is no point paying that for a usage error.
    from main import NSFW_LOGIT_SCALE, NSFW_THRESHOLD, score_image_bytes

    print(f"NSFW_LOGIT_SCALE = {NSFW_LOGIT_SCALE}")
    print(f"NSFW_THRESHOLD   = {NSFW_THRESHOLD}")

    safe_range = report("AN TOÀN (không được chặn)", score_folder(safe_dir, score_image_bytes))
    unsafe_range = report("KHÔNG AN TOÀN (phải chặn)", score_folder(unsafe_dir, score_image_bytes))

    if not safe_range or not unsafe_range:
        return 0

    safe_hi, unsafe_lo = safe_range[1], unsafe_range[0]
    print("\n=== Kết luận ===")
    if safe_hi < unsafe_lo:
        suggested = (safe_hi + unsafe_lo) / 2
        print(f"Hai nhóm TÁCH RỜI: safe cao nhất {safe_hi:.4f} < unsafe thấp nhất {unsafe_lo:.4f}")
        print(f"Đặt NSFW_THRESHOLD = {suggested:.2f} (giữa khoảng trống)")
    else:
        print(f"Hai nhóm CHỒNG NHAU: safe cao nhất {safe_hi:.4f} >= unsafe thấp nhất {unsafe_lo:.4f}")
        print("Không có ngưỡng nào tách được. Cần sửa prompt trong SAFE_LABELS /")
        print("NSFW_LABELS ở main.py, hoặc hạ NSFW_LOGIT_SCALE để score giãn ra.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
