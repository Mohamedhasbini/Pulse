// Runs before anything else: a public deployment must not start on the example or fallback secrets.
// Sessions and stored keys are signed/encrypted from ADMIN_PASSWORD and DATA_KEY; with the defaults anyone could forge them.
const env = process.env, url = env.PUBLIC_URL || '';
const isPublic = /^https:\/\//.test(url) && !/\/\/(localhost|127\.|\[::1\])/.test(url);
const problems = [];
if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD === 'change-me' || env.ADMIN_PASSWORD.length < 12) problems.push('ADMIN_PASSWORD must be set, not "change-me", and at least 12 characters');
if (!env.DB_PASSWORD || env.DB_PASSWORD === 'change-me') problems.push('DB_PASSWORD must be set and not "change-me"');
if (!/^[0-9a-f]{64}$/i.test(env.DATA_KEY || '')) problems.push('DATA_KEY must be 64 hex characters (make one with: openssl rand -hex 32)');
if (problems.length) {
  const msg = `Unsafe settings in .env:\n  - ${problems.join('\n  - ')}`;
  if (isPublic) { console.error(`${msg}\nRefusing to start a public deployment (${url}). Fix .env and start again.`); process.exit(1); }
  console.warn(`${msg}\n(Allowed only because PUBLIC_URL is not a public https address.)`);
}
