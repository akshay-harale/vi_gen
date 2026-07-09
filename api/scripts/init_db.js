import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DB_URL || 'postgres://user:pass@localhost:5432/videodb'
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

async function init() {
  try {
    console.log('Connecting to database...');
    
    // Create jobs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id VARCHAR(255) PRIMARY KEY,
        prompt TEXT NOT NULL,
        status VARCHAR(50) NOT NULL,
        script TEXT,
        video_url TEXT,
        step_status JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Ensure step_status exists for existing tables
    try {
      await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS step_status JSONB;`);
    } catch (e) {
      console.log('step_status column already exists or ALTER failed:', e.message);
    }

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


    console.log('Database schema initialized and seeded successfully.');
  } catch (error) {
    console.error('Error creating tables:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

init();
