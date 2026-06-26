import { useState, useEffect } from 'react';
import './index.css';

interface Job {
  id: string;
  prompt: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  created_at: string;
  script?: string;
  video_url?: string;
}

function App() {
  const [prompt, setPrompt] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const fetchJobs = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/jobs');
      if (res.ok) {
        const data = await res.json();
        setJobs(data);
      }
    } catch (err) {
      console.error('Failed to fetch jobs', err);
    }
  };

  const submitJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt) return;
    setLoading(true);
    try {
      await fetch('http://localhost:3000/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      setPrompt('');
      fetchJobs();
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchJobs();
    const interval = window.setInterval(() => {
      fetchJobs();
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const toggleJob = (id: string) => {
    setExpandedJobs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 20px' }}>
      <header style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h1 style={{ fontSize: '3rem', margin: '0', background: 'linear-gradient(135deg, #8b5cf6, #ec4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Vi Gen Studio
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.7)' }}>AI-Powered Video Generation Pipeline</p>
      </header>

      <div className="glass-panel" style={{ marginBottom: '24px' }}>
        <form onSubmit={submitJob} style={{ display: 'flex', gap: '12px' }}>
          <input 
            type="text" 
            placeholder="Describe your video (e.g., A futuristic cyberpunk city at night...)" 
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={loading}
          />
          <button type="submit" className="btn" disabled={loading || !prompt}>
            {loading ? 'Submitting...' : 'Generate'}
          </button>
        </form>
      </div>

      {jobs.length > 0 && (
        <div className="glass-panel">
          <h2 style={{ marginTop: '0', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>Job Queue & Status</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
            {jobs.map((job) => (
              <div 
                key={job.id} 
                onClick={() => toggleJob(job.id)}
                style={{ 
                  padding: '12px', 
                  background: 'rgba(255,255,255,0.05)', 
                  borderRadius: '8px',
                  cursor: 'pointer',
                  border: '1px solid transparent',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'}
                onMouseOut={(e) => e.currentTarget.style.borderColor = 'transparent'}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ margin: '0 0 4px 0', fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)' }}>ID: {job.id} • {new Date(job.created_at).toLocaleString()}</p>
                    <p style={{ margin: '0', fontWeight: '500' }}>"{job.prompt}"</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    {(job.status === 'PENDING' || job.status === 'PROCESSING') && (
                      <div className="processing-indicator" style={{ marginRight: '8px' }}></div>
                    )}
                    <span style={{ 
                      fontWeight: 'bold', 
                      fontSize: '0.9rem',
                      color: job.status === 'COMPLETED' ? '#10b981' : 
                             job.status === 'FAILED' ? '#ef4444' : 
                             'var(--primary)' 
                    }}>
                      {job.status}
                    </span>
                  </div>
                </div>
                {expandedJobs.has(job.id) && job.script && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: 'var(--primary)' }}>Generated Script</h4>
                    <pre style={{ 
                      margin: 0, 
                      whiteSpace: 'pre-wrap', 
                      fontFamily: 'inherit', 
                      fontSize: '0.85rem',
                      color: 'rgba(255,255,255,0.8)',
                      maxHeight: '300px',
                      overflowY: 'auto',
                      marginBottom: '12px'
                    }}>
                      {job.script}
                    </pre>
                  </div>
                )}
                {expandedJobs.has(job.id) && job.video_url && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: '#10b981' }}>Generated Video</h4>
                    <video 
                      src={`http://localhost:3000${job.video_url}`} 
                      controls 
                      style={{ width: '100%', borderRadius: '8px', background: '#000' }}
                    />
                  </div>
                )}
                {expandedJobs.has(job.id) && !job.script && job.status === 'COMPLETED' && (
                  <p style={{ margin: '12px 0 0 0', fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)' }}>No script or video saved.</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
