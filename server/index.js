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
import { inflateSync } from "zlib";

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

async function loadQuizHistoryForEmail(email) {
  const key = (email || '').trim().toLowerCase();
  if (useDb && dbClient) {
    const result = await dbClient.query('SELECT questions FROM quiz_history WHERE email = $1', [key]);
    return result.rows[0]?.questions || [];
  }
  return loadQuizHistory()[key] || [];
}

async function saveQuizHistoryForEmail(email, questions) {
  const key = (email || '').trim().toLowerCase();
  if (useDb && dbClient) {
    await dbClient.query(
      'INSERT INTO quiz_history(email, questions, updated_at) VALUES($1, $2, NOW()) ON CONFLICT (email) DO UPDATE SET questions = $2, updated_at = NOW()',
      [key, JSON.stringify(questions)]
    );
    return;
  }
  const history = loadQuizHistory();
  history[key] = questions;
  saveQuizHistory(history);
}

async function parseSyllabus(buffer) {
  const result = await extractPdfText(buffer);
  if (!result) return [];
  const aiSubjects = await parseSyllabusWithAI(result);
  return aiSubjects.length ? aiSubjects : parseSyllabusText(result);
}

function splitSyllabusTopics(topicNames) {
  return [...new Set(topicNames
    .flatMap((topic) => String(topic || '').split(/[,;|]+/))
    .map((topic) => topic
      .replace(/^\s*(?:topic|unit|chapter)\s*[:.-]?\s*/i, '')
      .replace(/^\s*(?:\d+[\s.)-]+)+/, '')
      .replace(/\s+/g, ' ')
      .trim())
    .filter((topic) => topic.length >= 3))];
}

async function parseSyllabusWithAI(text) {
  const prompt = `Extract every subject/course from this syllabus. Return only valid JSON in this exact shape:
{"subjects":[{"name":"Subject name","code":"COURSE CODE","topics":["topic 1","topic 2"]}]}
Each comma-, semicolon-, or pipe-separated item must be a separate topic string. Never combine multiple topics into one array item. Do not include university metadata, semesters, credits, headings, or explanations. If a code or topics are unavailable, use an empty string or empty array.

SYLLABUS:
${text.slice(0, 50000)}`;
  try {
    let responseText = '';
    if (hasGeminiKey) {
      for (const model of await getGeminiModels()) {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });
        if (response.ok) {
          const payload = await response.json();
          responseText = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
          if (responseText) break;
        }
      }
    }
    if (!responseText && hasOpenAIKey) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
        }),
      });
      if (response.ok) {
        const payload = await response.json();
        responseText = payload?.choices?.[0]?.message?.content || '';
      }
    }
    const jsonText = responseText.replace(/^```json\s*|\s*```$/gi, '').trim();
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed?.subjects)) return [];
    return parsed.subjects
      .filter((subject) => subject && typeof subject.name === 'string')
      .map((subject) => ({
        name: subject.name.trim(),
        code: typeof subject.code === 'string' ? subject.code.trim() : '',
        topics: Array.isArray(subject.topics) ? splitSyllabusTopics(subject.topics.filter((topic) => typeof topic === 'string')) : [],
      }))
      .filter((subject) => subject.name.length >= 4)
      .slice(0, 30)
      .map((subject, index) => ({
        id: `pdf-${index + 1}`,
        name: subject.name,
        code: subject.code,
        topics: splitSyllabusTopics(subject.topics.length ? subject.topics : [subject.name]).slice(0, 20).map((name, topicIndex) => ({
          id: `pdf-topic-${index + 1}-${topicIndex + 1}`,
          name: name.trim(),
          mastery: 0,
        })),
      }));
  } catch (error) {
    console.error('AI syllabus parsing failed; using heuristic parser:', error);
    return [];
  }
}

async function extractPdfText(buffer, kind = 'syllabus') {
  const parser = new PDFParse({ data: buffer });
  try {
    const extracted = (await parser.getText())?.text || '';
    if (isUsablePdfText(extracted)) return extracted;
  } catch (error) {
    console.error('PDF parser text extraction failed; trying raw text fallback:', error);
  } finally {
    await parser.destroy();
  }
  const rawText = extractRawPdfText(buffer);
  if (isUsablePdfText(rawText)) return rawText;
  const aiText = await extractPdfWithGemini(buffer, kind);
  if (isUsablePdfText(aiText)) return aiText;
  const openAiText = await extractPdfWithOpenAI(buffer, kind);
  return isUsablePdfText(openAiText) ? openAiText : '';
}

