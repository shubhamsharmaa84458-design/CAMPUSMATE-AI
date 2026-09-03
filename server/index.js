import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { Client } from 'pg';
import rateLimit from "express-rate-limit";
import fs from "fs";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { PDFParse } from "pdf-parse";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
app.set('trust proxy', 1);
const projectRoot = path.resolve(__dirname, '..');
app.use(cors({ origin: process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(',').map((v) => v.trim()) : true }));
app.use(express.json());
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
});

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const hasOpenAIKey = Boolean(OPENAI_KEY && !OPENAI_KEY.startsWith('replace-with-'));
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const hasGeminiKey = Boolean(GEMINI_KEY && !GEMINI_KEY.startsWith('replace-with-'));
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("JWT_SECRET must be set to a random value of at least 32 characters.");
  process.exit(1);
}
if (!hasOpenAIKey) {
  console.warn("Warning: OPENAI_API_KEY is missing or still a placeholder. Configure server/.env before using AI.");
}

// Keep persistent files next to the server regardless of the process cwd.
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const USERS_FILE = path.join(dataDir, 'users.json');
const MESSAGES_FILE = path.join(dataDir, 'messages.json');
const QUIZ_HISTORY_FILE = path.join(dataDir, 'quiz-history.json');
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({}), 'utf8');
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, JSON.stringify({}), 'utf8');
if (!fs.existsSync(QUIZ_HISTORY_FILE)) fs.writeFileSync(QUIZ_HISTORY_FILE, JSON.stringify({}), 'utf8');

function loadAllUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8') || '{}'); } catch { return {}; }
}
function saveAllUsers(obj) { fs.writeFileSync(USERS_FILE, JSON.stringify(obj, null, 2), 'utf8'); }
function loadAllMessages() { try { return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8') || '{}'); } catch { return {}; } }
function saveAllMessages(obj) { fs.writeFileSync(MESSAGES_FILE, JSON.stringify(obj, null, 2), 'utf8'); }
function loadQuizHistory() { try { return JSON.parse(fs.readFileSync(QUIZ_HISTORY_FILE, 'utf8') || '{}'); } catch { return {}; } }
function saveQuizHistory(history) { fs.writeFileSync(QUIZ_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8'); }

async function parseSyllabus(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    let result;
    try {
      result = await parser.getText();
    } catch (error) {
      console.error('Syllabus PDF text extraction failed:', error);
      return [];
    }
    const lines = (result?.text || '')
      .split(/\r?\n/)
      .flatMap((line) => line.split(/\s{2,}|\t/))
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const subjects = [];
    const seen = new Set();
    for (const line of lines) {
      if (line.length < 4 || line.length > 120 || /^\d+$/.test(line)) continue;
      const normalized = line
        .replace(/^(unit|module|subject|course)\s*[-:.\d]*/i, '')
        .replace(/^\s*(?:\d+[\s.)-]+)+/, '')
        .replace(/^\s*[A-Z]{2,}(?:[-\s]?\d{2,4})\s*[:.)-]?\s*/i, '')
        .replace(/\s+(?:credits?|hrs?|hours?)\s*[:.-]?\s*\d+(?:\.\d+)?\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!normalized || /^(syllabus|semester|university|b\.?tech|department|credits?)\b/i.test(normalized)) continue;
      if (!/[A-Za-z]{3}/.test(normalized) || /https?:\/\//i.test(normalized)) continue;
      if (/^(introduction|objectives|references|total|elective|lecture|tutorial|course outcomes?)\b/i.test(normalized)) continue;
      const key = normalized.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seen.has(key) || /^(introduction|objectives|references|total|elective|lecture|tutorial)\b/i.test(normalized)) continue;
      seen.add(key);
      subjects.push({ id: `pdf-${subjects.length + 1}`, name: normalized, code: '', topics: [{ id: `pdf-topic-${subjects.length + 1}`, name: normalized, mastery: 0 }] });
      if (subjects.length >= 30) break;
    }
    if (!subjects.length) {
      for (const line of lines) {
        const match = line.match(/^\s*([A-Z]{2,}(?:[-\s]?\d{2,4}))\s*[:.)-]?\s+(.{4,120})$/i);
        if (!match) continue;
        const normalized = match[2].replace(/\s+/g, ' ').trim();
        const key = normalized.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (!normalized || seen.has(key) || /https?:\/\//i.test(normalized)) continue;
        seen.add(key);
        subjects.push({ id: `pdf-${subjects.length + 1}`, name: normalized, code: match[1].toUpperCase(), topics: [{ id: `pdf-topic-${subjects.length + 1}`, name: normalized, mastery: 0 }] });
        if (subjects.length >= 30) break;
      }
    }
    return subjects;
  } catch (error) {
    console.error('Syllabus parsing failed:', error);
    return [];
  } finally {
    await parser.destroy();
  }
}

// Database integration (optional). If DATABASE_URL is set the server will use Postgres for users/messages.
let dbClient = null;
let useDb = false;
async function initDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  dbClient = new Client({ connectionString: url });
  await dbClient.connect();
  useDb = true;
  // create tables if they don't exist
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      course TEXT NOT NULL DEFAULT '',
      subjects JSONB NOT NULL DEFAULT '[]',
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await dbClient.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS course TEXT NOT NULL DEFAULT ''");
  await dbClient.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS subjects JSONB NOT NULL DEFAULT '[]'");
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS messages (
      email TEXT PRIMARY KEY,
      chat JSONB,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('Connected to DATABASE');
}
initDb().catch(e => { console.warn('DB init failed (continuing with file-based storage):', e.message || e); });

async function getUserByEmail(email) {
  const key = (email || '').trim().toLowerCase();
  if (useDb && dbClient) {
    const r = await dbClient.query('SELECT email, name, course, subjects, password_hash FROM users WHERE email = $1', [key]);
    if (!r.rows.length) return null;
    return { email: r.rows[0].email, name: r.rows[0].name, course: r.rows[0].course || '', subjects: r.rows[0].subjects || [], passwordHash: r.rows[0].password_hash };
  }
  const users = loadAllUsers();
  return users[key] || null;
}

async function createUserRecord(email, name, course, subjects, passwordHash) {
  const key = (email || '').trim().toLowerCase();
  if (useDb && dbClient) {
    await dbClient.query('INSERT INTO users(email, name, course, subjects, password_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT (email) DO NOTHING', [key, name, course, JSON.stringify(subjects), passwordHash]);
    return { email: key, name, course, subjects };
  }
  const users = loadAllUsers();
  users[key] = { email: key, name, course, subjects, passwordHash };
  saveAllUsers(users);
  return users[key];
}

async function saveMessagesForEmail(email, chat) {
  const key = (email || '').trim().toLowerCase();
  if (useDb && dbClient) {
    await dbClient.query('INSERT INTO messages(email, chat, updated_at) VALUES($1,$2,NOW()) ON CONFLICT (email) DO UPDATE SET chat = $2, updated_at = NOW()', [key, JSON.stringify(chat)]);
    return;
  }
  const all = loadAllMessages();
  all[key] = chat;
  saveAllMessages(all);
}

async function loadMessagesForEmail(email) {
  const key = (email || '').trim().toLowerCase();
  if (useDb && dbClient) {
    const r = await dbClient.query('SELECT chat FROM messages WHERE email = $1', [key]);
    if (!r.rows.length) return [];
    return r.rows[0].chat || [];
  }

  const all = loadAllMessages();
  return all[key] || [];
}

// rate limiter (per IP by default)
const limiter = rateLimit({ windowMs: 15*60*1000, max: 300 });
app.use('/api', limiter);

// serve public for debug page
app.use(express.static(path.join(__dirname, 'public')));

// Middleware: accept either PROXY_KEY or valid JWT for /api endpoints when PROXY_KEY is set
function requireProxyKeyOrJwt(req, res, next) {
  const key = process.env.PROXY_KEY;
  if (!key) return next();
  const headerKey = req.headers['x-proxy-key'] || '';
  if (headerKey === key) return next();
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (auth) {
    try {
      jwt.verify(auth, JWT_SECRET);
      return next();
    } catch (e) {
      // fallthrough to reject
    }
  }
  return res.status(401).json({ error: 'Missing or invalid proxy key / token' });
}
app.use('/api', requireProxyKeyOrJwt);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    aiConfigured: hasGeminiKey || hasOpenAIKey,
    provider: hasGeminiKey ? 'gemini' : hasOpenAIKey ? 'openai' : null,
    model: hasGeminiKey ? GEMINI_MODEL : OPENAI_MODEL,
    database: useDb ? 'postgres' : 'file',
  });
});

