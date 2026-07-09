import React from 'react';
import { Job, Segment } from '../types';

interface TimelineEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeJob: Job | null;
  editingSegments: Segment[];
  setEditingSegments: React.Dispatch<React.SetStateAction<Segment[]>>;
  segmentLoading: Record<number, boolean>;
  recompilingJobId: string | null;
  handleSaveSegment: (idx: number) => Promise<void>;
  handleRecompileVideo: () => Promise<void>;
  cacheBuster: Record<string, number>;
}

export const TimelineEditorModal: React.FC<TimelineEditorModalProps> = ({
  isOpen,
  onClose,
  activeJob,
  editingSegments,
  setEditingSegments,
  segmentLoading,
  recompilingJobId,
  handleSaveSegment,
  handleRecompileVideo,
  cacheBuster
}) => {
  if (!isOpen || !activeJob) return null;

  return (
    <div className="schematic-modal-overlay" onClick={onClose}>
      <div className="schematic-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '1200px', width: '95%', maxHeight: '90vh', overflowY: 'auto' }}>
        
        {/* Header */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          borderBottom: '1px solid var(--border-color)',
          padding: '16px 20px',
          position: 'sticky',
          top: 0,
          backgroundColor: 'var(--bg-color)',
          zIndex: 10
        }}>
          <div>
            <span className="schematic-tag">TIMELINE EDITOR // BUILD: {activeJob.id.substring(0, 12)}...</span>
            <h3 style={{ fontSize: '1.6rem', margin: '4px 0 0 0', letterSpacing: '-0.5px' }}>STATE GRAPH SEGMENT WORKSTATION</h3>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {activeJob.status !== 'PROCESSING' && activeJob.status !== 'PENDING' && (
              <button 
                onClick={handleRecompileVideo}
                disabled={recompilingJobId === activeJob.id}
                className="btn-schematic accented"
                style={{ padding: '8px 16px', fontSize: '12px' }}
              >
                {recompilingJobId === activeJob.id ? '⚡ QUEUING RECOMPILATION...' : '⚡ RECOMPILE FINAL VIDEO'}
              </button>
            )}
            <button 
              onClick={onClose} 
              className="btn-schematic" 
              style={{ padding: '8px 16px', fontSize: '12px' }}
            >
              [CLOSE EDITOR]
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          <div style={{ 
            border: '1px solid var(--border-color)', 
            padding: '16px', 
            backgroundColor: 'var(--panel-bg)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <span className="mono-label" style={{ fontSize: '11px', opacity: 0.6 }}>[SYSTEM_INSTRUCTION]</span>
            <p style={{ margin: 0, fontSize: '12px', lineHeight: '1.5', opacity: 0.9 }}>
              Edit the individual audio narration script and visual prompt text for each segment card below. Clicking <strong>APPLY EDITS & REGENERATE</strong> will instantly run the specialized in-memory TTS or Together AI image model to update the segment assets. Once finished, click <strong>RECOMPILE FINAL VIDEO</strong> to merge the changes.
            </p>
          </div>

          {editingSegments.map((seg, idx) => {
            const isSaving = segmentLoading[idx] || false;
            
            return (
              <div key={idx} style={{ 
                border: '1px solid var(--border-color)', 
                padding: '24px',
                backgroundColor: 'var(--panel-bg)',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
              }}>
                
                {/* Segment Header */}
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  borderBottom: '1px solid var(--border-color)',
                  paddingBottom: '12px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span className="schematic-tag" style={{ margin: 0, padding: '4px 10px', fontSize: '12px' }}>SEGMENT {String(idx + 1).padStart(2, '0')}</span>
                    {seg.code_snippet && (
                      <span className="mono-label" style={{ fontSize: '11px', color: 'var(--accent-color)' }}>
                        [CODE OVERLAY: {seg.code_language || 'text'}]
                      </span>
                    )}
                  </div>
                  
                  <button
                    onClick={() => handleSaveSegment(idx)}
                    className="btn-schematic accented"
                    disabled={isSaving}
                    style={{ padding: '8px 16px', fontSize: '11px' }}
                  >
                    {isSaving ? '[REGENERATING SEGMENT...]' : '[APPLY EDITS & REGENERATE]'}
                  </button>
                </div>

                {/* Segment Editor Body */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                  
                  {/* Left: Audio/Narration */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="mono-label" style={{ fontSize: '11px', opacity: 0.6 }}>NARRATION SCRIPT (AUDIO TEXT)</span>
                    </div>
                    <textarea
                      rows={6}
                      value={seg.text || ''}
                      onChange={(e) => {
                        const updated = [...editingSegments];
                        updated[idx].text = e.target.value;
                        setEditingSegments(updated);
                      }}
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                      <span className="mono-label" style={{ fontSize: '10px', opacity: 0.4 }}>AUDIO PREVIEW PLAYBACK:</span>
                      <audio 
                        key={`${activeJob.id}_${idx}_${isSaving}`}
                        src={`http://localhost:3000/output/${activeJob.id}_${idx}.wav${cacheBuster[`${activeJob.id}_${idx}`] ? `?t=${cacheBuster[`${activeJob.id}_${idx}`]}` : ''}`} 
                        controls 
                        style={{ height: '36px', width: '100%' }}
                      />
                    </div>
                  </div>

                  {/* Right: Visual Prompt / Image */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="mono-label" style={{ fontSize: '11px', opacity: 0.6 }}>VISUAL SCHEMATIC PROMPT (IMAGE GENERATION)</span>
                    </div>
                    <textarea
                      rows={6}
                      value={seg.image_prompt || ''}
                      onChange={(e) => {
                        const updated = [...editingSegments];
                        updated[idx].image_prompt = e.target.value;
                        setEditingSegments(updated);
                      }}
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
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                      <span className="mono-label" style={{ fontSize: '10px', opacity: 0.4 }}>SCHEMATIC IMAGE RENDER PREVIEW:</span>
                      <div style={{ 
                        height: '240px', 
                        border: '1px solid var(--border-color)',
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: '#000000',
                        overflow: 'hidden'
                      }}>
                        <img 
                          key={`${activeJob.id}_${idx}_${isSaving}`}
                          src={`http://localhost:3000/output/${activeJob.id}_${idx}.jpg${cacheBuster[`${activeJob.id}_${idx}`] ? `?t=${cacheBuster[`${activeJob.id}_${idx}`]}` : ''}`} 
                          alt={`Segment ${idx} visual preview`}
                          style={{ height: '100%', objectFit: 'contain' }}
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      </div>
                    </div>
                  </div>

                </div>

                {/* Optional Code Snippet Overlay Row */}
                {seg.code_snippet !== undefined && seg.code_snippet !== null && (
                  <div style={{ 
                    borderTop: '1px dashed var(--border-color)', 
                    paddingTop: '16px',
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '24px'
                  }}>
                    {/* Code Snippet Textarea */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <span className="mono-label" style={{ fontSize: '11px', opacity: 0.6 }}>CODE OVERLAY SNIPPET</span>
                      <textarea
                        rows={5}
                        value={seg.code_snippet || ''}
                        onChange={(e) => {
                          const updated = [...editingSegments];
                          updated[idx].code_snippet = e.target.value;
                          setEditingSegments(updated);
                        }}
                        placeholder="Type code snippet here... (max 35 chars per line)"
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
                          lineHeight: '1.4'
                        }}
                      />
                    </div>

                    {/* Code Language Input */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <span className="mono-label" style={{ fontSize: '11px', opacity: 0.6 }}>CODE SYNTAX LANGUAGE</span>
                      <input
                        type="text"
                        value={seg.code_language || ''}
                        onChange={(e) => {
                          const updated = [...editingSegments];
                          updated[idx].code_language = e.target.value;
                          setEditingSegments(updated);
                        }}
                        placeholder="e.g. java, python, javascript, text"
                        className="schematic-input"
                        style={{ width: '100%' }}
                      />
                      <p style={{ margin: 0, fontSize: '11px', opacity: 0.4, lineHeight: '1.4' }}>
                        Changing only the code snippet or syntax language will run a super-fast local graphics update on the existing schematic background, bypassing Together AI image model generation completely.
                      </p>
                    </div>
                  </div>
                )}

              </div>
            );
          })}

        </div>

      </div>
    </div>
  );
};
