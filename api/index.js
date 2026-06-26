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
    
    // Add script column if missing
    try {
      await pool.query(`ALTER TABLE jobs ADD COLUMN script TEXT;`);
    } catch (e) {
      // Ignore error if column already exists
    }
    
    console.log('Database initialized: jobs table is ready.');
  } catch (err) {
    console.error('Failed to initialize database', err);
  }
}
initDB();

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
