import React from 'react';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  systemPrompt: string;
  setSystemPrompt: (val: string) => void;
  savingSettings: boolean;
  onSave: (e: React.FormEvent) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  onClose,
  systemPrompt,
  setSystemPrompt,
  savingSettings,
  onSave
}) => {
  if (!isOpen) return null;

  return (
    <div className="schematic-modal-overlay" onClick={onClose}>
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
            onClick={onClose} 
            className="btn-schematic" 
            style={{ padding: '6px 12px', fontSize: '12px' }}
          >
            [CLOSE]
          </button>
        </div>

        {/* Settings Body */}
        <form onSubmit={onSave} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
  );
};