function isUsablePdfText(text) {
  const value = String(text || '').replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '').trim();
  if (
    value.length < 20 ||
    /(?:Skia\/PDF|PDFium|MuPDF|Ghostscript)/i.test(value) ||
    /^(?:Adobe|Microsoft Print|PDF Creator)\b/i.test(value)
  ) return false;
  const printable = value.replace(/[^\x20-\x7E\r\n\t]/g, '');
  const letters = (value.match(/[A-Za-z]/g) || []).length;
  return printable.length / value.length >= 0.9 && letters >= 12;
}

function extractRawPdfText(buffer) {
  const source = Buffer.from(buffer).toString('latin1');
  const streams = [];
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let streamMatch;
  while ((streamMatch = streamPattern.exec(source))) {
    try {
      streams.push(inflateSync(Buffer.from(streamMatch[1], 'latin1')).toString('latin1'));
    } catch {
      streams.push(streamMatch[1]);
    }
  }
  if (!streams.length) streams.push(source);
  const strings = [];
  for (const stream of streams) {
    const textPattern = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
    let match;
    while ((match = textPattern.exec(stream))) {
      const value = match[1]
        .replace(/\\([\\()])/g, '$1')
        .replace(/\\n/g, ' ')
        .replace(/\\r/g, ' ')
        .trim();
      if (value && /[A-Za-z]{2,}/.test(value)) strings.push(value);
    }
    const hexPattern = /<([0-9a-f]{4,})>\s*T[jJ]/gi;
    while ((match = hexPattern.exec(stream))) {
      const bytes = Buffer.from(match[1], 'hex');
      for (let index = 0; index + 1 < bytes.length; index += 2) {
        [bytes[index], bytes[index + 1]] = [bytes[index + 1], bytes[index]];
      }
      const value = bytes.toString('utf16le').trim();
      if (value && /[A-Za-z]{2,}/.test(value)) strings.push(value);
    }
  }
  return [...new Set(strings)].join('\n');
}

async function extractPdfWithGemini(buffer, kind = 'syllabus') {
  if (!hasGeminiKey) return '';
  const prompt = kind === 'notes'
    ? 'Extract all readable text from this chapter or study-notes PDF. Preserve headings, numbered lists, formulas when possible, and the original order. Return only the extracted text with no commentary.'
    : 'Read this syllabus PDF. Return all visible subjects and their chapter/unit/topic names using exactly this format, with no commentary: SUBJECT: <subject name> followed by one or more TOPIC: <topic name> lines. Include every subject and topic you can read.';
  const models = await getGeminiModels();
  for (const model of models) {
    try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'application/pdf', data: Buffer.from(buffer).toString('base64') } },
          ],
        }],
      }),
    });
    if (!response.ok) continue;
    const payload = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('\n').trim() || '';
    if (isUsablePdfText(text)) return text;
    } catch (error) {
      console.error(`Gemini PDF extraction failed with ${model}:`, error);
    }
  }
  return '';
}

