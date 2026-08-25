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

# u2net: general-purpose salient-object segmentation model. Loaded once and
# cached in memory so repeated requests don't reload weights from disk.
MODEL_NAME = "u2net"
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

        result = remove(image, session=session)

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
