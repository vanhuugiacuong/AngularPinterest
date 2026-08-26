# pyrefly: ignore [missing-import]
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
# pyrefly: ignore [missing-import]
from transformers import CLIPProcessor, CLIPModel
from PIL import Image, ImageStat
# pyrefly: ignore [missing-import]
import torch
import io
import os


def _color_stats(image: "Image.Image"):
    """Mean RGB (0-255) + how flat the region is (max per-channel stddev).
    A low `color_std` means a near-solid patch, where CLIP is blind to hue and
    crop search should rank by colour instead."""
    stat = ImageStat.Stat(image)
    mean = [int(round(c)) for c in stat.mean[:3]]
    color_std = round(max(stat.stddev[:3]), 1)
    return mean, color_std


def _crop_to_box(image: "Image.Image", box: str) -> "Image.Image":
    """Crop `image` to a sub-region for crop / "Pinterest Lens" style search.

    `box` is "x,y,w,h" where each value is a fraction (0..1) of the image's own
    width/height. Values are clamped and a minimum 8px box is enforced so a tiny
    or inverted selection still yields a valid image to embed.
    """
    try:
        x, y, w, h = (float(v) for v in box.split(","))
    except ValueError:
        raise HTTPException(status_code=400, detail="box must be 'x,y,w,h' fractions")

    W, H = image.size
    left = max(0, min(int(round(x * W)), W - 1))
    top = max(0, min(int(round(y * H)), H - 1))
    right = max(left + 8, min(int(round((x + w) * W)), W))
    bottom = max(top + 8, min(int(round((y + h) * H)), H))
    return image.crop((left, top, right, bottom))

app = FastAPI(title="Pinterest Clone CLIP Embedding Service")

# Load model and processor globally on startup (cached in memory)
MODEL_NAME = "openai/clip-vit-base-patch32"
print(f"Loading CLIP model: {MODEL_NAME}...")
try:
    model = CLIPModel.from_pretrained(MODEL_NAME)
    processor = CLIPProcessor.from_pretrained(MODEL_NAME)
    model.eval()
    print("CLIP Model loaded successfully!")
except Exception as e:
    print(f"Error loading model: {e}")
    raise e

def _to_tensor(features):
    if hasattr(features, "pooler_output") and features.pooler_output is not None:
        return features.pooler_output
    if hasattr(features, "image_embeds") and features.image_embeds is not None:
        return features.image_embeds
    if hasattr(features, "text_embeds") and features.text_embeds is not None:
        return features.text_embeds
    if isinstance(features, torch.Tensor):
        return features
    return features[0]

@app.get("/health")
def health_check():
    return {"status": "healthy", "model": MODEL_NAME}

@app.post("/embed/image")
async def embed_image(file: UploadFile = File(...), box: str | None = Form(default=None)):
    try:
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # Optional crop: embed only the selected sub-region (crop search)
        if box:
            image = _crop_to_box(image, box)

        # Process image through CLIP model
        inputs = processor(images=image, return_tensors="pt")
        with torch.no_grad():
            features = model.get_image_features(**inputs)
            features = _to_tensor(features)

        # Normalize vector to unit length
        features = features / features.norm(p=2, dim=-1, keepdim=True)
        vector = features[0].tolist()  # 512-dimensional array

        avg_color, color_std = _color_stats(image)
        return {"embedding": vector, "avg_color": avg_color, "color_std": color_std}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image embedding failed: {str(e)}")

@app.get("/embed/text")
async def embed_text(query: str):
    if not query or len(query.strip()) == 0:
        raise HTTPException(status_code=400, detail="Query string cannot be empty")
    try:
        # Process text query through CLIP model
        inputs = processor(text=[query], return_tensors="pt", padding=True)
        with torch.no_grad():
            features = model.get_text_features(**inputs)
            features = _to_tensor(features)
            
        # Normalize vector to unit length
        features = features / features.norm(p=2, dim=-1, keepdim=True)
        vector = features[0].tolist()  # 512-dimensional array
        
        return {"embedding": vector}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Text embedding failed: {str(e)}")


# Zero-shot animal detection reusing the CLIP model already loaded above —
# compares the image's embedding against a "contains an animal" prompt and
# a "no animal" prompt, no extra model/weights needed.
ANIMAL_PROMPT = "a photo of an animal, pet, or wildlife"
NO_ANIMAL_PROMPT = "a photo with no animal, only people or objects"

@app.post("/detect/animal")
async def detect_animal(file: UploadFile = File(...)):
    try:
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        inputs = processor(
            text=[ANIMAL_PROMPT, NO_ANIMAL_PROMPT],
            images=image,
            return_tensors="pt",
            padding=True,
        )
        with torch.no_grad():
            outputs = model(**inputs)
            probs = outputs.logits_per_image.softmax(dim=1)[0]

        animal_score = probs[0].item()
        return {"hasAnimal": animal_score >= 0.5, "animalScore": animal_score}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Animal detection failed: {str(e)}")

if __name__ == "__main__":
    # pyrefly: ignore [missing-import]
    import uvicorn
    port = int(os.getenv("PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port)
