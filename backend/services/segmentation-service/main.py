# pyrefly: ignore [missing-import]
from fastapi import FastAPI, UploadFile, File, HTTPException
# pyrefly: ignore [missing-import]
from fastapi.responses import Response
from PIL import Image
# pyrefly: ignore [missing-import]
from rembg import remove, new_session
# pyrefly: ignore [missing-import]
import numpy as np
# pyrefly: ignore [missing-import]
from scipy.ndimage import label, binary_dilation
import io
import os

app = FastAPI(title="Pinterest Clone Object Cutout Service")

# birefnet-general-lite: much higher-confidence matting than isnet-general-use on
# low-contrast subjects (e.g. light fur/paws against a light background) — isnet was
# producing a paw that faded to near-transparent (alpha ~26) in exactly that case,
# because it just wasn't confident there; birefnet kept it solid (~230). Costs ~8-13s
# per image instead of isnet's <1s and a 224MB model instead of 179MB, but cutout is a
# one-shot action (user crops, then clicks "cut"), not a real-time/interactive path, so
# the latency is an acceptable trade for cutouts that get shared publicly as pins.
# "general" (non-lite) is even better but ~19s and 973MB — not worth it over "-lite".
MODEL_NAME = "birefnet-general-lite"
print(f"Loading segmentation model: {MODEL_NAME}...")
session = new_session(MODEL_NAME)
print("Segmentation model loaded successfully!")


@app.get("/health")
def health_check():
    return {"status": "healthy", "model": MODEL_NAME}


# Alpha matting smooths edges but doesn't know the mask should be a single blob — it
# leaves faint, disconnected alpha (a misdetected shadow/reflection, or a "floating"
# patch in the gap between limbs) that reads as invisible on a white background but
# shows up as a grey smudge once the cutout is placed on anything else.
#
# Naively labeling connected components straight off the raw alpha (any alpha > ~0)
# doesn't work: alpha matting's own soft, low-confidence fringe (values in roughly the
# 1-20 range) often "bridges" a nearby stray blob to the real subject even though they
# read as visually separate — so a low bridging threshold lets genuine artifacts survive
# by hiding behind that fringe. Instead: label on a much stricter core_threshold (only
# confidently-foreground pixels count), keep the single largest core blob, then dilate
# that kept region outward by edge_margin_px so the subject's own soft/fuzzy edge
# (which IS attached to the core, just below core_threshold) is preserved. Anything
# outside the dilated keep-zone — including a blob that happens to be near the subject
# but not attached to its core — is zeroed.
def clean_mask(image: Image.Image, core_threshold: int = 25, edge_margin_px: int = 6) -> Image.Image:
    rgba = np.array(image.convert("RGBA"))
    alpha = rgba[:, :, 3]

    core = alpha > core_threshold
    labeled, num_features = label(core, structure=np.ones((3, 3)))
    if num_features == 0:
        return Image.fromarray(rgba, mode="RGBA")

    sizes = np.bincount(labeled.ravel())
    sizes[0] = 0  # label 0 is the background, never the subject
    largest_label = sizes.argmax()
    keep_zone = binary_dilation(labeled == largest_label, iterations=edge_margin_px)

    rgba[:, :, 3] = np.where(keep_zone, alpha, 0)
    return Image.fromarray(rgba, mode="RGBA")


@app.post("/segment")
async def segment(file: UploadFile = File(...)):
    """Cuts the main subject out of an image, returning a PNG with a
    transparent background (everything the model doesn't think is the
    foreground subject is made transparent)."""
    try:
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # Unlike isnet, birefnet's own sigmoid output is already a well-calibrated soft
        # mask — running rembg's alpha_matting on top of it hurts instead of helping
        # (tested: drops confident paw pixels from ~232 to ~150 alpha) and adds ~3s.
        result = remove(image, session=session, alpha_matting=False)

        result = clean_mask(result)

        buffer = io.BytesIO()
        result.save(buffer, format="PNG")
        return Response(content=buffer.getvalue(), media_type="image/png")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Object cutout failed: {str(e)}")


if __name__ == "__main__":
    # pyrefly: ignore [missing-import]
    import uvicorn
    port = int(os.getenv("PORT", 8002))
    uvicorn.run(app, host="0.0.0.0", port=port)
