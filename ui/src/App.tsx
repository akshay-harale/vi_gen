import { useState, useEffect } from 'react';
import './index.css';

interface Job {
  id: string;
  prompt: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
}

function App() {
  const [prompt, setPrompt] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<Job | null>(null);
  const [loading, setLoading] = useState(false);

  const submitJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt) return;
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3000/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      const data = await res.json();
      if (data.jobId) {
        setJobId(data.jobId);
        setJobStatus({ id: data.jobId, prompt, status: data.status });
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => {
    let interval: number;
    if (jobId && jobStatus?.status !== 'COMPLETED' && jobStatus?.status !== 'FAILED') {
      interval = window.setInterval(async () => {
        try {
          const res = await fetch(`http://localhost:3000/api/jobs/${jobId}`);
          if (res.ok) {
            const data = await res.json();
            setJobStatus(data);
          }
        } catch (err) {
          console.error(err);
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [jobId, jobStatus?.status]);

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

      {jobStatus && (
        <div className="glass-panel">
          <h2 style={{ marginTop: '0', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>Job Status</h2>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
            <div>
              <p style={{ margin: '0 0 8px 0', fontSize: '0.9rem', color: 'rgba(255,255,255,0.6)' }}>ID: {jobStatus.id}</p>
              <p style={{ margin: '0', fontWeight: '600' }}>"{jobStatus.prompt}"</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {(jobStatus.status === 'PENDING' || jobStatus.status === 'PROCESSING') && (
                <div className="processing-indicator"></div>
              )}
              <span style={{ 
                fontWeight: 'bold', 
                color: jobStatus.status === 'COMPLETED' ? '#10b981' : 
                       jobStatus.status === 'FAILED' ? '#ef4444' : 
                       'var(--primary)' 
              }}>
                {jobStatus.status}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
