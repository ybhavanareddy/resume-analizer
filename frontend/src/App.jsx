// src/App.jsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

function UploadTab({ onNew }) {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!file) return setError('Pick a PDF first.');
    const fd = new FormData();
    fd.append('resume', file);
    setLoading(true);
    try {
      const r = await axios.post(`${API}/api/upload`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(r.data);
      if (onNew) onNew();
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel">
      <h2>Analyze Resume (PDF)</h2>
      <form onSubmit={handleSubmit}>
        <input type="file" accept="application/pdf" onChange={(e)=>setFile(e.target.files?.[0])} />
        <button type="submit" disabled={loading}>{loading? 'Processing...' : 'Upload & Analyze'}</button>
      </form>
      {error && <p className="error">{error}</p>}
      {result && (
        <div className="result">
          <h3>Result</h3>
          <pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(result.parsed || result.raw || result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function HistoryTab({ onOpen }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  async function fetchRows() {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/api/resumes`);
      setRows(r.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(()=>{ fetchRows(); }, []);

  return (
    <div className="panel">
      <h2>History</h2>
      <button onClick={fetchRows}>Refresh</button>
      {loading? <p>Loading...</p> : (
        <table className="history-table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>File</th><th>Created</th><th>Details</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td>{r.name || '-'}</td>
                <td>{r.email || '-'}</td>
                <td>{r.file_name}</td>
                <td>{new Date(r.created_at).toLocaleString()}</td>
                <td><button onClick={() => onOpen(r.id)}>Details</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DetailsModal({ id, onClose }) {
  const [data, setData] = useState(null);
  useEffect(()=>{
    if (!id) return;
    (async ()=> {
      try {
        const r = await axios.get(`${API}/api/resumes/${id}`);
        setData(r.data);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [id]);

  if (!id) return null;
  return (
    <div className="modal">
      <div className="modal-inner">
        <button className="close" onClick={onClose}>X</button>
        {!data? <p>Loading...</p> : (
          <>
            <h3>Resume: {data.name || data.file_name}</h3>
            <p><strong>Email:</strong> {data.email}</p>
            <p><strong>Phone:</strong> {data.phone}</p>
            <h4>Summary</h4>
            <p>{data.summary}</p>

            <h4>Work Experience</h4>
            <pre>{JSON.stringify(data.work_experience, null, 2)}</pre>

            <h4>Education</h4>
            <pre>{JSON.stringify(data.education, null, 2)}</pre>

            <h4>Skills</h4>
            <p><strong>Technical:</strong> {JSON.stringify(data.technical_skills)}</p>
            <p><strong>Soft:</strong> {JSON.stringify(data.soft_skills)}</p>

            <h4>AI Feedback</h4>
            <p><strong>Rating:</strong> {data.rating}</p>
            <p><strong>Feedback:</strong> {data.feedback}</p>
            <p><strong>Suggested Skills:</strong> {JSON.stringify(data.suggested_skills)}</p>

            <h4>Raw Text</h4>
            <pre style={{maxHeight:200, overflow:'auto'}}>{data.raw_text}</pre>
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState('analyze');
  const [modalId, setModalId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="app">
      <header>
        <h1>Resume Analyzer</h1>
        <nav>
          <button onClick={()=>setTab('analyze')} className={tab==='analyze' ? 'active' : ''}>Analyze</button>
          <button onClick={()=>setTab('history')} className={tab==='history' ? 'active' : ''}>History</button>
        </nav>
      </header>

      <main>
        {tab === 'analyze' && <UploadTab onNew={()=>setRefreshKey(k=>k+1)} />}
        {tab === 'history' && <HistoryTab onOpen={(id)=>setModalId(id)} key={refreshKey} />}
      </main>

      <DetailsModal id={modalId} onClose={()=>setModalId(null)} />


    </div>
  );
}
