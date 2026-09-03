const fs = require('fs');
const p = 'C:/Users/Dell/Desktop/coding/campusmate-ai/src/App.jsx';
let s = fs.readFileSync(p, 'utf8');
let orig = s;
// Replace exact placeholder sequences left in the file
s = s.split("`******;").join("`Bearer ${token}`;");
// Replace Authorization inline placeholders
s = s.split("Authorization: `****** }").join("Authorization: `Bearer ${token}` }");
// Replace token2 occurrences
s = s.split("if (token2) headers['Authorization'] = `******;").join("if (token2) headers['Authorization'] = `Bearer ${token2}`;");
// Safety: also replace any remaining `****** with `Bearer ${token}`
s = s.split("`******").join("`Bearer ${token}`");

if (s === orig) {
  console.log('No changes made');
} else {
  fs.writeFileSync(p, s, 'utf8');
  console.log('File updated');
}
