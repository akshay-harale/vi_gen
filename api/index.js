import express from 'express';
import cors from 'cors';
import { createClient } from 'redis';
import pg from 'pg';

const { Pool } = pg;

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use('/output', express.static('/app/output'));

// Redis setup
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = createClient({ url: redisUrl });

redisClient.on('error', (err) => console.log('Redis Client Error', err));

async function connectRedis() {
  try {
    await redisClient.connect();
    console.log('Connected to Redis');
  } catch (err) {
    console.error('Failed to connect to Redis', err);
  }
}
connectRedis();

// Postgres setup
const dbUrl = process.env.DB_URL || 'postgres://user:pass@localhost:5432/videodb';
const pool = new Pool({
  connectionString: dbUrl,
});

const defaultPrompt = `You are a video script writer creating content for YouTube Shorts or Instagram Reels (Vertical 9:16 format). 
Based on the prompt, generate a JSON object with a list of 'segments'.
Each segment should have:
- 'text': the narration text (keep it engaging and concise, 2-3 sentences max per segment)
- 'image_prompt': a highly detailed, descriptive prompt for an AI image generator to create a visual for this segment.
  VISUAL THEME: The visual aesthetic must represent a clean, high-contrast engineering schematic, 2D technical vector diagram, or blueprint layout (e.g. "A minimal 2D vector blueprint diagram of... crisp white lines on a pure black background, blueprint schematic aesthetics, hardware details, high-contrast technical line art"). Avoid detailed real-world photos, photorealism, and blurry 3D environments.
- 'code_snippet' (optional): If the segment involves programming concepts, provide the exact code block. IMPORTANT: Code will be displayed on a vertical phone screen. You MUST format the code with short lines (maximum 35 characters per line) by adding line breaks and proper indentation. Keep it under 8 lines total.
- 'code_language' (optional): The programming language for the code snippet (e.g. "java").

IMPORTANT: The images will be generated in a vertical 9:16 aspect ratio. Instruct the image generator to compose the shot vertically.

Respond ONLY with valid JSON.
Example format:
{
  "segments": [
    {
      "text": "...", 
      "image_prompt": "A minimal 2D vector schematic blueprint diagram of a filesystem structure with dark background, crisp white lines...",
      "code_snippet": "List<String> lines =\\n    Files.readAllLines(\\n        Paths.get(\\"file.txt\\")\\n    );",
      "code_language": "java"
    }
  ]
}
`;

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id VARCHAR(255) PRIMARY KEY,
        prompt TEXT,
        status VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        video_url TEXT
      );
    `);
    
    // Add columns if missing
    try {
      await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS script TEXT;`);
    } catch (e) {}

    try {
      await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS step_status JSONB;`);
    } catch (e) {}
    
    // Create settings table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Seed default system prompt
    await pool.query(`
      INSERT INTO settings (key, value)
      VALUES ('system_prompt', $1)
      ON CONFLICT (key) DO NOTHING;
    `, [defaultPrompt]);
    
    console.log('Database initialized: jobs and settings tables are ready.');
  } catch (err) {
    console.error('Failed to initialize database', err);
  }
}
initDB();

// Settings endpoints
app.get('/api/settings/system_prompt', async (req, res) => {
  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'system_prompt'");
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'System prompt setting not found' });
    }
    res.json({ system_prompt: result.rows[0].value });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch system prompt' });
  }
});

app.post('/api/settings/system_prompt', async (req, res) => {
  const { system_prompt } = req.body;
  if (!system_prompt) return res.status(400).json({ error: 'system_prompt is required' });
  
  try {
    await pool.query(
      "INSERT INTO settings (key, value) VALUES ('system_prompt', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [system_prompt]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update system prompt' });
  }
});

app.post('/api/jobs', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  try {
    // Store in DB
    await pool.query(
      'INSERT INTO jobs (id, prompt, status) VALUES ($1, $2, $3)',
      [jobId, prompt, 'PENDING']
    );

    // Push to Redis Queue
    await redisClient.rPush('job_queue', JSON.stringify({ jobId, prompt }));
    console.log(`Queued job ${jobId}`);
    res.status(202).json({ jobId, status: 'PENDING' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create job' });
  }
});

app.get('/api/jobs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

app.get('/api/jobs/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

app.listen(port, () => {
  console.log(`API Gateway listening on port ${port}`);
});
