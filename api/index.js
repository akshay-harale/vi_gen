import express from 'express';
import cors from 'cors';
import { createClient } from 'redis';
import pg from 'pg';
import fs from 'fs';

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

    // Create segments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS segments (
        id SERIAL PRIMARY KEY,
        job_id VARCHAR(255) REFERENCES jobs(id) ON DELETE CASCADE,
        segment_index INT NOT NULL,
        text TEXT NOT NULL,
        image_prompt TEXT NOT NULL,
        code_snippet TEXT,
        code_language VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migrate existing JSON scripts from jobs table to segments table
    try {
      const jobsRes = await pool.query("SELECT id, script FROM jobs WHERE script IS NOT NULL");
      for (const job of jobsRes.rows) {
        const segCountRes = await pool.query("SELECT COUNT(*) FROM segments WHERE job_id = $1", [job.id]);
        const count = parseInt(segCountRes.rows[0].count, 10);
        if (count === 0) {
          try {
            const segments = JSON.parse(job.script);
            if (Array.isArray(segments)) {
              for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                await pool.query(`
                  INSERT INTO segments (job_id, segment_index, text, image_prompt, code_snippet, code_language)
                  VALUES ($1, $2, $3, $4, $5, $6)
                `, [job.id, i, seg.text || '', seg.image_prompt || '', seg.code_snippet || null, seg.code_language || null]);
              }
            }
          } catch (e) {
            console.error(`Failed to parse script for migration for job ${job.id}:`, e.message);
          }
        }
      }
    } catch (e) {
      console.error('Failed to run migration check:', e.message);
    }

    // Seed default system prompt
    await pool.query(`
      INSERT INTO settings (key, value)
      VALUES ('system_prompt', $1)
      ON CONFLICT (key) DO NOTHING;
    `, [defaultPrompt]);

    // Seed default LLM settings from environment
    const defaultLLMSettings = [
      { key: 'llm_provider', value: process.env.LLM_PROVIDER || 'together' },
      { key: 'llm_model', value: process.env.LLM_MODEL || 'google/gemma-4-31B-it' },
      { key: 'image_model', value: process.env.IMAGE_MODEL || 'stabilityai/stable-diffusion-xl-base-1.0' },
      { key: 'together_api_key', value: process.env.TOGETHER_API_KEY || '' },
      { key: 'openai_api_key', value: process.env.OPENAI_API_KEY || '' },
      { key: 'ollama_url', value: process.env.OLLAMA_URL || 'http://host.docker.internal:11434' }
    ];

    for (const setting of defaultLLMSettings) {
      await pool.query(`
        INSERT INTO settings (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key) DO NOTHING;
      `, [setting.key, setting.value]);
    }
    
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

app.get('/api/settings/llm', async (req, res) => {
  try {
    const keys = ['llm_provider', 'llm_model', 'image_model', 'together_api_key', 'openai_api_key', 'ollama_url'];
    const result = await pool.query("SELECT key, value FROM settings WHERE key = ANY($1)", [keys]);
    
    const config = {
      llm_provider: 'together',
      llm_model: 'google/gemma-4-31B-it',
      image_model: 'stabilityai/stable-diffusion-xl-base-1.0',
      together_api_key: '',
      openai_api_key: '',
      ollama_url: 'http://host.docker.internal:11434'
    };

    result.rows.forEach(row => {
      config[row.key] = row.value;
    });

    // Mask secret keys
    if (config.together_api_key) {
      config.together_api_key = '__MASKED_SECRET__';
    }
    if (config.openai_api_key) {
      config.openai_api_key = '__MASKED_SECRET__';
    }

    res.json(config);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch LLM settings' });
  }
});

