'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

interface CaseSummary {
  id: string;
  clinicalQuestion: string;
  patientAge: string;
  bodyRegion: string;
  modelId?: string;
  imagePaths?: string[];
  imagePath?: string;
  createdAt: string;
  status: string;
  terminationState?: string;
}

interface ModelInfo {
  id: string;
  provider: string;
  model: string;
  label: string;
  vision: boolean;
  available: boolean;
}

type Sample = { id: string; label: string; description: string };

export default function HomePage() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loadingSampleId, setLoadingSampleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Controlled form fields so a sample packet can pre-fill them.
  const [clinicalQuestion, setClinicalQuestion] = useState('');
  const [bodyRegion, setBodyRegion] = useState('chest');
  const [patientAge, setPatientAge] = useState('');
  const [patientSymptoms, setPatientSymptoms] = useState('');
  const [patientHistory, setPatientHistory] = useState('');
  const [modelId, setModelId] = useState('mock/canned-responses');

  const loadCases = useCallback(async () => {
    const res = await fetch('/api/xray/cases');
    const data = await res.json();
    setCases(data.cases || []);
  }, []);

  const loadModels = useCallback(async () => {
    const res = await fetch('/api/xray/models');
    const data = await res.json();
    const list: ModelInfo[] = data.models || [];
    setModels(list);
    // Default to the first real (available) model if any are configured;
    // fall back to the mock provider otherwise.
    const firstAvailable = list.find((m) => m.available);
    if (firstAvailable) setModelId(firstAvailable.id);
  }, []);

  const loadSamples = useCallback(async () => {
    try {
      const res = await fetch('/api/xray/samples');
      if (!res.ok) return;
      const data = await res.json();
      setSamples(data.samples || []);
    } catch { /* samples optional */ }
  }, []);

  useEffect(() => { loadCases(); loadModels(); loadSamples(); }, [loadCases, loadModels, loadSamples]);

  const loadSample = async (sample: Sample) => {
    if (loading) return;
    setLoadingSampleId(sample.id);
    try {
      const res = await fetch(`/api/xray/samples/${encodeURIComponent(sample.id)}`);
      if (!res.ok) return;
      const data = await res.json();
      const f = data.fields || {};
      setClinicalQuestion(f.clinicalQuestion || '');
      setBodyRegion(f.bodyRegion || 'chest');
      setPatientAge(f.patientAge || '');
      setPatientSymptoms(f.patientSymptoms || '');
      setPatientHistory(f.patientHistory || '');
      // Build a File from the inlined base64 image and attach it.
      if (data.image?.base64) {
        const bin = atob(data.image.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const file = new File([bytes], data.image.filename || `${sample.id}.jpg`, { type: data.image.mime || 'image/jpeg' });
        setSelectedFiles([file]);
        setPreviews([URL.createObjectURL(file)]);
      }
    } catch { /* ignore */ } finally {
      setLoadingSampleId(null);
    }
  };

  const addFiles = (files: FileList | File[]) => {
    const newFiles = Array.from(files);
    setSelectedFiles(prev => {
      const combined = [...prev, ...newFiles];
      // Update previews
      setPreviews(combined.map(f => URL.createObjectURL(f)));
      return combined;
    });
  };

  const removeFile = (idx: number) => {
    setSelectedFiles(prev => {
      const next = prev.filter((_, i) => i !== idx);
      setPreviews(next.map(f => URL.createObjectURL(f)));
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFiles.length === 0) return;
    setLoading(true);
    const fd = new FormData(formRef.current!);
    // Append all selected files under 'images' key
    for (const file of selectedFiles) {
      fd.append('images', file);
    }
    try {
      await fetch('/api/xray/cases', { method: 'POST', body: fd });
      setSelectedFiles([]);
      setPreviews([]);
      formRef.current?.reset();
      // Poll for completion
      setTimeout(loadCases, 500);
      setTimeout(loadCases, 2000);
      setTimeout(loadCases, 5000);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="upload-section">
        <h1>Upload <em>X-Ray</em></h1>
        <p>Submit a diagnostic image with clinical context for IRG-powered analysis.</p>

        {samples.length > 0 && (
          <div className="sample-row">
            <span className="sample-label">Sample cases</span>
            {samples.map(s => (
              <button
                key={s.id}
                type="button"
                className="sample-chip"
                disabled={loading || loadingSampleId === s.id}
                onClick={() => loadSample(s)}
                title={s.description}
              >
                {loadingSampleId === s.id ? 'loading…' : `🩻 ${s.label}`}
              </button>
            ))}
          </div>
        )}

        <form ref={formRef} className="upload-form" onSubmit={handleSubmit}>
          <div className="field-row">
            <div className="field">
              <label>Clinical Question <span className="req">*</span></label>
              <input name="clinicalQuestion" placeholder="e.g. Evaluate for infiltrate" required
                value={clinicalQuestion} onChange={e => setClinicalQuestion(e.target.value)} />
            </div>
            <div className="field">
              <label>Body Region</label>
              <select name="bodyRegion" value={bodyRegion} onChange={e => setBodyRegion(e.target.value)}>
                <option value="chest">Chest</option>
                <option value="abdomen">Abdomen</option>
                <option value="extremity">Extremity</option>
                <option value="spine">Spine</option>
                <option value="head">Head</option>
              </select>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label>Patient Age</label>
              <input name="patientAge" placeholder="e.g. 65"
                value={patientAge} onChange={e => setPatientAge(e.target.value)} />
            </div>
            <div className="field">
              <label>Symptoms</label>
              <input name="patientSymptoms" placeholder="e.g. Cough, fever"
                value={patientSymptoms} onChange={e => setPatientSymptoms(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label>Relevant History</label>
            <textarea name="patientHistory" placeholder="e.g. Hypertension, no prior lung disease"
              value={patientHistory} onChange={e => setPatientHistory(e.target.value)} />
          </div>

          <div className="field">
            <label>Model</label>
            <select name="modelId" value={modelId} onChange={e => setModelId(e.target.value)}>
              {models.filter(m => m.available).map(m => (
                <option key={m.id} value={m.id}>
                  {m.label}{m.vision ? ' 👁' : ''}
                </option>
              ))}
              <option value="mock/canned-responses">Mock (Canned Responses)</option>
            </select>
          </div>

          <div
            className={`dropzone ${dragActive ? 'active' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={e => {
              e.preventDefault();
              setDragActive(false);
              if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
            }}
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={e => e.target.files?.length && addFiles(e.target.files)}
            />
            {previews.length > 0 ? (
              <div className="dropzone-previews">
                {previews.map((url, i) => (
                  <div key={i} className="dropzone-preview-item">
                    <img src={url} alt={`View ${i + 1}`} />
                    <button
                      type="button"
                      className="dropzone-remove"
                      onClick={e => { e.stopPropagation(); removeFile(i); }}
                    >×</button>
                    <span className="dropzone-view-label">View {i + 1}</span>
                  </div>
                ))}
                <div className="dropzone-add-more" onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}>
                  <span>+</span>
                </div>
              </div>
            ) : (
              <>
                <div className="dropzone-icon">🩻</div>
                <div className="dropzone-text">
                  <strong>Drop X-ray images</strong> or click to browse
                  <br /><small>Multiple views supported (e.g. frontal + lateral)</small>
                </div>
              </>
            )}
          </div>

          <button type="submit" className="submit-btn" disabled={loading || selectedFiles.length === 0}>
            {loading ? <><span className="spinner" /> Analyzing…</> : 'Run Diagnosis'}
          </button>
        </form>
      </div>

      <div className="case-list-section">
        <div className="section-label">Previous Cases</div>
        {cases.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <p>No cases yet. Upload an X-ray to get started.</p>
          </div>
        ) : (
          <div className="case-grid">
            {cases.map(c => (
              <a key={c.id} href={`/medical/xray/case/${c.id}`} className="case-card">
                <img className="case-card-image" src={c.imagePaths?.[0] || c.imagePath || ''} alt="X-ray" />
                <div className="case-card-body">
                  <h3>{c.clinicalQuestion || 'Untitled Case'}</h3>
                  <div className="case-card-meta">
                    {c.bodyRegion} · Age {c.patientAge || '—'} · {new Date(c.createdAt).toLocaleDateString()}
                  </div>
                  <span className={`case-card-status ${c.status === 'completed' ? 'converged' : c.status}`}>
                    {c.status === 'completed' ? c.terminationState || 'completed' : c.status}
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

