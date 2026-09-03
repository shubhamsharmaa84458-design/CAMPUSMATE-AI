import fetch from 'node-fetch';
const url = 'http://127.0.0.1:5174/api/login';
const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'test3@example.com', password: 'pass1234' }) });
const j = await resp.json();
console.log(JSON.stringify(j));
