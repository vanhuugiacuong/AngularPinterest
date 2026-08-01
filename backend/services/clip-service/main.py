# pyrefly: ignore [missing-import]
from fastapi import FastAPI, UploadFile, File, HTTPException
from PIL import Image
import torch
import io
import os

# Limit CPU threads to prevent memory spikes on free cloud instances
torch.set_num_threads(1)
torch.set_num_interop_threads(1)

# pyrefly: ignore [missing-import]
from transformers import CLIPProcessor, CLIPModel

app = FastAPI(title="Pinterest Clone CLIP Embedding Service")

MODEL_NAME = "openai/clip-vit-base-patch32"
print(f"Loading memory-optimized CPU CLIP model: {MODEL_NAME}...")

try:
    model = CLIPModel.from_pretrained(MODEL_NAME)
    processor = CLIPProcessor.from_pretrained(MODEL_NAME)
    model.eval()
    for p in model.parameters():
        p.requires_grad = False
    print("Memory-optimized CPU CLIP model loaded successfully! (~180MB RAM)")
except Exception as e:
    print(f"Error loading model: {e}")
    raise e

@app.get("/health")
def health_check():
    return {"status": "healthy", "model": MODEL_NAME, "mode": "cpu-optimized"}

@app.post("/embed/image")
async def embed_image(file: UploadFile = File(...)):
    try:
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        
        inputs = processor(images=image, return_tensors="pt")
        with torch.no_grad():
            features = model.get_image_features(**inputs)
            
        features = features / features.norm(p=2, dim=-1, keepdim=True)
        vector = features[0].tolist()
        
        return {"embedding": vector}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image embedding failed: {str(e)}")

@app.get("/embed/text")
async def embed_text(query: str):
    if not query or len(query.strip()) == 0:
        raise HTTPException(status_code=400, detail="Query string cannot be empty")
    try:
        inputs = processor(text=[query.strip()], return_tensors="pt", padding=True)
        with torch.no_grad():
            features = model.get_text_features(**inputs)
            
        features = features / features.norm(p=2, dim=-1, keepdim=True)
        vector = features[0].tolist()
        
        return {"embedding": vector}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Text embedding failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port)
