import fs from 'fs';
const p = 'C:/Users/Dell/Desktop/coding/campusmate-ai/src/App.jsx';
let s = fs.readFileSync(p, 'utf8');
const orig = s;

// Replace header assignment patterns like: headers['Authorization'] = `...`;
s = s.replace(/headers\['Authorization'\]\s*=\s*`[^;]*;/g, "headers['Authorization'] = `Bearer ${token}`;");
// Replace short alias h['Authorization'] assignments
s = s.replace(/h\['Authorization'\]\s*=\s*`[^;]*;/g, "h['Authorization'] = `Bearer ${token}`;");
// Replace Authorization: `... } patterns used inline in fetch headers
s = s.replace(/Authorization:\s*`[^}]*\}/g, "Authorization: `Bearer ${token}` }");
// Replace token2 cases
s = s.replace(/token2\) headers\['Authorization'\]\s*=\s*`[^;]*;/g, "token2) headers['Authorization'] = `Bearer ${token2}`;");

if (s !== orig) {
  fs.writeFileSync(p, s, 'utf8');
  console.log('updated');
} else {
  console.log('no changes');
}
