import os
import io
import requests
import numpy as np
# pyrefly: ignore [missing-import]
from fastapi import FastAPI, UploadFile, File, HTTPException
from PIL import Image

app = FastAPI(title="Pinterest Clone CLIP Embedding Service")

# Check if local PyTorch + Transformers are available
USE_LOCAL = False
try:
    if os.getenv("FORCE_HF_API", "false").lower() != "true":
        # pyrefly: ignore [missing-import]
        from transformers import CLIPProcessor, CLIPModel
        # pyrefly: ignore [missing-import]
        import torch
        MODEL_NAME = "openai/clip-vit-base-patch32"
        print(f"Loading local CLIP model: {MODEL_NAME}...")
        local_model = CLIPModel.from_pretrained(MODEL_NAME)
        local_processor = CLIPProcessor.from_pretrained(MODEL_NAME)
        local_model.eval()
        USE_LOCAL = True
        print("Local PyTorch CLIP Model loaded successfully!")
except Exception as e:
    print(f"Local PyTorch model not used ({e}). Using Hugging Face Cloud Inference API.")

HF_API_URL = "https://api-inference.huggingface.co/pipeline/feature-extraction/openai/clip-vit-base-patch32"
HF_TOKEN = os.getenv("HF_TOKEN", "")

def _extract_features(output):
    """CLIPModel.get_text_features()/get_image_features() return a plain
    Tensor on older `transformers` releases, but a BaseModelOutputWithPooling
    (with the embedding at .pooler_output) on newer ones (5.x+) — normalize
    both shapes to the raw Tensor here so callers don't care which is active."""
    pooler_output = getattr(output, "pooler_output", None)
    return pooler_output if pooler_output is not None else output

def query_hf_api(data=None, json_payload=None, is_image=False):
    headers = {}
    if HF_TOKEN:
        headers["Authorization"] = f"Bearer {HF_TOKEN}"
    
    if is_image:
        headers["Content-Type"] = "application/octet-stream"
        response = requests.post(HF_API_URL, headers=headers, data=data, timeout=20)
    else:
        response = requests.post(HF_API_URL, headers=headers, json=json_payload, timeout=20)
        
    if response.status_code != 200:
        raise Exception(f"HF API status {response.status_code}: {response.text}")
        
    return response.json()

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "mode": "local-pytorch" if USE_LOCAL else "huggingface-cloud-api"
    }

@app.post("/embed/image")
async def embed_image(file: UploadFile = File(...)):
    try:
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        
        if USE_LOCAL:
            # pyrefly: ignore [missing-import]
            import torch
            inputs = local_processor(images=image, return_tensors="pt")
            with torch.no_grad():
                features = _extract_features(local_model.get_image_features(**inputs))
            features = features / features.norm(p=2, dim=-1, keepdim=True)
            return {"embedding": features[0].tolist()}
        else:
            # Re-encode image to clean JPEG bytes for API
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG")
            clean_bytes = buffer.getvalue()
            
            result = query_hf_api(data=clean_bytes, is_image=True)
            if isinstance(result, list):
                vector = np.array(result, dtype=np.float32).flatten()
                if len(vector) > 512:
                    vector = vector[:512]
                norm = np.linalg.norm(vector)
                if norm > 0:
                    vector = vector / norm
                return {"embedding": vector.tolist()}
            else:
                raise Exception("Unexpected response format from HF API")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image embedding failed: {str(e)}")

@app.get("/embed/text")
async def embed_text(query: str):
    if not query or len(query.strip()) == 0:
        raise HTTPException(status_code=400, detail="Query string cannot be empty")
    try:
        if USE_LOCAL:
            # pyrefly: ignore [missing-import]
            import torch
            inputs = local_processor(text=[query.strip()], return_tensors="pt", padding=True)
            with torch.no_grad():
                features = _extract_features(local_model.get_text_features(**inputs))
            features = features / features.norm(p=2, dim=-1, keepdim=True)
            return {"embedding": features[0].tolist()}
        else:
            result = query_hf_api(json_payload={"inputs": query.strip()}, is_image=False)
            if isinstance(result, list):
                vector = np.array(result, dtype=np.float32).flatten()
                if len(vector) > 512:
                    vector = vector[:512]
                norm = np.linalg.norm(vector)
                if norm > 0:
                    vector = vector / norm
                return {"embedding": vector.tolist()}
            else:
                raise Exception("Unexpected response format from HF API")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Text embedding failed: {str(e)}")

if __name__ == "__main__":
    # pyrefly: ignore [missing-import]
    import uvicorn
    port = int(os.getenv("PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port)
