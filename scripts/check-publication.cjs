// Scan the actual Git index. Report file names and categories, never secret values.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const findings = [];
for (const file of files) {
  if (/(^|\/)(\.local|node_modules|\.next|\.venv)(\/|$)|(^|\/)\.env(?!\.example$)|\.(sqlite3|db|pem|key)(-|$)|^data\/cj-intelligence\/|^assets\/prototypes\//.test(file))
    findings.push({ file, reason: 'private/generated path' });
  if (/\.(woff2|zip|png|jpg)$/.test(file)) continue; // Binary files need separate manual review.
  const text = fs.readFileSync(file, 'utf8');
  for (const [reason, pattern] of [
    ['personal filesystem path', /\/Users\/[A-Za-z][^\s'"`]+/],
    ['private key', /BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY/],
    ['credential-shaped literal', /sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{24,}|AKIA[A-Z0-9]{16}/],
  ]) if (pattern.test(text)) findings.push({ file, reason });
}
console.log(JSON.stringify({ checkedFiles: files.length, findings }, null, 2));
if (!files.length || findings.length) process.exitCode = 1;
// A clean scan is not proof of anonymity: review screenshots, fixtures and commit metadata too.
