import fetch from 'node-fetch';

const loginResp = await fetch('http://127.0.0.1:5174/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test3@example.com', password: 'pass1234' }),
});
const loginJson = await loginResp.json();
const token = loginJson.token;

console.log('Got token (length):', token ? token.length : 'none');

const r = await fetch('http://127.0.0.1:5174/api/ai-stream-sim', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ prompt: 'Give me a 1-line study tip' }),
});

if (!r.ok) {
  console.log('Stream request failed', r.status);
  console.log(await r.text());
  process.exit(1);
}

const stream = r.body;
stream.setEncoding('utf8');
let buffer = '';
stream.on('data', (chunk) => {
  buffer += chunk;
  const parts = buffer.split('\n\n');
  buffer = parts.pop();
  for (const p of parts) {
    if (!p) continue;
    for (const line of p.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      try {
        const obj = JSON.parse(data);
        console.log('EVENT', obj);
      } catch (e) {
        console.log('RAW', data);
      }
    }
  }
});
await new Promise((resolve) => stream.on('end', resolve));
if (buffer) console.log('LEFTOVER', buffer);
console.log('stream ended');
