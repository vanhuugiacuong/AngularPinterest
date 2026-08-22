import express from "express";
import multer from "multer";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Configure Multer for in-memory storage (max 10MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

app.post(
  "/api/upload-and-generate",
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image file uploaded" });
      }

      // Convert buffer to a Blob for sending
      const blob = new Blob([req.file.buffer], { type: req.file.mimetype });

      // Create FormData for litterbox.catbox.moe upload
      const formData = new FormData();
      formData.append("reqtype", "fileupload");
      formData.append("time", "1h");
      formData.append("fileToUpload", blob, req.file.originalname);

      console.log(
        `Uploading file ${req.file.originalname} (${req.file.size} bytes) to litterbox.catbox.moe...`,
      );

      // Upload to litterbox.catbox.moe
      const uploadResponse = await fetch("https://litterbox.catbox.moe/resources/internals/api.php", {
        method: "POST",
        body: formData,
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error(`Failed to upload to litterbox.catbox.moe: ${errorText}`);
      }

      const directUrl = (await uploadResponse.text()).trim();
      console.log(`Uploaded successfully. Direct URL: ${directUrl}`);

      if (!directUrl.startsWith("http")) {
        throw new Error(`Invalid response from litterbox.catbox.moe: ${directUrl}`);
      }

      res.json({ success: true, url: directUrl });
    } catch (error) {
      console.error("Error handling upload:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to upload and proxy image" });
    }
  },
);

// Proxy image download to bypass CORS blocks
app.get("/api/download", async (req, res) => {
  try {
    const imageUrl = req.query.url;
    const prompt = req.query.prompt || "generation";
    if (!imageUrl) {
      return res.status(400).send("Missing url parameter");
    }

    console.log(`Proxying download for image: ${imageUrl}`);
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch image from source: ${response.statusText}`,
      );
    }

    // Create a safe filename from the prompt description
    const safeName = prompt
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .replace(/_+/g, "_")
      .substring(0, 30);
    const filename = `pollinations_${safeName || "generation"}.png`;

    // Set headers
    res.setHeader(
      "Content-Type",
      response.headers.get("Content-Type") || "image/png",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.send(buffer);
  } catch (error) {
    console.error("Download proxy error:", error);
    res.status(500).send("Failed to download image");
  }
});

// For status check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`[Server] Pollinations API Generator started!`);
  console.log(`[Server] Web page accessible at http://localhost:${port}`);
});
