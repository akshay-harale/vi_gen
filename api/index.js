import express from 'express';
import cors from 'cors';
import { createClient } from 'redis';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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

// In-memory mock DB for Sprint 1
const mockDb = new Map();

app.post('/api/jobs', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  // Store in mock DB
  mockDb.set(jobId, { id: jobId, prompt, status: 'PENDING' });

  // Push to Redis Queue
  try {
    await redisClient.rPush('job_queue', JSON.stringify({ jobId, prompt }));
    console.log(`Queued job ${jobId}`);
    res.status(202).json({ jobId, status: 'PENDING' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to queue job' });
  }
});

app.get('/api/jobs/:id', (req, res) => {
  const job = mockDb.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// A webhook-like endpoint for the worker to update job status (Sprint 1 mock)
app.post('/api/jobs/:id/status', (req, res) => {
  const { status } = req.body;
  const job = mockDb.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  
  job.status = status;
  mockDb.set(req.params.id, job);
  console.log(`Updated job ${req.params.id} to ${status}`);
  res.json(job);
});

app.listen(port, () => {
  console.log(`API Gateway listening on port ${port}`);
});
