# pyrefly: ignore [missing-import]
from fastapi import FastAPI, UploadFile, File, HTTPException
# pyrefly: ignore [missing-import]
from transformers import CLIPProcessor, CLIPModel
from PIL import Image
# pyrefly: ignore [missing-import]
import torch
import io
import os

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

@app.get("/health")
def health_check():
    return {"status": "healthy", "model": MODEL_NAME}

@app.post("/embed/image")
async def embed_image(file: UploadFile = File(...)):
    try:
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        
        # Process image through CLIP model
        inputs = processor(images=image, return_tensors="pt")
        with torch.no_grad():
            features = model.get_image_features(**inputs)
            
        # Normalize vector to unit length
        features = features / features.norm(p=2, dim=-1, keepdim=True)
        vector = features[0].tolist()  # 512-dimensional array
        
        return {"embedding": vector}
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
            
        # Normalize vector to unit length
        features = features / features.norm(p=2, dim=-1, keepdim=True)
        vector = features[0].tolist()  # 512-dimensional array
        
        return {"embedding": vector}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Text embedding failed: {str(e)}")

if __name__ == "__main__":
    # pyrefly: ignore [missing-import]
    import uvicorn
    port = int(os.getenv("PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port)
