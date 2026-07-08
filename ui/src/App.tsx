import { useState, useEffect } from 'react';
import './index.css';

interface Job {
  id: string;
  prompt: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  created_at: string;
  script?: string;
  video_url?: string;
  step_status?: Record<string, 'pending' | 'processing' | 'completed' | 'failed' | 'skipped'>;
}

function App() {
  const [prompt, setPrompt] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  
  const activeJob = jobs.find(j => j.id === activeJobId) || null;
  const STEP_ORDER = ['script', 'audio', 'images', 'compile', 'upload'];
  
  // Settings prompt state
  const [showSettings, setShowSettings] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  // Sync theme to root HTML element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/settings/system_prompt');
      if (res.ok) {
        const data = await res.json();
        setPromptTemplate(data.system_prompt);
      }
    } catch (err) {
      console.error('Failed to fetch settings', err);
    }
  };

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await fetch('http://localhost:3000/api/settings/system_prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system_prompt: systemPrompt })
      });
      if (res.ok) {
        setShowSettings(false);
      }
    } catch (err) {
      console.error('Failed to save settings', err);
    }
    setSavingSettings(false);
  };

  // Helper setter to load initial fetch properly
  const setPromptTemplate = (val: string) => {
    setSystemPrompt(val);
  };

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
    fetchSettings();
    const interval = window.setInterval(() => {
      fetchJobs();
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '40px 20px', minHeight: '90vh', display: 'flex', flexDirection: 'column', gap: '30px' }}>
      
      {/* HEADER SECTION */}
      <header style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'flex-start',
        borderBottom: '1px solid var(--border-color)',
        paddingBottom: '20px'
      }}>
        <div>
          <span className="schematic-tag">SYSTEM ID: VGEN-SYS-3.5 // ENG-BUILD</span>
          <h1 style={{ fontSize: '3.5rem', margin: '8px 0 0 0', letterSpacing: '-0.5px' }}>VI GEN STUDIO</h1>
          <p style={{ margin: '4px 0 0 0', opacity: 0.8, fontSize: '13px', fontFamily: 'IBM Plex Mono, monospace' }}>
            [AUTOMATED STATE GRAPH VIDEO SYNTHESIS PIPELINE]
          </p>
        </div>
        
        <div style={{ display: 'flex', gap: '10px' }}>
          <button 
            onClick={() => setShowSettings(true)} 
            className="btn-schematic" 
            style={{ padding: '8px 16px', fontSize: '12px' }}
          >
            [SETTINGS]
          </button>
          <button 
            onClick={toggleTheme} 
            className="btn-schematic" 
            style={{ padding: '8px 16px', fontSize: '12px' }}
          >
            THEME: {theme === 'light' ? 'SWISS CREAM' : 'STARK MONO'}
          </button>
        </div>
      </header>

      {/* CORE WORKSPACE GRID */}
      <main style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '30px' }}>
        
        {/* INPUT PROMPT PANEL */}
        <section className="schematic-panel">
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '10px',
            marginBottom: '20px'
          }}>
            <span className="mono-label" style={{ fontSize: '12px', textTransform: 'uppercase' }}>FIG. 01 // INPUT PARAMETERS</span>
            <span className="schematic-tag" style={{ opacity: 0.4 }}>PROMPT_REQ</span>
          </div>

          <form onSubmit={submitJob} style={{ display: 'flex', gap: '15px' }}>
            <input 
              type="text" 
              placeholder="Input target concept (e.g. How does CountDownLatch work in Java?)" 
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={loading}
              className="schematic-input"
            />
            <button 
              type="submit" 
              className="btn-schematic accented" 
              disabled={loading || !prompt}
            >
              {loading ? 'PROCESSING...' : 'INITIALIZE'}
            </button>
          </form>
        </section>

        {/* JOBS LIST / ARCHIVE PANEL */}
        {jobs.length > 0 && (
          <section className="schematic-panel">
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              borderBottom: '1px solid var(--border-color)',
              paddingBottom: '10px',
              marginBottom: '20px'
            }}>
              <span className="mono-label" style={{ fontSize: '12px', textTransform: 'uppercase' }}>FIG. 02 // PIPELINE STATUS QUEUE</span>
              <span className="schematic-tag" style={{ opacity: 0.4 }}>SYS_MONITOR</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {jobs.map((job, idx) => (
                <div 
                  key={job.id} 
                  onClick={() => setActiveJobId(job.id)}
                  style={{ 
                    padding: '16px', 
                    border: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    backgroundColor: activeJobId === job.id ? 'var(--text-color)' : 'transparent',
                    color: activeJobId === job.id ? 'var(--bg-color)' : 'var(--text-color)',
                    transition: 'all 0.15s ease-in-out'
                  }}
                  onMouseOver={(e) => {
                    if (activeJobId !== job.id) {
                      e.currentTarget.style.backgroundColor = 'rgba(43, 102, 255, 0.05)';
                    }
                  }}
                  onMouseOut={(e) => {
                    if (activeJobId !== job.id) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '75%' }}>
                    <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                      <span className="mono-label" style={{ fontSize: '11px', opacity: activeJob?.id === job.id ? 0.9 : 0.6 }}>
                        #{jobs.length - idx} // {job.id.substring(0, 12)}...
                      </span>
                      <span style={{ fontSize: '11px', opacity: activeJob?.id === job.id ? 0.9 : 0.6 }}>
                        {new Date(job.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontWeight: '600', fontSize: '15px', textTransform: 'uppercase', letterSpacing: '-0.2px' }}>
                      "{job.prompt}"
                    </p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    {job.status === 'PROCESSING' && (
                      <span className="pulse-tag">
                        <span className="pulse-dot"></span>
                        SYNTHESIZING
                      </span>
                    )}
                    {job.status === 'PENDING' && (
                      <span className="mono-label" style={{ fontSize: '12px', opacity: 0.6 }}>QUEUED</span>
                    )}
                    {job.status === 'FAILED' && (
                      <span className="mono-label" style={{ fontSize: '12px', color: '#ef4444', fontWeight: 'bold' }}>ERROR</span>
                    )}
                    {job.status === 'COMPLETED' && (
                      <span className="mono-label" style={{ fontSize: '12px', color: activeJob?.id === job.id ? 'var(--bg-color)' : 'var(--accent-color)', fontWeight: 'bold' }}>
                        ACTIVE_BUILD
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* OVERLAY POPUP MODAL */}
      {activeJob && (
        <div className="schematic-modal-overlay" onClick={() => setActiveJobId(null)}>
          <div className="schematic-modal-content" onClick={(e) => e.stopPropagation()}>
            
            {/* Modal Header */}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              borderBottom: '1px solid var(--border-color)',
              padding: '16px 20px',
            }}>
              <div>
                <span className="schematic-tag">BUILD METADATA // {activeJob.id}</span>
                <h3 style={{ fontSize: '1.5rem', margin: '4px 0 0 0' }}>"{activeJob.prompt}"</h3>
              </div>
              <button 
                onClick={() => setActiveJobId(null)} 
                className="btn-schematic" 
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                [CLOSE]
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* Pipeline Step Visualizer */}
              {activeJob.step_status && (
                <div style={{ 
                  border: '1px solid var(--border-color)', 
                  padding: '16px', 
                  backgroundColor: 'var(--panel-bg)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}>
                  <span className="mono-label" style={{ fontSize: '11px', opacity: 0.6 }}>[FIG. C // PIPELINE_EXECUTION_FLOW]</span>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '5px' }}>
                    {STEP_ORDER.map((step, idx) => {
                      const status = activeJob.step_status?.[step] || 'pending';
                      const isLast = idx === STEP_ORDER.length - 1;
                      const color = status === 'completed' ? 'var(--text-color)' :
                                    status === 'processing' ? 'var(--accent-color)' :
                                    status === 'failed' ? '#ef4444' :
                                    status === 'skipped' ? 'var(--border-color)' :
                                    'var(--border-color)';
                      const borderStyle = status === 'skipped' ? 'dashed' : 'solid';
                      const opacity = status === 'pending' ? 0.35 : 1;
                      
                      return (
                        <div key={step} style={{ display: 'flex', alignItems: 'center', gap: '12px', flexGrow: isLast ? 0 : 1, opacity }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ 
                              width: '18px', 
                              height: '18px', 
                              borderRadius: '50%', 
                              border: `1.5px ${borderStyle} ${color}`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: status === 'completed' ? 'var(--text-color)' : 'transparent',
                              position: 'relative'
                            }}>
                              {status === 'processing' && (
                                <span className="pulse-dot" style={{ width: '8px', height: '8px', position: 'absolute' }}></span>
                              )}
                              {status === 'failed' && (
                                <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#ef4444' }}>!</span>
                              )}
                            </div>
                            <span className="mono-label" style={{ fontSize: '11px', textTransform: 'uppercase', color, fontWeight: status === 'processing' || status === 'completed' ? 'bold' : 'normal' }}>
                              {step}
                            </span>
                          </div>
                          {!isLast && (
                            <div style={{ 
                              flexGrow: 1,
                              height: '1px', 
                              borderTop: `1.5px ${status === 'completed' ? 'solid' : 'dashed'} ${color}`,
                              opacity: status === 'pending' ? 0.25 : 0.6
                            }}></div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Grid content */}
              <div style={{ display: 'grid', gridTemplateColumns: activeJob.video_url ? '1fr 1fr' : '1fr', gap: '20px' }}>
                
                {/* Output Panel (Video or Loader) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <span className="mono-label" style={{ fontSize: '12px', opacity: 0.6 }}>[FIG. A // OUTPUT_STREAM]</span>
                
                {activeJob.video_url ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ border: '1px solid var(--border-color)', padding: '10px', backgroundColor: '#000000' }}>
                      <video 
                        src={`http://localhost:3000${activeJob.video_url}`} 
                        controls 
                        style={{ width: '100%', display: 'block', borderRadius: '2px' }}
                      />
                    </div>
                    {activeJob.status === 'FAILED' && (
                      <div style={{ 
                        border: '1px solid #ef4444', 
                        padding: '12px', 
                        backgroundColor: 'rgba(239, 68, 68, 0.05)', 
                        color: '#ef4444',
                        fontFamily: 'IBM Plex Mono, monospace',
                        fontSize: '11px',
                        lineHeight: '1.4'
                      }}>
                        [!] POST-COMPILATION FAILURE (e.g. Auto-upload phase).<br/>
                        Successfully compiled video binary has been preserved above.
                      </div>
                    )}
                  </div>
                ) : activeJob.status === 'FAILED' ? (
                  <div style={{ 
                    border: '1px solid #ef4444', 
                    padding: '24px', 
                    backgroundColor: 'rgba(239, 68, 68, 0.05)', 
                    color: '#ef4444',
                    fontFamily: 'IBM Plex Mono, monospace',
                    fontSize: '13px'
                  }}>
                    [!] PIPELINE EXECUTION FAILED.<br/>
                    Please check container logs for exact diagnostic code.
                  </div>
                ) : (
                  <div style={{ 
                    border: '1px solid var(--border-color)', 
                    padding: '40px', 
                    display: 'flex', 
                    flexDirection: 'column', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    gap: '15px'
                  }}>
                    <span className="pulse-dot" style={{ width: '20px', height: '20px' }}></span>
                    <span className="mono-label" style={{ fontSize: '13px' }}>PIPELINE SYNTHESIZING VIDEO STREAMS...</span>
                  </div>
                )}
              </div>

              {/* Script / Metadata Panel */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <span className="mono-label" style={{ fontSize: '12px', opacity: 0.6 }}>[FIG. B // COMPILATION_METADATA]</span>
                
                {activeJob.script ? (
                  <div style={{ 
                    border: '1px solid var(--border-color)', 
                    padding: '16px', 
                    maxHeight: '350px', 
                    overflowY: 'auto',
                    backgroundColor: 'var(--panel-bg)',
                    fontFamily: 'IBM Plex Mono, monospace',
                    fontSize: '12px'
                  }}>
                    <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '8px', marginBottom: '12px', fontWeight: 'bold' }}>
                      GENERATED NARRATION & SEGMENT GRAPH:
                    </div>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text-color)', opacity: 0.9 }}>
                      {activeJob.script}
                    </pre>
                  </div>
                ) : (
                  <div style={{ 
                    border: '1px solid var(--border-color)', 
                    padding: '20px', 
                    color: 'var(--text-color)', 
                    opacity: 0.5,
                    fontFamily: 'IBM Plex Mono, monospace',
                    fontSize: '12px'
                  }}>
                    Waiting for script generation segment parser...
                  </div>
                )}
                
                {/* System details */}
                <div style={{ 
                  borderTop: '1px solid var(--border-color)', 
                  paddingTop: '15px', 
                  fontSize: '11px', 
                  fontFamily: 'IBM Plex Mono, monospace',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  opacity: 0.7
                }}>
                  <div>JOB_UUID: {activeJob.id}</div>
                  <div>PIPELINE_STATUS: {activeJob.status}</div>
                  <div>TIMESTAMP: {new Date(activeJob.created_at).toLocaleString()}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* SYSTEM SETTINGS MODAL */}
      {showSettings && (
        <div className="schematic-modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="schematic-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '750px' }}>
            
            {/* Settings Header */}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              borderBottom: '1px solid var(--border-color)',
              padding: '16px 20px',
            }}>
              <div>
                <span className="schematic-tag">CONFIGURATION // PROMPT SETTINGS</span>
                <h3 style={{ fontSize: '1.5rem', margin: '4px 0 0 0' }}>SYSTEM PROMPT CONFIGURATION</h3>
              </div>
              <button 
                onClick={() => setShowSettings(false)} 
                className="btn-schematic" 
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                [CLOSE]
              </button>
            </div>

            {/* Settings Body */}
            <form onSubmit={saveSettings} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span className="mono-label" style={{ fontSize: '12px', opacity: 0.6 }}>[SYSTEM_PROMPT_TEMPLATE]</span>
                <textarea 
                  rows={15}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  disabled={savingSettings}
                  style={{ 
                    width: '100%', 
                    background: 'transparent', 
                    color: 'var(--text-color)', 
                    border: '1px solid var(--border-color)', 
                    padding: '12px', 
                    fontFamily: 'IBM Plex Mono, monospace', 
                    fontSize: '12px',
                    outline: 'none',
                    resize: 'vertical',
                    lineHeight: '1.5'
                  }}
                />
              </div>

              <button 
                type="submit" 
                className="btn-schematic accented" 
                disabled={savingSettings || !systemPrompt}
                style={{ width: '100%' }}
              >
                {savingSettings ? 'SAVING CONFIGURATION...' : 'SAVE & APPLY SETTINGS'}
              </button>
            </form>

          </div>
        </div>
      )}

    </div>
  );
}

export default App;
