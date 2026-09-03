import fs from 'fs';
const p = 'C:/Users/Dell/Desktop/coding/campusmate-ai/src/App.jsx';
const s = fs.readFileSync(p,'utf8');
const lines = s.split(/\r?\n/);
const start = 236-1; const end = 260-1;
for(let i=start;i<=end && i<lines.length;i++){
  console.log((i+1)+':', lines[i]);
}