// Auth helper
function signToken(user) {
  return jwt.sign({ email: user.email, name: user.name, course: user.course || '', subjects: user.subjects || [] }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next) {
  const authHeader = (req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (req.headers['x-proxy-key'] || null);
  if (!token) return res.status(401).json({ error: 'Missing token' });

  // allow proxy key as well
  const key = process.env.PROXY_KEY;
  if (key && token === key) return next();

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// User endpoints
app.post('/api/register', upload.single('syllabus'), async (req, res) => {
  try {
    const { name, email, password, course } = req.body || {};
    if (!email || !password || !name || !course?.trim()) return res.status(400).json({ error: 'Name, email, password, and course are required' });
    const key = email.trim().toLowerCase();
    const existing = await getUserByEmail(key);
    if (existing) return res.status(400).json({ error: 'User exists' });
    const hash = await bcrypt.hash(password, 10);
    const subjects = req.file ? await parseSyllabus(req.file.buffer).catch((error) => {
      console.error('Syllabus parsing failed during registration:', error);
      return [];
    }) : [];
    const created = await createUserRecord(key, name.trim(), course.trim(), subjects, hash);
    const token = signToken(created);
    return res.json({ token, user: { email: created.email, name: created.name, course: created.course, subjects: created.subjects } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
    const key = email.trim().toLowerCase();
    const user = await getUserByEmail(key);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = signToken(user);
    return res.json({ token, user: { email: user.email, name: user.name, course: user.course || '' } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/me', authMiddleware, (req, res) => {
  return res.json({ user: req.user });
});

// Messages endpoints (require auth)
app.post('/api/messages', authMiddleware, async (req, res) => {
  try {
    const email = req.user?.email;
    const { chat } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Missing email in token' });
    const normalized = (chat || []).map(m => ({ id: m.id, role: m.role, text: m.text, time: m.time || new Date().toISOString() }));
    await saveMessagesForEmail(email, normalized);
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'db error' });
  }
});

app.get('/api/messages', authMiddleware, async (req, res) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(400).json({ error: 'Missing email in token' });
    const chat = await loadMessagesForEmail(email);
    return res.json({ chat: chat || [] });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'db error' });
  }
});

app.post('/api/quiz-generate', authMiddleware, async (req, res) => {
  const topics = Array.isArray(req.body?.topics) ? req.body.topics.filter(Boolean) : [];
  const pool = topics.length ? [...new Set(topics)] : ['Data Structures', 'DBMS', 'Computer Networks'];
  const questionTemplates = [
    {
      matches: ['sql', 'dbms', 'database'],
      question: 'Which SQL clause filters rows before grouping?',
      options: ['WHERE', 'ORDER BY', 'GROUP BY', 'HAVING'],
      answer: 0,
    },
    {
      matches: ['sql', 'dbms', 'database'],
      question: 'Which SQL operation combines rows from related tables?',
      options: ['JOIN', 'SORT', 'CAST', 'INDEX'],
      answer: 0,
    },
    {
      matches: ['normalization'],
      question: 'Which normal form removes partial functional dependency?',
      options: ['1NF', '2NF', '3NF', 'BCNF'],
      answer: 1,
    },
    {
      matches: ['normalization'],
      question: 'Which normal form removes transitive dependencies?',
      options: ['1NF', '2NF', '3NF', '4NF'],
      answer: 2,
    },
    {
      matches: ['array', 'linked', 'stack', 'queue', 'tree', 'data structure'],
      question: 'Which data structure follows the LIFO principle?',
      options: ['Queue', 'Stack', 'Heap', 'Graph'],
      answer: 1,
    },
    {
      matches: ['array', 'linked', 'stack', 'queue', 'tree', 'data structure'],
      question: 'Which structure processes elements in FIFO order?',
      options: ['Stack', 'Queue', 'Tree', 'Heap'],
      answer: 1,
    },
    {
      matches: ['network', 'osi', 'tcp', 'routing'],
      question: 'How many layers are in the OSI model?',
      options: ['4', '5', '7', '8'],
      answer: 2,
    },
    {
      matches: ['network', 'osi', 'tcp', 'routing'],
      question: 'Which protocol provides reliable, ordered transport?',
      options: ['IP', 'UDP', 'TCP', 'ARP'],
      answer: 2,
    },
  ];
  const history = loadQuizHistory();
  const email = req.user?.email || 'anonymous';
  const used = new Set(history[email] || []);
  const freshPool = pool;
  const candidatePool = freshPool.length ? freshPool : pool;
  const shuffledPool = [...candidatePool];
  for (let i = shuffledPool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledPool[i], shuffledPool[j]] = [shuffledPool[j], shuffledPool[i]];
  }
  const questions = shuffledPool.slice(0, Math.min(5, shuffledPool.length)).map((topic, index) => {
    const matchingTemplates = questionTemplates.filter(({ matches }) =>
      matches.some((match) => topic.toLowerCase().includes(match))
    );
    const unusedTemplates = matchingTemplates.filter((candidate) => !used.has(candidate.question));
    const template = (unusedTemplates.length ? unusedTemplates : matchingTemplates)[Math.floor(Math.random() * (unusedTemplates.length || matchingTemplates.length))] || {
      question: `What is the best way to learn ${topic}?`,
      options: [
        'Active recall with practice questions',
        'Reading once without reviewing',
        'Skipping difficult concepts',
        'Studying only before the exam',
      ],
      answer: 0,
    };
    return {
      id: `generated-${Date.now()}-${index}`,
      topic,
      question: template.question,
      options: template.options,
      answer: template.answer,
    };
  });
  history[email] = [...new Set([...used, ...questions.map((question) => question.question)])];
  saveQuizHistory(history);
  return res.json({ questions });
});

// Non-streaming AI endpoint (requires auth)
app.post('/api/ai', authMiddleware, async (req, res) => {
  try {
    const { prompt, context } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    const systemMsg = `You are CampusMate AI, a helpful study assistant aware of the user's tracked subjects, weak topics, and planner. Use the provided context to tailor concise study advice.`;
    const messages = [ { role: 'system', content: systemMsg }, { role: 'user', content: `${JSON.stringify(context||{})}\n\nUser: ${prompt}` } ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: OPENAI_MODEL, messages })
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('OpenAI error:', response.status, body);
      return res.status(502).json({ error: 'OpenAI API error', status: response.status, body });
    }

    const payload = await response.json();
    const reply = payload?.choices?.[0]?.message?.content?.trim() || '';
    return res.json({ reply });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Simulated streaming endpoint for local testing (does not call OpenAI).
// Useful when OPENAI_API_KEY is not set.
app.post('/api/ai-stream-sim', authMiddleware, async (req, res) => {
  try {
    const { prompt } = req.body || {};
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const simulated = (`Simulated reply: ${prompt || ''}`).trim();
    const parts = simulated.split(/\s+/);
    for (const p of parts) {
      await new Promise((r) => setTimeout(r, 120));
      res.write(`data: ${JSON.stringify({ type: 'delta', text: p + ' ' })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    return res.end();
  } catch (e) {
    console.error('Sim stream error', e);
    res.write(`data: ${JSON.stringify({ type: 'error', body: '' })}\n\n`);
    return res.end();
  }
});

// Streaming endpoint: forwards OpenAI streaming chunks as SSE-style data events (JSON payloads)
app.post('/api/ai-stream', authMiddleware, async (req, res) => {
  try {
    const { prompt, context } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
    if (!OPENAI_KEY) return res.status(500).json({ error: 'OpenAI key not configured' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const systemMsg = `You are CampusMate AI, a helpful study assistant aware of the user's tracked subjects, weak topics, and planner. Use the provided context to tailor concise study advice.`;
    const messages = [ { role: 'system', content: systemMsg }, { role: 'user', content: `${JSON.stringify(context||{})}\n\nUser: ${prompt}` } ];

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: OPENAI_MODEL, messages, stream: true })
    });

    if (!openaiRes.ok) {
      const text = await openaiRes.text();
      res.write(`data: ${JSON.stringify({ type: 'error', status: openaiRes.status, body: text })}\n\n`);
      return res.end();
    }

    let buffer = '';
    for await (const chunk of openaiRes.body) {
      buffer += chunk.toString('utf8');
      const parts = buffer.split('\n\n');
      buffer = parts.pop();

      for (const part of parts) {
        if (!part.startsWith('data:')) continue;
        const data = part.replace(/^data:\s*/, '').trim();
        if (data === '[DONE]') {
          res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
          return res.end();
        }
        try {
          const parsed = JSON.parse(data);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (delta) {
            res.write(`data: ${JSON.stringify({ type: 'delta', text: delta })}\n\n`);
          }
          const meta = parsed?.choices?.[0]?.delta?.role || parsed?.choices?.[0]?.finish_reason;
          if (meta) {
            res.write(`data: ${JSON.stringify({ type: 'meta', meta })}\n\n`);
          }
        } catch (e) {
          res.write(`data: ${JSON.stringify({ type: 'delta', text: data })}\n\n`);
        }
      }
    }

    res.end();
  } catch (err) {
    console.error('Streaming error:', err);
    try { res.end(); } catch (e) {}
  }
});

