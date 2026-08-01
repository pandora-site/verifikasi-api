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

    // === DEBUG ===
    if (url.pathname === '/api/debug') {
      const hasToken = !!env.GITHUB_TOKEN;
      const hasGistId = !!env.GIST_ID;
      const hasPassword = !!env.PASSWORD;
      return new Response(JSON.stringify({ hasToken, hasGistId, hasPassword, gistId: env.GIST_ID || '(undefined)' }), { headers: { 'Content-Type': 'application/json', ...cors } });
    }

    // === GET (BACA DATA) - PAKAI RAW URL ===
    if ((url.pathname === '/data' || url.pathname === '/api/data') && method === 'GET') {
      if (url.searchParams.get('key') !== env.PASSWORD) {
        return new Response('{"error":"Access Denied"}', { status: 403, headers: { 'Content-Type': 'application/json', ...cors } });
      }
      try {
        const r = await fetch('https://gist.githubusercontent.com/pandora-site/' + env.GIST_ID + '/raw/data.json');
        if (r.ok) {
          const text = await r.text();
          const data = (() => { try { return JSON.parse(text || '[]'); } catch(e) { return []; } })();
          return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...cors } });
        }
        return new Response('[]', { headers: { 'Content-Type': 'application/json', ...cors } });
      } catch(e) {
        return new Response('[]', { headers: { 'Content-Type': 'application/json', ...cors } });
      }
    }

    // === POST (SIMPAN DATA) - LEWAT GITHUB API ===
    if ((url.pathname === '/data' || url.pathname === '/api/data') && method === 'POST') {
      try {
        const body = await request.json();
        const d = { waktu: new Date().toISOString(), sumber: body.sumber || body.type || 'unknown', data: body.data || body };
        
        let old = [];
        try {
          const rawRes = await fetch('https://gist.githubusercontent.com/pandora-site/' + env.GIST_ID + '/raw/data.json');
          if (rawRes.ok) { const text = await rawRes.text(); try { old = JSON.parse(text || '[]'); } catch(e) {} }
        } catch(e) {}
        
        old.push(d);
        if (old.length > 1000) old = old.slice(-1000);
        
        const patchRes = await fetch('https://api.github.com/gists/' + env.GIST_ID, {
          method: 'PATCH',
          headers: { 'Authorization': 'token ' + env.GITHUB_TOKEN, 'Content-Type': 'application/json', 'User-Agent': 'CF-Worker', 'Accept': 'application/vnd.github.v3+json' },
          body: JSON.stringify({ files: { 'data.json': { content: JSON.stringify(old, null, 2) } } })
        });
        
        if (!patchRes.ok) {
          return new Response(JSON.stringify({ status: 'error', code: patchRes.status }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
        }
        return new Response(JSON.stringify({ status: 'ok', total: old.length }), { headers: { 'Content-Type': 'application/json', ...cors } });
      } catch(e) {
        return new Response(JSON.stringify({ status: 'error', msg: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
      }
    }

    return new Response('{"error":"Not Found"}', { status: 404, headers: { 'Content-Type': 'application/json', ...cors } });
  }
};
