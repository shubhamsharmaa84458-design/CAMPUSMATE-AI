import fs from 'fs';
const p = 'C:/Users/Dell/Desktop/coding/campusmate-ai/src/App.jsx';
const s = fs.readFileSync(p,'utf8');
const lines = s.split(/\r?\n/);
for (let i=0;i<lines.length;i++){
  if (lines[i].includes('Authorization')){
    console.log('LINE',i+1,lines[i]);
    const chars = Array.from(lines[i]).map(c=>c.charCodeAt(0));
    console.log('CODES',chars.join(' '));
  }
}
