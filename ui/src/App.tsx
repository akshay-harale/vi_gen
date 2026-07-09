import { useState, useEffect } from 'react';
import './index.css';
import type { Job, Segment } from './types';
import { SettingsPanel } from './components/SettingsPanel';
import { LLMSettingsPanel } from './components/LLMSettingsPanel';
import { TimelineEditorModal } from './components/TimelineEditorModal';

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
  
  // LLM Settings state
  const [showLLMSettings, setShowLLMSettings] = useState(false);
  const [llmProvider, setLlmProvider] = useState('together');
  const [llmModel, setLlmModel] = useState('');
  const [imageModel, setImageModel] = useState('');
  const [togetherApiKey, setTogetherApiKey] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [ollamaUrl, setOllamaUrl] = useState('');
  const [savingLLMSettings, setSavingLLMSettings] = useState(false);

  // Video Editor state
  const [editingSegments, setEditingSegments] = useState<Segment[]>([]);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [segmentLoading, setSegmentLoading] = useState<Record<number, boolean>>({});
  const [recompilingJobId, setRecompilingJobId] = useState<string | null>(null);
  const [showSegmentEditor, setShowSegmentEditor] = useState(false);
  const [cacheBuster, setCacheBuster] = useState<Record<string, number>>({});
  const [addingSegment, setAddingSegment] = useState(false);

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
        setSystemPrompt(data.system_prompt);
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
      } else {
        alert('Failed to save settings');
      }
    } catch (err) {
      console.error(err);
      alert('Error saving settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const fetchLLMSettings = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/settings/llm');
      if (res.ok) {
        const data = await res.json();
        setLlmProvider(data.llm_provider || 'together');
        setLlmModel(data.llm_model || '');
        setImageModel(data.image_model || '');
        setTogetherApiKey(data.together_api_key || '');
        setOpenaiApiKey(data.openai_api_key || '');
        setOllamaUrl(data.ollama_url || '');
      }
    } catch (err) {
      console.error('Failed to fetch LLM settings', err);
    }
  };

  const saveLLMSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingLLMSettings(true);
    try {
      const res = await fetch('http://localhost:3000/api/settings/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          llm_provider: llmProvider,
          llm_model: llmModel,
          image_model: imageModel,
          together_api_key: togetherApiKey,
          openai_api_key: openaiApiKey,
          ollama_url: ollamaUrl
        })
      });
      if (res.ok) {
        setShowLLMSettings(false);
      } else {
        alert('Failed to save LLM settings');
      }
    } catch (err) {
      console.error(err);
      alert('Error saving LLM settings');
    } finally {
      setSavingLLMSettings(false);
    }
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

  const createJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setLoading(true);
    try {
      const res = await fetch('http://localhost:3000/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (res.ok) {
        const data = await res.json();
        setPrompt('');
        fetchJobs();
        setActiveJobId(data.jobId);
      } else {
        alert('Failed to submit job');
      }
    } catch (err) {
      console.error(err);
      alert('Error submitting job');
    } finally {
      setLoading(false);
    }
  };

  const navigateJob = (dir: 'prev' | 'next') => {
    if (!activeJobId || jobs.length === 0) return;
    const currentIndex = jobs.findIndex(j => j.id === activeJobId);
    if (dir === 'prev' && currentIndex > 0) {
      setActiveJobId(jobs[currentIndex - 1].id);
    } else if (dir === 'next' && currentIndex < jobs.length - 1) {
      setActiveJobId(jobs[currentIndex + 1].id);
    }
  };

  // Keyboard navigation for active build slides
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!activeJobId || showSegmentEditor) return;
      
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      if (tag === 'textarea' || tag === 'input' || tag === 'select') return;

      if (e.key === 'ArrowLeft') {
        const currentIndex = jobs.findIndex(j => j.id === activeJobId);
        const prevIndex = currentIndex - 1;
        if (prevIndex >= 0) setActiveJobId(jobs[prevIndex].id);
      } else if (e.key === 'ArrowRight') {
        const currentIndex = jobs.findIndex(j => j.id === activeJobId);
        const nextIndex = currentIndex + 1;
        if (nextIndex < jobs.length) setActiveJobId(jobs[nextIndex].id);
      } else if (e.key === 'Escape') {
        setActiveJobId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeJobId, jobs, showSegmentEditor]);

  useEffect(() => {
    if (activeJob) {
      if (activeJob.id !== editingJobId) {
        setEditingJobId(activeJob.id);
        try {
          const parsed = JSON.parse(activeJob.script || '[]');
          setEditingSegments(parsed);
        } catch (e) {
          setEditingSegments([]);
        }
      }
    } else {
      setEditingJobId(null);
      setEditingSegments([]);
    }
  }, [activeJob, editingJobId]);

  const handleSaveSegment = async (idx: number) => {
    if (!activeJob) return;
    setSegmentLoading(prev => ({ ...prev, [idx]: true }));
    try {
      const seg = editingSegments[idx];
      const res = await fetch(`http://localhost:3000/api/jobs/${activeJob.id}/segments/${idx}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seg)
      });
      if (res.ok) {
        // Update cache buster timestamp
        setCacheBuster(prev => ({ ...prev, [`${activeJob.id}_${idx}`]: Date.now() }));
        // Fetch jobs to get latest updates
        await fetchJobs();
      } else {
        const errorData = await res.json().catch(() => ({}));
        alert(`Failed to save segment: ${errorData.error || res.statusText}`);
      }
    } catch (err: any) {
      console.error(err);
      alert(`Error saving segment: ${err.message}`);
    } finally {
      setSegmentLoading(prev => ({ ...prev, [idx]: false }));
    }
  };

  const handleAddSegment = async () => {
    if (!activeJob) return;
    setAddingSegment(true);
    try {
      const res = await fetch(`http://localhost:3000/api/jobs/${activeJob.id}/segments/add`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        setEditingSegments(data.segments);
        // Refresh job details
        await fetchJobs();
      } else {
        alert('Failed to add segment');
      }
    } catch (err) {
      console.error(err);
      alert('Error adding segment');
    } finally {
      setAddingSegment(false);
    }
  };

  const handleInsertSegmentAt = async (idx: number) => {
    if (!activeJob) return;
    setAddingSegment(true);
    try {
      const res = await fetch(`http://localhost:3000/api/jobs/${activeJob.id}/segments/add-at/${idx}`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        setEditingSegments(data.segments);
        // Refresh job details
        await fetchJobs();
      } else {
        alert('Failed to insert segment');
      }
    } catch (err) {
      console.error(err);
      alert('Error inserting segment');
    } finally {
      setAddingSegment(false);
    }
  };

  const handleDeleteSegment = async (idx: number) => {
    if (!activeJob) return;
    if (!window.confirm(`Are you sure you want to delete Segment ${idx + 1}? This will permanently remove its generated voice and image assets.`)) {
      return;
    }
    try {
      const res = await fetch(`http://localhost:3000/api/jobs/${activeJob.id}/segments/${idx}/delete`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        setEditingSegments(data.segments);
        // Refresh job details
        await fetchJobs();
      } else {
        alert('Failed to delete segment');
      }
    } catch (err) {
      console.error(err);
      alert('Error deleting segment');
    }
  };

  const handleRecompileVideo = async () => {
    if (!activeJob) return;
    setRecompilingJobId(activeJob.id);
    try {
      const res = await fetch(`http://localhost:3000/api/jobs/${activeJob.id}/recompile`, {
        method: 'POST'
      });
      if (res.ok) {
        await fetchJobs();
      } else {
        alert('Failed to trigger video recompilation');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRecompilingJobId(null);
    }
  };

  useEffect(() => {
    fetchJobs();
    fetchSettings();
    fetchLLMSettings();

    const interval = window.setInterval(() => {
      fetchJobs();
    }, 2000);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="app-container">
      
      {/* Schematic Layout Grid */}
      <header className="schematic-header">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="mono-label" style={{ opacity: 0.5, fontSize: '10px' }}>STARK_SYSTEMS // AI_PIPELINE</div>
          <h1 className="schematic-title">VI_GEN // DIGITAL RENDER GRAPH</h1>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => { fetchSettings(); setShowSettings(true); }} className="btn-schematic">
            [PROMPT SETTINGS]
          </button>
          <button onClick={() => { fetchLLMSettings(); setShowLLMSettings(true); }} className="btn-schematic">
            [LLM CONFIG]
          </button>
          <button onClick={toggleTheme} className="btn-schematic">
            {theme === 'light' ? '[DARK_MODE]' : '[LIGHT_MODE]'}
          </button>
        </div>
      </header>

      <main className="schematic-grid">
        
        {/* Panel A: Command Panel */}
        <section className="schematic-panel">
          <span className="mono-label" style={{ marginBottom: '15px' }}>[PANEL_A // PIPELINE_INPUT_CONTROLLER]</span>
          
          <form onSubmit={createJob} className="schematic-form">
            <textarea
              className="schematic-textarea"
              placeholder="ENTER TRANSCRIPT SCRIPT OUTLINE OR COMPILATION CONCEPTS... (E.G. 'Explain how garbage collection works in Java with short code snippet')"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={loading}
              rows={6}
            />
            
            <button 
              type="submit" 
              className="btn-schematic accented" 
              disabled={loading || !prompt.trim()}
              style={{ width: '100%', height: '48px', fontSize: '14px', fontWeight: 'bold', letterSpacing: '1px' }}
            >
              {loading ? '[COMPILING PIPELINE GRAPH...]' : '⚡ GENERATE VIDEO FROM TECHNICAL SCRIPT'}
            </button>
          </form>
        </section>

        {/* Panel B: Data Feed */}
        <section className="schematic-panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <span className="mono-label" style={{ marginBottom: '15px' }}>[PANEL_B // PIPELINE_EXECUTION_STREAMS]</span>
          
          <div style={{ flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '5px' }}>
            {jobs.length === 0 ? (
              <div style={{ padding: '20px', border: '1px dashed var(--border-color)', textAlign: 'center', opacity: 0.5, fontFamily: 'IBM Plex Mono, monospace' }}>
                NO PIPELINE EXECUTION STREAMS REGISTERED
              </div>
            ) : (
              jobs.map((job, idx) => (
                <div 
                  key={job.id} 
                  className={`schematic-job-card ${activeJob?.id === job.id ? 'active' : ''}`}
                  onClick={() => setActiveJobId(job.id)}
                  style={{
                    border: '1px solid var(--border-color)',
                    padding: '12px 16px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                    backgroundColor: activeJob?.id === job.id ? 'var(--accent-color)' : 'transparent',
                    color: activeJob?.id === job.id ? 'var(--bg-color)' : 'var(--text-color)',
                    transition: 'all 0.1s ease-in-out'
                  }}
                  onMouseEnter={(e) => {
                    if (activeJobId !== job.id) {
                      e.currentTarget.style.backgroundColor = 'var(--panel-bg)';
                    }
                  }}
                  onMouseLeave={(e) => {
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
              ))
            )}
          </div>
        </section>

      </main>

      {/* ACTIVE JOB SLIDE MODAL WINDOW */}
      {activeJob && (
      <div className="schematic-modal-overlay" onClick={() => setActiveJobId(null)}>
        <div className="schematic-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '1000px', width: '90%' }}>
          
          {/* Modal Header */}
          <div className="schematic-modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '15px' }}>
            <div>
              <span className="schematic-tag">BUILD STATUS: {activeJob.status}</span>
              <h2 style={{ margin: '5px 0 0 0', fontSize: '1.8rem', letterSpacing: '-0.5px' }}>{activeJob.prompt}</h2>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button 
                onClick={() => navigateJob('prev')} 
                disabled={jobs.findIndex(j => j.id === activeJobId) <= 0}
                className="btn-schematic" 
                style={{ padding: '6px 12px', fontSize: '12px' }}
                title="Previous Job (Arrow Left)"
              >
                [&lt;]
              </button>
              <button 
                onClick={() => navigateJob('next')} 
                disabled={jobs.findIndex(j => j.id === activeJobId) >= jobs.length - 1}
                className="btn-schematic" 
                style={{ padding: '6px 12px', fontSize: '12px' }}
                title="Next Job (Arrow Right)"
              >
                [&gt;]
              </button>
              <button 
                onClick={() => {
                  fetchLLMSettings();
                  setShowSegmentEditor(true);
                }}
                className="btn-schematic accented" 
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                ⚡ OPEN TIMELINE EDITOR
              </button>
              <button 
                onClick={() => setActiveJobId(null)} 
                className="btn-schematic" 
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                [CLOSE]
              </button>
            </div>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="mono-label" style={{ fontSize: '12px', opacity: 0.6 }}>[FIG. B // NARRATION_FLOW_OVERVIEW]</span>
                <button 
                  onClick={() => {
                    fetchLLMSettings();
                    setShowSegmentEditor(true);
                  }}
                  className="btn-schematic accented" 
                  style={{ padding: '6px 14px', fontSize: '11px' }}
                >
                  ⚡ OPEN TIMELINE EDITOR
                </button>
              </div>
              
              {activeJob.script ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '350px', overflowY: 'auto', paddingRight: '5px' }}>
                  {editingSegments.map((seg, idx) => (
                    <div key={idx} style={{ 
                      border: '1px solid var(--border-color)', 
                      padding: '12px 16px',
                      backgroundColor: 'var(--panel-bg)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      fontSize: '12px'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: 0.8 }}>
                        <span className="schematic-tag" style={{ margin: 0, padding: '2px 6px', fontSize: '10px' }}>SEGMENT {String(idx + 1).padStart(2, '0')}</span>
                        {seg.code_snippet && <span className="mono-label" style={{ fontSize: '9px', color: 'var(--accent-color)' }}>[HAS_CODE]</span>}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ lineHeight: '1.4', opacity: 0.95 }}><strong>Narration:</strong> {seg.text}</div>
                        <div style={{ fontSize: '11px', opacity: 0.7, fontFamily: 'IBM Plex Mono, monospace' }}><strong>Prompt:</strong> {seg.image_prompt}</div>
                      </div>
                    </div>
                  ))}
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

              {activeJob.status !== 'PROCESSING' && activeJob.status !== 'PENDING' && (
                <button 
                  onClick={handleRecompileVideo}
                  disabled={recompilingJobId === activeJob.id}
                  className="btn-schematic accented"
                  style={{ 
                    width: '100%', 
                    padding: '12px', 
                    fontSize: '13px', 
                    letterSpacing: '1px',
                    marginTop: '10px'
                  }}
                >
                  {recompilingJobId === activeJob.id ? 'QUEUING RECOMPILATION...' : '⚡ RECOMPILE FINAL VIDEO WITH UPDATED COMPONENTS'}
                </button>
              )}

              {/* System details */}
              <div style={{ 
                borderTop: '1px solid var(--border-color)',
                paddingTop: '12px',
                marginTop: '5px',
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '10px',
                fontFamily: 'IBM Plex Mono, monospace',
                opacity: 0.5
              }}>
                <div>PIPELINE_STATUS: {activeJob.status}</div>
                <div>TIMESTAMP: {new Date(activeJob.created_at).toLocaleString()}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    )}

      {/* Modals Mounting */}
      <SettingsPanel 
        isOpen={showSettings} 
        onClose={() => setShowSettings(false)} 
        systemPrompt={systemPrompt}
        setSystemPrompt={setSystemPrompt}
        savingSettings={savingSettings}
        onSave={saveSettings}
      />

      <LLMSettingsPanel 
        isOpen={showLLMSettings}
        onClose={() => setShowLLMSettings(false)}
        llmProvider={llmProvider}
        setLlmProvider={setLlmProvider}
        llmModel={llmModel}
        setLlmModel={setLlmModel}
        imageModel={imageModel}
        setImageModel={setImageModel}
        togetherApiKey={togetherApiKey}
        setTogetherApiKey={setTogetherApiKey}
        openaiApiKey={openaiApiKey}
        setOpenaiApiKey={setOpenaiApiKey}
        ollamaUrl={ollamaUrl}
        setOllamaUrl={setOllamaUrl}
        savingLLMSettings={savingLLMSettings}
        onSave={saveLLMSettings}
      />

      <TimelineEditorModal 
        isOpen={showSegmentEditor}
        onClose={() => setShowSegmentEditor(false)}
        activeJob={activeJob}
        editingSegments={editingSegments}
        setEditingSegments={setEditingSegments}
        segmentLoading={segmentLoading}
        recompilingJobId={recompilingJobId}
        handleSaveSegment={handleSaveSegment}
        handleRecompileVideo={handleRecompileVideo}
        handleDeleteSegment={handleDeleteSegment}
        handleAddSegment={handleAddSegment}
        handleInsertSegmentAt={handleInsertSegmentAt}
        addingSegment={addingSegment}
        cacheBuster={cacheBuster}
      />

    </div>
  );
}

export default App;
