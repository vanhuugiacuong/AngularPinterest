# pyrefly: ignore [missing-import]
from fastapi import FastAPI, UploadFile, File, HTTPException
# pyrefly: ignore [missing-import]
from fastapi.responses import Response
from PIL import Image
# pyrefly: ignore [missing-import]
from rembg import remove, new_session
import io
import os

app = FastAPI(title="Pinterest Clone Object Cutout Service")

# isnet-general-use: newer general-purpose segmentation model than u2net, with
# noticeably cleaner edges around fine detail (hair/fur, thin limbs). Loaded
# once and cached in memory so repeated requests don't reload weights from disk.
MODEL_NAME = "isnet-general-use"
print(f"Loading segmentation model: {MODEL_NAME}...")
session = new_session(MODEL_NAME)
print("Segmentation model loaded successfully!")


@app.get("/health")
def health_check():
    return {"status": "healthy", "model": MODEL_NAME}


@app.post("/segment")
async def segment(file: UploadFile = File(...)):
    """Cuts the main subject out of an image, returning a PNG with a
    transparent background (everything the model doesn't think is the
    foreground subject is made transparent)."""
    try:
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # Alpha matting refines the raw mask's edges (via PyMatting) instead of using it
        # as-is — this is what fixes halo/fuzzy edges around light fur and thin limbs,
        # and also decontaminates background color that bled into the subject's edge
        # pixels. Slower per-request than a raw mask, but the quality difference on
        # hair/fur edges is worth it for a cutout feature.
        result = remove(
            image,
            session=session,
            alpha_matting=True,
            alpha_matting_foreground_threshold=240,
            alpha_matting_background_threshold=10,
            alpha_matting_erode_size=10,
        )

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