async function getGeminiModels() {
  const candidates = [GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-2.0-flash'];
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(GEMINI_KEY)}`);
    if (response.ok) {
      const payload = await response.json();
      const available = (payload.models || [])
        .filter((model) => model.supportedGenerationMethods?.includes('generateContent'))
        .map((model) => model.name?.replace(/^models\//, ''))
        .filter(Boolean);
      return [...new Set([...available.filter((model) => /flash|pro/i.test(model)), ...candidates])];
    }
  } catch (error) {
    console.error('Unable to discover Gemini models:', error);
  }
  return [...new Set(candidates)];
}

async function extractPdfWithOpenAI(buffer, kind = 'syllabus') {
  if (!hasOpenAIKey) return '';
  const prompt = kind === 'notes'
    ? 'Read this scanned chapter or study-notes PDF and transcribe all visible text in order. Preserve headings, lists, tables, and formulas where possible. Return only the extracted text.'
    : 'Read this scanned syllabus PDF and extract every visible subject and chapter, unit, or topic. Return only this format with no commentary: SUBJECT: <subject name> followed by TOPIC: <topic name> lines.';
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_file', filename: 'document.pdf', file_data: `data:application/pdf;base64,${Buffer.from(buffer).toString('base64')}` },
          ],
        }],
      }),
    });
    if (!response.ok) {
      console.error('OpenAI PDF extraction failed:', response.status, await response.text());
      return '';
    }
    const payload = await response.json();
    return payload?.output_text?.trim() || payload?.output
      ?.flatMap((item) => item.content || [])
      ?.map((item) => item.text || '')
      ?.join('\n')
      ?.trim() || '';
  } catch (error) {
    console.error('OpenAI PDF extraction failed:', error);
    return '';
  }
}

function parseSyllabusText(text) {
  try {
    const rawLines = text
      .split(/\r?\n/)
      .flatMap((line) => line.split(/\s{2,}|\t/))
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const lines = [...rawLines];
    for (const line of rawLines) {
      const matches = line.match(/\b[A-Z]{2,8}[-\s]?\d{2,4}\s*[:.)-]?\s+[A-Za-z][A-Za-z0-9 &'()/,-]{3,100}/g);
      if (matches) lines.push(...matches);
    }
    const subjects = [];
    const seen = new Set();
    const addSubject = (name, code = '', topicNames = []) => {
      const normalized = name.replace(/\s+/g, ' ').trim();
      const key = normalized.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!normalized || normalized.length < 4 || seen.has(key) || /https?:\/\//i.test(normalized)) return;
      if (/^(syllabus|semester|university|b\.?tech|department|credits?|introduction|objectives|references|total|elective|lecture|tutorial|course outcomes?)\b/i.test(normalized)) return;
      seen.add(key);
      const topics = splitSyllabusTopics(topicNames);
      subjects.push({
        id: `pdf-${subjects.length + 1}`,
        name: normalized,
        code,
        topics: (topics.length ? topics : [normalized]).slice(0, 20).map((topic, index) => ({
          id: `pdf-topic-${subjects.length + 1}-${index + 1}`,
          name: topic,
          mastery: 0,
        })),
      });
    };
    const labeledSubjects = [];
    let currentSubject = null;
    for (const line of rawLines) {
      const subjectMatch = line.match(/^SUBJECT\s*:\s*(.+)$/i);
      const topicMatch = line.match(/^(?:TOPIC|UNIT|CHAPTER)\s*:\s*(.+)$/i);
      if (subjectMatch) {
        currentSubject = { name: subjectMatch[1].trim(), topics: [] };
        labeledSubjects.push(currentSubject);
      } else if (topicMatch && currentSubject) {
        currentSubject.topics.push(topicMatch[1].trim());
      }
    }
    if (labeledSubjects.length) {
      labeledSubjects.forEach((subject) => addSubject(subject.name, '', subject.topics));
      return subjects;
    }
    const codedLines = lines.map((line, index) => ({
      index,
      match: line.match(/^\s*([A-Z]{2,8}[-\s]?\d{2,4})\s*[:.)-]?\s+(.{4,120})$/i),
    })).filter((entry) => entry.match);
    if (codedLines.length) {
      for (let index = 0; index < codedLines.length && subjects.length < 30; index += 1) {
        const current = codedLines[index];
        const nextIndex = codedLines[index + 1]?.index ?? lines.length;
        const topics = lines.slice(current.index + 1, nextIndex)
          .filter((line) => line.length >= 4 && line.length <= 100)
          .filter((line) => !/^(syllabus|semester|university|department|credits?|introduction|objectives|references|total|elective|lecture|tutorial|course outcomes?)\b/i.test(line))
          .slice(0, 12);
        addSubject(current.match[2], current.match[1].toUpperCase(), topics);
      }
      if (subjects.length) return subjects;
    }
    for (const line of lines) {
      if (line.length < 4 || /^\d+$/.test(line)) continue;
      const codeMatch = line.match(/^\s*([A-Z]{2,8}[-\s]?\d{2,4})\s*[:.)-]?\s+(.{4,120})$/i);
      if (codeMatch) {
        addSubject(codeMatch[2], codeMatch[1].toUpperCase(), codeMatch[2].split(/[,;|]/).slice(1));
        if (subjects.length >= 30) break;
        continue;
      }
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
      addSubject(normalized);
      if (subjects.length >= 30) break;
    }
    if (!subjects.length) {
      for (const line of lines) {
        const match = line.match(/^\s*(?:\d+[\s.)-]+)+(.{4,120})$/i);
        if (match) addSubject(match[1]);
        const codeMatch = line.match(/^\s*([A-Z]{2,8}(?:[-\s]?\d{2,4}))\s*[:.)-]?\s+(.{4,120})$/i);
        if (codeMatch) addSubject(codeMatch[2], codeMatch[1].toUpperCase());
        if (subjects.length >= 30) break;
      }
    }
    if (!subjects.length && lines.length === 1) {
      for (const part of lines[0].split(/[|;]+/)) {
        const match = part.match(/^\s*(?:\d+[\s.)-]+)?(.{4,120})$/);
        if (!match) continue;
        addSubject(match[1]);
        if (subjects.length >= 30) break;
      }
    }
    return subjects;
  } catch (error) {
    console.error('Syllabus parsing failed:', error);
    return [];
  }
}

// Database integration (optional). If DATABASE_URL is set the server will use Postgres for users/messages.
let dbClient = null;
let useDb = false;
async function initDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    if (process.env.NODE_ENV === 'production') console.warn('DATABASE_URL is missing; production data will not survive redeploys.');
    return;
  }
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
      notes JSONB NOT NULL DEFAULT '[]',
      syllabus JSONB,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await dbClient.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS course TEXT NOT NULL DEFAULT ''");
  await dbClient.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS subjects JSONB NOT NULL DEFAULT '[]'");
  await dbClient.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS notes JSONB NOT NULL DEFAULT '[]'");
  await dbClient.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS syllabus JSONB");
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS messages (
      email TEXT PRIMARY KEY,
      chat JSONB,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS quiz_history (
      email TEXT PRIMARY KEY,
      questions JSONB NOT NULL DEFAULT '[]',
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('Connected to DATABASE');
}
initDb().catch(e => { console.warn('DB init failed (continuing with file-based storage):', e.message || e); });

async function getUserByEmail(email) {
  const key = (email || '').trim().toLowerCase();
  if (useDb && dbClient) {
    const r = await dbClient.query('SELECT email, name, course, subjects, notes, syllabus, password_hash FROM users WHERE email = $1', [key]);
    if (!r.rows.length) return null;
    return { email: r.rows[0].email, name: r.rows[0].name, course: r.rows[0].course || '', subjects: r.rows[0].subjects || [], notes: r.rows[0].notes || [], syllabus: r.rows[0].syllabus || null, passwordHash: r.rows[0].password_hash };
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

async function updateUserStudyData(email, { subjects, notes, syllabus }) {
  const key = (email || '').trim().toLowerCase();
  if (useDb && dbClient) {
    await dbClient.query(
      'UPDATE users SET subjects = $1, notes = $2, syllabus = $3 WHERE email = $4',
      [JSON.stringify(subjects), JSON.stringify(notes), syllabus ? JSON.stringify(syllabus) : null, key]
    );
    return;
  }
  const users = loadAllUsers();
  if (!users[key]) return;
  users[key].subjects = subjects;
  users[key].notes = notes;
  users[key].syllabus = syllabus || null;
  saveAllUsers(users);
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

app.get('/api/ping', (_req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()) });
});

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

app.get('/api/me', authMiddleware, async (req, res) => {
  const user = await getUserByEmail(req.user?.email);
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ user: { email: user.email, name: user.name, course: user.course || '', subjects: user.subjects || [], notes: user.notes || [], syllabus: user.syllabus || null } });
});

app.patch('/api/me/study-data', authMiddleware, async (req, res) => {
  try {
    const subjects = req.body?.subjects;
    const notes = req.body?.notes;
    const syllabus = req.body?.syllabus || null;
    if (!Array.isArray(subjects)) return res.status(400).json({ error: 'Subjects must be an array' });
    if (!Array.isArray(notes)) return res.status(400).json({ error: 'Notes must be an array' });
    if (!req.user?.email) return res.status(400).json({ error: 'Missing email in token' });
    await updateUserStudyData(req.user.email, { subjects, notes, syllabus });
    return res.json({ ok: true, subjects, notes, syllabus });
  } catch (error) {
    console.error('Study data update failed:', error);
    return res.status(500).json({ error: 'Unable to update study data' });
  }
});

app.post('/api/pdf-extract', authMiddleware, upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'A PDF file is required' });
    const kind = req.body?.kind === 'notes' ? 'notes' : 'syllabus';
    const text = await extractPdfText(req.file.buffer, kind);
    if (!text) return res.status(422).json({ error: 'No readable text was found. For scanned/image PDFs, configure GEMINI_API_KEY or OPENAI_API_KEY for OCR.' });
    const subjects = kind === 'syllabus' ? await parseSyllabusWithAI(text) : [];
    return res.json({
      name: req.file.originalname,
      text,
      textLength: text.length,
      subjects: subjects.length ? subjects : parseSyllabusText(text),
    });
  } catch (error) {
    console.error('PDF extraction failed:', error);
    return res.status(422).json({ error: 'Unable to read this PDF. Please use a text-based PDF.' });
  }
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
  const materials = Array.isArray(req.body?.materials) ? req.body.materials : [];
  const count = Math.max(1, Math.min(10, Number(req.body?.count) || 5));
  const email = req.user?.email || 'anonymous';
  const used = new Set(await loadQuizHistoryForEmail(email));

  const materialText = materials
    .map((material) => `${material.topic}: ${String(material.text || '').slice(0, 12000)}`)
    .join('\n\n');
  const quizPrompt = `Create ${count} important, distinct multiple-choice questions for a student practicing these topics: ${pool.join(', ')}.
Return ONLY valid JSON in this exact shape: {"questions":[{"topic":"topic name","question":"...","options":["...","...","...","..."],"answer":0}]}.
The answer must be the zero-based index of the correct option. Use the supplied chapter notes when available and test important concepts, definitions, applications, and likely exam points. Avoid these previously used question texts: ${JSON.stringify([...used].slice(-30))}

Chapter notes:
${materialText || 'No chapter notes supplied.'}`;
  try {
    let payload;
    if (hasGeminiKey) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: quizPrompt }] }] }),
      });
      if (response.ok) {
        const body = await response.json();
        const text = body?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim() || '';
        payload = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ''));
      }
    } else if (process.env.ANTHROPIC_API_KEY) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-5',
          max_tokens: 1800,
          messages: [{ role: 'user', content: quizPrompt }],
        }),
      });
      if (response.ok) {
        const body = await response.json();
        const text = body?.content?.map((block) => block?.text || '').join('').trim() || '';
        payload = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ''));
      }
    }
    const aiQuestions = payload?.questions;
    if (Array.isArray(aiQuestions) && aiQuestions.length) {
      const questions = aiQuestions.slice(0, count).filter((question) =>
        question && typeof question.question === 'string' && Array.isArray(question.options)
        && question.options.length === 4 && Number.isInteger(question.answer)
        && question.answer >= 0 && question.answer < 4
      ).map((question, index) => ({
        id: `generated-${Date.now()}-${index}`,
        topic: question.topic || pool[index % pool.length],
        question: question.question.trim(),
        options: question.options.map((option) => String(option)),
        answer: question.answer,
      }));
      if (questions.length) {
        await saveQuizHistoryForEmail(email, [...new Set([...used, ...questions.map((question) => question.question)])]);
        return res.json({ questions });
      }
    }
  } catch (error) {
    console.error('AI quiz generation failed; using local questions:', error);
  }

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
  const candidatePool = pool;
  const shuffledPool = [...candidatePool];
  for (let i = shuffledPool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledPool[i], shuffledPool[j]] = [shuffledPool[j], shuffledPool[i]];
  }
  const genericTemplates = [
    (topic) => ({ question: `Which statement best describes ${topic}?`, options: [`It is a core concept in ${topic}`, 'It is unrelated to computing', 'It is only a hardware component', 'It cannot be tested'], answer: 0 }),
    (topic) => ({ question: `What is a useful way to study ${topic}?`, options: ['Practice and explain examples', 'Avoid practicing', 'Memorize without understanding', 'Skip all examples'], answer: 0 }),
    (topic) => ({ question: `Which approach helps build confidence in ${topic}?`, options: ['Apply it to a small problem', 'Ignore feedback', 'Only read the title', 'Avoid revising it'], answer: 0 }),
  ];
  const questions = Array.from({ length: count }, (_, index) => {
    const topic = shuffledPool[index % shuffledPool.length];
    const matchingTemplates = questionTemplates.filter(({ matches }) =>
      matches.some((match) => topic.toLowerCase().includes(match))
    );
    const unusedTemplates = matchingTemplates.filter((candidate) => !used.has(candidate.question));
    const availableGeneric = genericTemplates
      .map((createQuestion) => createQuestion(topic))
      .filter((candidate) => !used.has(candidate.question));
    const templates = unusedTemplates.length ? unusedTemplates : availableGeneric.length ? availableGeneric : matchingTemplates;
    const template = templates[Math.floor(Math.random() * templates.length)]
      || availableGeneric[Math.floor(Math.random() * availableGeneric.length)]
      || genericTemplates[index % genericTemplates.length](topic);
    used.add(template.question);
    return {
      id: `generated-${Date.now()}-${index}`,
      topic,
      question: template.question,
      options: template.options,
      answer: template.answer,
    };
  });
  await saveQuizHistoryForEmail(email, [...new Set([...used, ...questions.map((question) => question.question)])]);
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

function sendSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function streamOpenAI(prompt, context, res) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: 'You are CampusMate AI, a helpful study assistant aware of the user context.' },
        { role: 'user', content: `${JSON.stringify(context || {})}\n\nUser: ${prompt}` },
      ],
      stream: true,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI streaming request failed (${response.status}): ${await response.text()}`);
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += chunk.toString('utf8');
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const event of events) {
      const data = event.replace(/^data:\s*/m, '').trim();
      if (!data || data === '[DONE]') continue;
      const payload = JSON.parse(data);
      const text = payload?.choices?.[0]?.delta?.content;
      if (text) sendSse(res, { type: 'delta', text });
    }
  }
}

