import fetch from 'node-fetch';

async function main(){
  // login
  const loginResp = await fetch('http://127.0.0.1:5174/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test3@example.com', password: 'pass1234' })
  });
  const loginJson = await loginResp.json();
  const token = loginJson.token;
  console.log('Got token length:', token ? token.length : 'none');

  const prompt = 'Explain database normalization (1NF, 2NF, 3NF) briefly for a college student.';

  const r = await fetch('http://127.0.0.1:5174/api/ai-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ prompt })
  });

  if (!r.ok) {
    console.error('Stream request failed', r.status);
    console.error(await r.text());
    process.exit(1);
  }

  const stream = r.body;
  stream.setEncoding('utf8');
  let buffer = '';
  console.log('Streaming response:');
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

  await new Promise((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  if (buffer) console.log('LEFTOVER', buffer);
  console.log('Stream ended');
}

main().catch((e)=>{console.error('Error', e); process.exit(1);});
