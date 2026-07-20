import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { rateLimit } from "express-rate-limit";
import {
  validateParams,
  buildPrompt,
  callDeepSeek
} from "./lib/_lib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("trust proxy", 1);
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

app.get("/api/health", (req, res) => {
  const distPath = path.resolve(__dirname, "dist");
  res.json({ 
    status: "ok", 
    env: process.env.NODE_ENV || "development",
    time: new Date().toISOString(),
    distExists: fs.existsSync(distPath),
    distContents: fs.existsSync(distPath) ? fs.readdirSync(distPath) : []
  });
});

// Limite de débit : 60 requêtes par IP par 10 minutes (salle de formation derrière une même IP publique).
const generateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requêtes. Réessayez dans quelques minutes." },
});

app.post("/api/generate", generateLimiter, async (req, res) => {
  try {
    const validation = validateParams(req.body);
    if ("error" in validation) {
      return res.status(400).json({ error: validation.error });
    }

    const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
    if (!DEEPSEEK_API_KEY) {
      return res.status(500).json({ error: "DEEPSEEK_API_KEY is not configured on the server." });
    }

    const result = await callDeepSeek(buildPrompt(validation.params), DEEPSEEK_API_KEY);
    if (result.ok === false) {
      return res.status(result.status).json({ error: result.error });
    }

    res.json({ content: result.content });
  } catch (error) {
    console.error("Error generating content:", error);
    res.status(500).json({ error: "Internal server error during content generation" });
  }
});

// Catch-all for undefined API routes to return JSON instead of HTML
app.all("/api/*", (req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.url} non trouvée` });
});

async function startServer() {
  const mode = process.env.NODE_ENV || "development";
  console.log(`Starting server in ${mode} mode`);

  if (mode !== "production") {
    console.log("Initializing Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    console.log(`Serving static files from: ${distPath}`);
    if (!fs.existsSync(distPath)) {
      console.error("ERROR: dist directory not found! Did you run 'npm run build'?");
    }
    app.use(express.static(distPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".js")) {
          res.setHeader("Content-Type", "application/javascript");
        }
      }
    }));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