async function streamAnthropic(prompt, context, res) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 500,
      stream: true,
      system: 'You are CampusMate AI, a helpful study assistant aware of the user context.',
      messages: [{ role: 'user', content: `${JSON.stringify(context || {})}\n\nUser: ${prompt}` }],
    }),
  });
  if (!response.ok) throw new Error(`Anthropic streaming request failed (${response.status}): ${await response.text()}`);
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += chunk.toString('utf8');
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const event of events) {
      const data = event.split('\n').find((line) => line.startsWith('data:'))?.replace(/^data:\s*/, '');
      if (!data) continue;
      const payload = JSON.parse(data);
      const text = payload?.type === 'content_block_delta' ? payload?.delta?.text : '';
      if (text) sendSse(res, { type: 'delta', text });
    }
  }
}

async function streamGemini(prompt, context, res) {
  const model = (await getGeminiModels())[0];
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(GEMINI_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: 'You are CampusMate AI, a helpful study assistant aware of the user context.' }] },
      contents: [{ parts: [{ text: `${JSON.stringify(context || {})}\n\nUser: ${prompt}` }] }],
    }),
  });
  if (!response.ok) throw new Error(`Gemini streaming request failed (${response.status}): ${await response.text()}`);
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += chunk.toString('utf8');
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const event of events) {
      const data = event.replace(/^data:\s*/m, '').trim();
      if (!data) continue;
      const payload = JSON.parse(data);
      const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
      if (text) sendSse(res, { type: 'delta', text });
    }
  }
}

app.post('/api/ai-stream-v2', authMiddleware, async (req, res) => {
  try {
    const { prompt, context } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    if (hasGeminiKey) await streamGemini(prompt, context, res);
    else if (process.env.ANTHROPIC_API_KEY) await streamAnthropic(prompt, context, res);
    else if (hasOpenAIKey) await streamOpenAI(prompt, context, res);
    else throw new Error('No AI provider configured');
    sendSse(res, { type: 'done' });
    return res.end();
  } catch (e) {
    console.error('Stream v2 error', e);
    if (!res.headersSent) return res.status(502).json({ error: e.message || 'AI streaming failed' });
    sendSse(res, { type: 'error', body: e.message || 'AI streaming failed' });
    return res.end();
  }
});

app.use('/api', (req, res) => {
  return res.status(404).json({ error: 'API route not found' });
});

app.use('/api', (error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('API request failed:', error);
  return res.status(error.statusCode || 500).json({ error: error.message || 'API request failed' });
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