// New AI endpoints (v2) — support Anthropic (preferred if ANTHROPIC_API_KEY set) or OpenAI as fallback.
app.post('/api/ai-v2', authMiddleware, async (req, res) => {
  try {
    const { prompt, context } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
    const systemMsg = `You are CampusMate AI, a helpful study assistant aware of the user's tracked subjects, weak topics, and planner.`;

    // Prefer Anthropic if configured
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-5',
            max_tokens: 500,
            system: systemMsg,
            messages: [{ role: 'user', content: `${JSON.stringify(context || {})}\n\nUser: ${prompt}` }],
          }),
        });
        if (!resp.ok) {
          const body = await resp.text();
          return res.status(502).json({ error: 'Anthropic API error', status: resp.status, body });
        }
        const payload = await resp.json();
        const reply = payload?.content?.map((block) => block?.text || '').join('').trim() || '';
        return res.json({ reply });
      } catch (e) {
        console.error('Anthropic error', e);
        return res.status(500).json({ error: 'Anthropic request failed' });
      }
    }

    if (hasGeminiKey) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemMsg }] },
          contents: [{ parts: [{ text: `${JSON.stringify(context || {})}\n\nUser: ${prompt}` }] }],
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        return res.status(502).json({ error: 'Gemini API error', status: response.status, body });
      }
      const payload = await response.json();
      const reply = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim() || '';
      return res.json({ reply });
    }

    // Fallback to OpenAI when configured
    if (hasOpenAIKey) {
      try {
        const messages = [ { role: 'system', content: systemMsg }, { role: 'user', content: `${JSON.stringify(context||{})}\n\nUser: ${prompt}` } ];
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
          body: JSON.stringify({ model: OPENAI_MODEL, messages })
        });
        if (!response.ok) {
          const body = await response.text();
          return res.status(502).json({ error: 'OpenAI API error', status: response.status, body });
        }
        const payload = await response.json();
        const reply = payload?.choices?.[0]?.message?.content?.trim() || '';
        return res.json({ reply });
      } catch (e) {
        console.error('OpenAI error', e);
        return res.status(500).json({ error: 'OpenAI request failed' });
      }
    }

    return res.status(500).json({ error: 'No AI provider configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY)' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server error' });
  }
});

