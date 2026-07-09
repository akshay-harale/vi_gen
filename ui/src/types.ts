export interface Job {
  id: string;
  prompt: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  created_at: string;
  script?: string;
  video_url?: string;
  step_status?: Record<string, 'pending' | 'processing' | 'completed' | 'failed' | 'skipped'>;
}

export interface Segment {
  text: string;
  image_prompt: string;
  code_snippet?: string;
  code_language?: string;
}
