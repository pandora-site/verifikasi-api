export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };
    if (method === 'OPTIONS') return new Response(null, { headers: cors });

    // === POST ===
    if ((url.pathname === '/data' || url.pathname === '/api/data') && method === 'POST') {
      try {
        const body = await request.json();
        const d = { waktu: new Date().toISOString(), sumber: body.sumber || body.type || 'unknown', data: body.data || body };
        let old = [];
        const raw = await env.DATA.get('data');
        if (raw) old = JSON.parse(raw);
        old.push(d);
        if (old.length > 1000) old = old.slice(-1000);
        await env.DATA.put('data', JSON.stringify(old, null, 2));
        return new Response(JSON.stringify({ status: 'ok' }), { headers: { 'Content-Type': 'application/json', ...cors } });
      } catch(e) {
        return new Response(JSON.stringify({ status: 'error', msg: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
      }
    }

    // === GET ===
    if ((url.pathname === '/data' || url.pathname === '/api/data') && method === 'GET') {
      if (url.searchParams.get('key') !== env.PASSWORD) {
        return new Response('{"error":"Access Denied"}', { status: 403, headers: { 'Content-Type': 'application/json', ...cors } });
      }
      try {
        const raw = await env.DATA.get('data');
        const data = raw ? JSON.parse(raw) : [];
        return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...cors } });
      } catch(e) {
        return new Response('[]', { headers: { 'Content-Type': 'application/json', ...cors } });
      }
    }

    return new Response('{"error":"Not Found"}', { status: 404, headers: { 'Content-Type': 'application/json', ...cors } });
  }
};