app.post('/api/settings/llm', async (req, res) => {
  const { llm_provider, llm_model, image_model, together_api_key, openai_api_key, ollama_url } = req.body;
  
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      if (llm_provider !== undefined) {
        await client.query("INSERT INTO settings (key, value) VALUES ('llm_provider', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [llm_provider]);
      }
      if (llm_model !== undefined) {
        await client.query("INSERT INTO settings (key, value) VALUES ('llm_model', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [llm_model]);
      }
      if (image_model !== undefined) {
        await client.query("INSERT INTO settings (key, value) VALUES ('image_model', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [image_model]);
      }
      if (ollama_url !== undefined) {
        await client.query("INSERT INTO settings (key, value) VALUES ('ollama_url', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [ollama_url]);
      }
      if (together_api_key !== undefined && together_api_key !== '__MASKED_SECRET__') {
        await client.query("INSERT INTO settings (key, value) VALUES ('together_api_key', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [together_api_key]);
      }
      if (openai_api_key !== undefined && openai_api_key !== '__MASKED_SECRET__') {
        await client.query("INSERT INTO settings (key, value) VALUES ('openai_api_key', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [openai_api_key]);
      }
      
      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update LLM settings' });
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

// Sync helpers for segments table
async function ensureSegmentsSynced(jobId) {
  const segRes = await pool.query('SELECT * FROM segments WHERE job_id = $1 ORDER BY segment_index ASC', [jobId]);
  if (segRes.rows.length === 0) {
    const jobRes = await pool.query('SELECT script FROM jobs WHERE id = $1', [jobId]);
    if (jobRes.rows.length > 0 && jobRes.rows[0].script) {
      try {
        const segments = JSON.parse(jobRes.rows[0].script);
        if (Array.isArray(segments)) {
          for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            await pool.query(`
              INSERT INTO segments (job_id, segment_index, text, image_prompt, code_snippet, code_language)
              VALUES ($1, $2, $3, $4, $5, $6)
            `, [jobId, i, seg.text || '', seg.image_prompt || '', seg.code_snippet || null, seg.code_language || null]);
          }
        }
      } catch (e) {
        console.error('Failed to parse script for ensureSegmentsSynced:', e.message);
      }
    }
  }
}

async function updateJobsScriptFromSegments(jobId) {
  const segRes = await pool.query('SELECT text, image_prompt, code_snippet, code_language FROM segments WHERE job_id = $1 ORDER BY segment_index ASC', [jobId]);
  const segments = segRes.rows.map(row => ({
    text: row.text,
    image_prompt: row.image_prompt,
    code_snippet: row.code_snippet,
    code_language: row.code_language
  }));
  const updatedScript = JSON.stringify(segments, null, 2);
  await pool.query('UPDATE jobs SET script = $1 WHERE id = $2', [updatedScript, jobId]);
  return segments;
}

app.get('/api/jobs/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const job = result.rows[0];
    
    // Ensure segments are synced to table
    await ensureSegmentsSynced(job.id);
    
    res.json(job);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

app.post('/api/jobs/:id/segments/:idx/update', async (req, res) => {
  const { id, idx } = req.params;
  const segmentIdx = parseInt(idx, 10);
  const { text, image_prompt, code_snippet, code_language } = req.body;

  try {
    const jobRes = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
    if (jobRes.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    await ensureSegmentsSynced(id);

    // Fetch existing segment from DB
    const segRes = await pool.query('SELECT * FROM segments WHERE job_id = $1 AND segment_index = $2', [id, segmentIdx]);
    if (segRes.rows.length === 0) {
      return res.status(404).json({ error: 'Segment not found' });
    }

    const oldSegment = segRes.rows[0];
    
    // Check what changed to trigger proper regenerations
    const textChanged = oldSegment.text !== text || !fs.existsSync(`/app/output/${id}_${segmentIdx}.wav`);
    const imagePromptChanged = oldSegment.image_prompt !== image_prompt || !fs.existsSync(`/app/output/${id}_${segmentIdx}_raw.jpg`);
    const codeSnippetChanged = oldSegment.code_snippet !== code_snippet || 
                               oldSegment.code_language !== code_language ||
                               !fs.existsSync(`/app/output/${id}_${segmentIdx}.jpg`);

    // Update in database
    await pool.query(`
      UPDATE segments 
      SET text = $1, image_prompt = $2, code_snippet = $3, code_language = $4
      WHERE job_id = $5 AND segment_index = $6
    `, [text, image_prompt, code_snippet || null, code_language || null, id, segmentIdx]);

    // Update cached jobs.script
    const segments = await updateJobsScriptFromSegments(id);

    // Regenerate audio if text changed
    if (textChanged) {
      console.log(`[API Gateway] Requesting audio regeneration for segment ${segmentIdx}`);
      const audioResponse = await fetch('http://video-render-worker:5001/regenerate-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: id, index: segmentIdx, text })
      });
      if (!audioResponse.ok) {
        const errorData = await audioResponse.json().catch(() => ({}));
        throw new Error(`Worker audio regeneration failed: ${errorData.error || audioResponse.statusText}`);
      }
    }

    // Regenerate image or overlay code based on what changed
    if (imagePromptChanged) {
      console.log(`[API Gateway] Requesting full image generation & overlay for segment ${segmentIdx}`);
      const imgResponse = await fetch('http://video-render-worker:5001/regenerate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          job_id: id, 
          index: segmentIdx, 
          image_prompt,
          code_snippet,
          code_language,
          only_overlay: false
        })
      });
      if (!imgResponse.ok) {
        const errorData = await imgResponse.json().catch(() => ({}));
        throw new Error(`Worker image regeneration failed: ${errorData.error || imgResponse.statusText}`);
      }
    } else if (codeSnippetChanged) {
      console.log(`[API Gateway] Requesting fast code overlay only for segment ${segmentIdx}`);
      const imgResponse = await fetch('http://video-render-worker:5001/regenerate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          job_id: id, 
          index: segmentIdx, 
          image_prompt,
          code_snippet,
          code_language,
          only_overlay: true
        })
      });
      if (!imgResponse.ok) {
        const errorData = await imgResponse.json().catch(() => ({}));
        throw new Error(`Worker code overlay failed: ${errorData.error || imgResponse.statusText}`);
      }
    }

    res.json({ success: true, segments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to update segment' });
  }
});

app.post('/api/jobs/:id/segments/add-at/:idx', async (req, res) => {
  const { id, idx } = req.params;
  const insertIdx = parseInt(idx, 10);
  try {
    const jobRes = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
    if (jobRes.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    await ensureSegmentsSynced(id);

    const countRes = await pool.query('SELECT COUNT(*) FROM segments WHERE job_id = $1', [id]);
    const currentCount = parseInt(countRes.rows[0].count, 10);

    if (insertIdx < 0 || insertIdx > currentCount) {
      return res.status(400).json({ error: 'Invalid insertion index' });
    }

    // Shift segments index >= insertIdx up by 1
    await pool.query(`
      UPDATE segments 
      SET segment_index = segment_index + 1 
      WHERE job_id = $1 AND segment_index >= $2
    `, [id, insertIdx]);

    const defaultText = "Add narration script here.";
    const defaultImagePrompt = "A minimal 2D vector schematic blueprint diagram, hardware design, line art, technical specifications, black background, white lines";

    // Insert new segment at insertIdx
    await pool.query(`
      INSERT INTO segments (job_id, segment_index, text, image_prompt, code_snippet, code_language)
      VALUES ($1, $2, $3, $4, null, null)
    `, [id, insertIdx, defaultText, defaultImagePrompt]);

    // Update jobs.script JSON cache
    const segments = await updateJobsScriptFromSegments(id);

    // Clean up shifted files on disk to force regeneration
    for (let i = insertIdx; i <= currentCount; i++) {
      try {
        if (fs.existsSync(`/app/output/${id}_${i}.wav`)) fs.unlinkSync(`/app/output/${id}_${i}.wav`);
        if (fs.existsSync(`/app/output/${id}_${i}_raw.jpg`)) fs.unlinkSync(`/app/output/${id}_${i}_raw.jpg`);
        if (fs.existsSync(`/app/output/${id}_${i}.jpg`)) fs.unlinkSync(`/app/output/${id}_${i}.jpg`);
      } catch (err) {
        console.error(`Failed to clean up files for segment index ${i}:`, err.message);
      }
    }

    // Generate initial default assets for the new segment at insertIdx
    console.log(`[API Gateway] Generating default assets for inserted segment ${insertIdx}`);
    const audioResponse = await fetch('http://video-render-worker:5001/regenerate-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: id, index: insertIdx, text: defaultText })
    });
    if (!audioResponse.ok) {
      console.error('Failed to generate initial audio for inserted segment');
    }

    const imgResponse = await fetch('http://video-render-worker:5001/regenerate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        job_id: id, 
        index: insertIdx, 
        image_prompt: defaultImagePrompt,
        code_snippet: null,
        code_language: null,
        only_overlay: false
      })
    });
    if (!imgResponse.ok) {
      console.error('Failed to generate initial image for inserted segment');
    }

    res.json({ success: true, segments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to insert segment' });
  }
});

app.post('/api/jobs/:id/segments/add', async (req, res) => {
  const { id } = req.params;
  try {
    const jobRes = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
    if (jobRes.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    await ensureSegmentsSynced(id);

    // Get current segments count
    const countRes = await pool.query('SELECT COUNT(*) FROM segments WHERE job_id = $1', [id]);
    const nextIndex = parseInt(countRes.rows[0].count, 10);

    const defaultText = "Add narration script here.";
    const defaultImagePrompt = "A minimal 2D vector schematic blueprint diagram, hardware design, line art, technical specifications, black background, white lines";

    // Insert new segment
    await pool.query(`
      INSERT INTO segments (job_id, segment_index, text, image_prompt, code_snippet, code_language)
      VALUES ($1, $2, $3, $4, null, null)
    `, [id, nextIndex, defaultText, defaultImagePrompt]);

    // Update jobs.script JSON cache
    const segments = await updateJobsScriptFromSegments(id);

    // Generate initial audio for the new segment
    console.log(`[API Gateway] Generating default audio for new segment ${nextIndex}`);
    const audioResponse = await fetch('http://video-render-worker:5001/regenerate-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: id, index: nextIndex, text: defaultText })
    });
    if (!audioResponse.ok) {
      console.error('Failed to generate initial audio for new segment');
    }

    // Generate initial image for the new segment
    console.log(`[API Gateway] Generating default image for new segment ${nextIndex}`);
    const imgResponse = await fetch('http://video-render-worker:5001/regenerate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        job_id: id, 
        index: nextIndex, 
        image_prompt: defaultImagePrompt,
        code_snippet: null,
        code_language: null,
        only_overlay: false
      })
    });
    if (!imgResponse.ok) {
      console.error('Failed to generate initial image for new segment');
    }

    res.json({ success: true, segments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to add segment' });
  }
});

app.post('/api/jobs/:id/segments/:idx/delete', async (req, res) => {
  const { id, idx } = req.params;
  const segmentIdx = parseInt(idx, 10);

  try {
    const jobRes = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
    if (jobRes.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    await ensureSegmentsSynced(id);

    // Get current segments count
    const countRes = await pool.query('SELECT COUNT(*) FROM segments WHERE job_id = $1', [id]);
    const currentCount = parseInt(countRes.rows[0].count, 10);

    if (segmentIdx < 0 || segmentIdx >= currentCount) {
      return res.status(400).json({ error: 'Invalid segment index to delete' });
    }

    // Delete the target segment
    await pool.query('DELETE FROM segments WHERE job_id = $1 AND segment_index = $2', [id, segmentIdx]);

    // Shift segments index
    await pool.query(`
      UPDATE segments 
      SET segment_index = segment_index - 1 
      WHERE job_id = $1 AND segment_index > $2
    `, [id, segmentIdx]);

    // Update jobs.script JSON cache
    const segments = await updateJobsScriptFromSegments(id);

    // Delete shifted files on disk to force regeneration of shifted elements
    for (let i = segmentIdx; i <= currentCount; i++) {
      try {
        if (fs.existsSync(`/app/output/${id}_${i}.wav`)) fs.unlinkSync(`/app/output/${id}_${i}.wav`);
        if (fs.existsSync(`/app/output/${id}_${i}_raw.jpg`)) fs.unlinkSync(`/app/output/${id}_${i}_raw.jpg`);
        if (fs.existsSync(`/app/output/${id}_${i}.jpg`)) fs.unlinkSync(`/app/output/${id}_${i}.jpg`);
      } catch (err) {
        console.error(`Failed to clean up files for segment index ${i}:`, err.message);
      }
    }

    res.json({ success: true, segments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to delete segment' });
  }
});

app.post('/api/jobs/:id/recompile', async (req, res) => {
  const { id } = req.params;
  try {
    const jobRes = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
    if (jobRes.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Push to Redis Queue
    await redisClient.rPush('job_queue', JSON.stringify({ jobId: id, action: 'recompile' }));
    
    // Update status in DB
    await pool.query("UPDATE jobs SET status = 'PROCESSING' WHERE id = $1", [id]);
    
    console.log(`[API Gateway] Queued recompile task for job ${id}`);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to queue recompilation' });
  }
});

app.listen(port, () => {
  console.log(`API Gateway listening on port ${port}`);
});