// Streaming v2: emulate streaming by splitting the full reply into chunks and sending SSE frames. Works with Anthropic or OpenAI (non-streaming) to ensure compatibility.
app.post('/api/ai-stream-v2', authMiddleware, async (req, res) => {
  try {
    const { prompt, context } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let finalReply = '';

    if (hasGeminiKey) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: 'You are CampusMate AI, a helpful study assistant aware of the user context.' }] },
          contents: [{ parts: [{ text: `${JSON.stringify(context || {})}\n\nUser: ${prompt}` }] }],
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        res.write(`data: ${JSON.stringify({ type: 'error', status: response.status, body })}\n\n`);
        return res.end();
      }
      const payload = await response.json();
      finalReply = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim() || '';
    } else if (process.env.ANTHROPIC_API_KEY) {
      try {
        const systemMsg = `You are CampusMate AI, a helpful study assistant aware of the user's tracked subjects, weak topics, and planner.`;
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-5',
            max_tokens: 500,
            system: systemMsg,
            messages: [{ role: 'user', content: `${JSON.stringify(context || {})}\n\nUser: ${prompt}` }],
          }),
        });
        if (!resp.ok) {
          const body = await resp.text();
          res.write(`data: ${JSON.stringify({ type: 'error', status: resp.status, body })}\n\n`);
          return res.end();
        }
        const payload = await resp.json();
        finalReply = payload?.content?.map((block) => block?.text || '').join('').trim() || '';
      } catch (e) {
        console.error('Anthropic error', e);
        res.write(`data: ${JSON.stringify({ type: 'error', body: 'Anthropic call failed' })}\n\n`);
        return res.end();
      }
    } else if (hasOpenAIKey) {
      try {
        const systemMsg = `You are CampusMate AI, a helpful study assistant aware of the user's tracked subjects, weak topics, and planner.`;
        const messages = [ { role: 'system', content: systemMsg }, { role: 'user', content: `${JSON.stringify(context||{})}\n\nUser: ${prompt}` } ];
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
          body: JSON.stringify({ model: OPENAI_MODEL, messages })
        });
        if (!response.ok) {
          const body = await response.text();
          res.write(`data: ${JSON.stringify({ type: 'error', status: response.status, body })}\n\n`);
          return res.end();
        }
        const payload = await response.json();
        finalReply = payload?.choices?.[0]?.message?.content || '';
      } catch (e) {
        console.error('OpenAI error', e);
        res.write(`data: ${JSON.stringify({ type: 'error', body: 'OpenAI call failed' })}\n\n`);
        return res.end();
      }
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', body: 'No AI provider configured' })}\n\n`);
      return res.end();
    }

    if (!finalReply.trim()) {
      res.write(`data: ${JSON.stringify({ type: 'error', body: 'The AI provider returned an empty response' })}\n\n`);
      return res.end();
    }

    // Stream the provider response in small chunks for a natural chat experience.
    const chunks = finalReply.split(/(\s+)/).filter(Boolean);
    for (const c of chunks) {
      await new Promise(r => setTimeout(r, 80));
      res.write(`data: ${JSON.stringify({ type: 'delta', text: c })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    return res.end();
  } catch (e) {
    console.error('Stream v2 error', e);
    try { res.end(); } catch (e) {}
  }
});

// In production the Express service serves the Vite build and provides SPA fallback.
// Keep API routes above this middleware so /api requests are never swallowed.
const distDir = path.join(projectRoot, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    return res.sendFile(path.join(distDir, 'index.html'));
  });
}

const port = process.env.PORT || 5174;
app.listen(port, () => {
  console.log(`CampusMate AI proxy running on http://localhost:${port}`);
});
