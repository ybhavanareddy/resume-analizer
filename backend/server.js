// server.js
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { GoogleGenAI } = require('@google/genai'); // official GenAI SDK
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
app.use(cors({ origin: FRONTEND_ORIGIN }));

const pool = new Pool({
  host: '192.168.1.7', 
  user: 'postgres',
  password: 'yourpassword',
  database: 'resume_db',
  port: 5432
  
});



// Make sure uploads folder exists
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// multer config (store files on disk)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + '-' + file.originalname);
  },
});
const upload = multer({
  storage,
  fileFilter: function (req, file, cb) {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are allowed'));
    }
    cb(null, true);
  },
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
});

// Initialize Google GenAI client
// The SDK will pick up GEMINI_API_KEY from env automatically when present.
const ai = new GoogleGenAI({});

// Helper: robustly find JSON inside text
function extractJSONFromText(maybeText) {
  // Try direct parse
  try {
    return JSON.parse(maybeText);
  } catch (e) {
    // try to find the first {...} block
    const first = maybeText.indexOf('{');
    const last = maybeText.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      const candidate = maybeText.slice(first, last + 1);
      try {
        return JSON.parse(candidate);
      } catch (e2) {
        // try array
        const af = maybeText.indexOf('[');
        const al = maybeText.lastIndexOf(']');
        if (af !== -1 && al !== -1 && al > af) {
          try {
            return JSON.parse(maybeText.slice(af, al + 1));
          } catch (e3) {
            return null;
          }
        }
        return null;
      }
    }
    return null;
  }
}

// Strong prompt template for structured JSON response
function buildPromptFromText(resumeText) {
  // Schema description: instruct model to return ONLY valid JSON EXACTLY in this shape
  return `


{
  "personal": {
    "name": string | null,
    "email": string | null,
    "phone": string | null,
    "linkedin": string | null
  },
  "summary": string | null,
  "work_experience": [ { "role": string, "company": string, "start": string|null, "end": string|null, "description": string|null } ],
  "education": [ { "degree": string|null, "institution": string|null, "start": string|null, "end": string|null, "notes": string|null } ],
  "projects": [ { "name": string, "description": string|null, "technologies": [string] } ],
  "certifications": [ string ],
  "technical_skills": [ string ],
  "soft_skills": [ string ],
  "ai_feedback": {
    "rating_out_of_10": integer,
    "improvement_areas": [ string ],
    "suggested_skills_to_learn": [ string ]
  }
}

Parse the resume below. Produce JSON values; for fields you cannot find, set null or empty arrays as appropriate. Keep fields consistent. Do NOT output any extra text.

Resume text:
"""
${resumeText}
"""
  `.trim();
}

// POST /api/upload -> upload PDF, parse, call Gemini, store in Postgres, return JSON
app.post('/api/upload', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const filePath = req.file.path;
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);
    const text = pdfData.text || '';

    // Build prompt and call Gemini
    const prompt = buildPromptFromText(text);

    // Use the model from env or default
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    // Call the SDK
    const aiResponse = await ai.models.generateContent({
      model,
      contents: prompt,
      // You can add config here (e.g., temperature), but prompt strongly asks for JSON only.
      config: {
        temperature: 0.0,
        maxOutputTokens: 1200
      }
    });

    // aiResponse.text is the returned text in many SDK versions
    const rawText = aiResponse?.text || (typeof aiResponse === 'string' ? aiResponse : JSON.stringify(aiResponse));

    // Try to extract JSON
    const parsed = extractJSONFromText(rawText);
    if (!parsed) {
      // if parse failed, return raw text and save it anyway
      // Save fallback record
      const result = await pool.query(
        `INSERT INTO resumes (file_name, raw_text, created_at) VALUES ($1, $2, NOW()) RETURNING id`,
        [req.file.filename, rawText]
      );
      return res.status(200).json({ warning: 'Failed to parse JSON from LLM. Raw output saved.', raw: rawText, id: result.rows[0].id });
    }

    // Map parsed JSON into DB columns (safe defaults)
    const personal = parsed.personal || {};
    const name = personal.name || null;
    const email = personal.email || null;
    const phone = personal.phone || null;
    const linkedin = personal.linkedin || null;

    const summary = parsed.summary || null;
    const work_experience = parsed.work_experience || [];
    const education = parsed.education || [];
    const projects = parsed.projects || [];
    const certifications = parsed.certifications || [];
    const technical_skills = parsed.technical_skills || [];
    const soft_skills = parsed.soft_skills || [];

    const ai_feedback = parsed.ai_feedback || {};
    const rating = typeof ai_feedback.rating_out_of_10 === 'number' ? ai_feedback.rating_out_of_10 : null;
    const feedback = ai_feedback.improvement_areas ? (Array.isArray(ai_feedback.improvement_areas) ? ai_feedback.improvement_areas.join('; ') : String(ai_feedback.improvement_areas)) : null;
    const suggested_skills = ai_feedback.suggested_skills_to_learn || [];

    // Insert into DB
    const insertQuery = `
      INSERT INTO resumes
      (name, email, phone, linkedin, summary, work_experience, education, projects, certifications,
       technical_skills, soft_skills, rating, feedback, suggested_skills, file_name, raw_text)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING id, created_at;
    `;
    const values = [
      name, email, phone, linkedin, summary,
      work_experience, education, projects, certifications,
      technical_skills, soft_skills, rating, feedback, suggested_skills,
      req.file.filename, text
    ];
    const dbRes = await pool.query(insertQuery, values);
    const id = dbRes.rows[0].id;

    res.json({ id, parsed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// GET /api/resumes -> list minimal info
app.get('/api/resumes', async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, name, email, file_name, created_at FROM resumes ORDER BY created_at DESC`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/resumes/:id -> detailed item
app.get('/api/resumes/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await pool.query(`SELECT * FROM resumes WHERE id=$1`, [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve uploaded PDF files (optional)
app.use('/uploads', express.static(UPLOADS_DIR));

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
