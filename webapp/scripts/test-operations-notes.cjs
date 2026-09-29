const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const objects = new Map();
const r2 = {
  r2Configured: () => true,
  r2GetObjectBytes: async key => objects.has(key) ? { body: objects.get(key) } : null,
  r2PutObject: async (key, bytes) => objects.set(key, bytes),
  r2ListKeys: async prefix => [...objects.keys()].filter(key => key.startsWith(prefix)),
  r2DeleteKeys: async keys => keys.forEach(key => objects.delete(key)),
};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const resolve = id => id === '@/lib/r2' ? r2 : id.startsWith('@/') ? load(id.slice(2) + '.ts') : require(id);
  new Function('require', 'module', 'exports', js)(resolve, module, module.exports);
  cache.set(file, module.exports); return module.exports;
}
(async () => {
  process.env.CARDNEWS_ADMIN_SECRET = 'test-admin-only';
  delete process.env.RESEARCH_ADMIN_SECRET; delete process.env.COMMUNITY_ADMIN_SECRET;
  process.env.OPERATIONS_NOTES_ENCRYPTION_KEY = 'ab'.repeat(32);
  const storage = load('lib/operationsNotes.ts');
  const route = load('app/api/operations-notes/route.ts');
  const auth = { Authorization: 'Bearer test-admin-only' };
  const req = (method, suffix = '', headers = {}, body) => new Request('https://example.test/api/operations-notes' + suffix, { method, headers, body });
  for (const method of ['GET', 'POST', 'DELETE']) for (const headers of [{}, { Authorization: 'Bearer wrong' }]) {
    const res = await route[method](req(method, '', headers));
    assert.equal(res.status, 401); assert.match(res.headers.get('cache-control'), /no-store/);
  }
  delete process.env.OPERATIONS_NOTES_ENCRYPTION_KEY;
  assert.equal((await route.GET(req('GET', '', auth))).status, 503);
  process.env.OPERATIONS_NOTES_ENCRYPTION_KEY = 'ab'.repeat(32);
  const form = new FormData(); form.set('title', 'Private AI research'); form.set('body', '<script>alert(1)</script>');
  form.append('files', new File(['private-data'], '분석.csv', { type: 'text/csv' }));
  const created = await route.POST(req('POST', '', auth, form)); assert.equal(created.status, 201);
  const { item } = await created.json(); assert.equal(item.files[0].data, undefined);
  const bytes = objects.get(storage.noteKey(item.id));
  assert.equal(bytes.includes(Buffer.from('Private AI research')), false);
  assert.equal(bytes.includes(Buffer.from('private-data')), false);
  const tampered = Buffer.from(bytes); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => storage.decryptNote(item.id, tampered));
  assert.throws(() => storage.decryptNote('00000000-0000-0000-0000-000000000000', bytes));
  process.env.OPERATIONS_NOTES_ENCRYPTION_KEY = 'cd'.repeat(32);
  assert.throws(() => storage.decryptNote(item.id, bytes));
  process.env.OPERATIONS_NOTES_ENCRYPTION_KEY = 'ab'.repeat(32);
  const list = await (await route.GET(req('GET', '', auth))).json(); assert.equal(list.items.length, 1);
  const downloaded = await route.GET(req('GET', `?id=${item.id}&file=0`, auth));
  assert.equal(await downloaded.text(), 'private-data'); assert.match(downloaded.headers.get('content-disposition'), /^attachment/);
  assert.equal((await route.GET(req('GET', `?id=${item.id}&file=0`))).status, 401);
  assert.equal((await route.DELETE(req('DELETE', '?id=../other', auth))).status, 400);
  const edit = new FormData(); edit.set('id', item.id); edit.set('title', 'Updated');
  assert.equal((await route.POST(req('POST', '', auth, edit))).status, 200);
  assert.equal((await storage.readNote(item.id)).files.length, 1);
  edit.set('removeFiles', '1'); await route.POST(req('POST', '', auth, edit));
  assert.equal((await storage.readNote(item.id)).files.length, 0);
  const oversized = new FormData(); oversized.set('title', 'Large'); oversized.append('files', new File([new Uint8Array(storage.MAX_NOTE_BYTES + 1)], 'large.bin'));
  assert.equal((await route.POST(req('POST', '', auth, oversized))).status, 413);
  assert.equal((await route.DELETE(req('DELETE', `?id=${item.id}`, auth))).status, 200); assert.equal(objects.size, 0);
  console.log('PASS: auth, fail-closed config, encryption, tamper/wrong-key rejection, CRUD, file privacy, size limits, invalid IDs.');
})().catch(error => { console.error(error); process.exitCode = 1; });
