import React from 'react';

interface LLMSettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  llmProvider: string;
  setLlmProvider: (val: string) => void;
  llmModel: string;
  setLlmModel: (val: string) => void;
  imageModel: string;
  setImageModel: (val: string) => void;
  togetherApiKey: string;
  setTogetherApiKey: (val: string) => void;
  openaiApiKey: string;
  setOpenaiApiKey: (val: string) => void;
  ollamaUrl: string;
  setOllamaUrl: (val: string) => void;
  savingLLMSettings: boolean;
  onSave: (e: React.FormEvent) => void;
}

export const LLMSettingsPanel: React.FC<LLMSettingsPanelProps> = ({
  isOpen,
  onClose,
  llmProvider,
  setLlmProvider,
  llmModel,
  setLlmModel,
  imageModel,
  setImageModel,
  togetherApiKey,
  setTogetherApiKey,
  openaiApiKey,
  setOpenaiApiKey,
  ollamaUrl,
  setOllamaUrl,
  savingLLMSettings,
  onSave
}) => {
  if (!isOpen) return null;

  return (
    <div className="schematic-modal-overlay" onClick={onClose}>
      <div className="schematic-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
        
        {/* Settings Header */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          borderBottom: '1px solid var(--border-color)',
          padding: '16px 20px',
        }}>
          <div>
            <span className="schematic-tag">CONFIGURATION // LLM ENGINE</span>
            <h3 style={{ fontSize: '1.5rem', margin: '4px 0 0 0' }}>LLM SYSTEM SETTINGS</h3>
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
        <form onSubmit={onSave} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span className="mono-label" style={{ fontSize: '11px', opacity: 0.6 }}>LLM_PROVIDER</span>
            <select 
              value={llmProvider}
              onChange={(e) => setLlmProvider(e.target.value)}
              disabled={savingLLMSettings}
              className="schematic-input"
              style={{ width: '100%', height: '40px', padding: '8px', cursor: 'pointer' }}
            >
              <option value="together">Together AI (Cloud)</option>
              <option value="openai">OpenAI (Cloud)</option>
              <option value="ollama">Ollama (Local/Self-hosted)</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span className="mono-label" style={{ fontSize: '11px', opacity: 0.6 }}>LLM_MODEL</span>
            <input 
              type="text"
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              disabled={savingLLMSettings}
              placeholder="e.g. google/gemma-4-31B-it, gpt-4o, qwen3:8b"
              className="schematic-input"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span className="mono-label" style={{ fontSize: '11px', opacity: 0.6 }}>IMAGE_MODEL</span>
            <input 
              type="text"
              value={imageModel}
              onChange={(e) => setImageModel(e.target.value)}
              disabled={savingLLMSettings}
              placeholder="e.g. stabilityai/stable-diffusion-xl-base-1.0, black-forest-labs/FLUX.1-schnell"
              className="schematic-input"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span className="mono-label" style={{ fontSize: '11px', opacity: 0.6 }}>TOGETHER_API_KEY</span>
            <input 
              type="password"
              value={togetherApiKey}
              onChange={(e) => setTogetherApiKey(e.target.value)}
              disabled={savingLLMSettings}
              placeholder={togetherApiKey === '__MASKED_SECRET__' ? '••••••••••••••••' : 'Enter Together AI token'}
              className="schematic-input"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span className="mono-label" style={{ fontSize: '11px', opacity: 0.6 }}>OPENAI_API_KEY</span>
            <input 
              type="password"
              value={openaiApiKey}
              onChange={(e) => setOpenaiApiKey(e.target.value)}
              disabled={savingLLMSettings}
              placeholder={openaiApiKey === '__MASKED_SECRET__' ? '••••••••••••••••' : 'Enter OpenAI API Key'}
              className="schematic-input"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span className="mono-label" style={{ fontSize: '11px', opacity: 0.6 }}>OLLAMA_URL</span>
            <input 
              type="text"
              value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)}
              disabled={savingLLMSettings}
              placeholder="e.g. http://host.docker.internal:11434"
              className="schematic-input"
            />
          </div>

          <button 
            type="submit" 
            className="btn-schematic accented" 
            disabled={savingLLMSettings || !llmProvider || !llmModel}
            style={{ width: '100%', marginTop: '10px' }}
          >
            {savingLLMSettings ? 'SAVING CONFIGURATION...' : 'SAVE & APPLY LLM CONFIG'}
          </button>
        </form>

      </div>
    </div>
  );
};
