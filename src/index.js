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

    if ((url.pathname === '/data' || url.pathname === '/api/data') && method === 'POST') {
      try {
        const body = await request.json();
        const d = { waktu: new Date().toISOString(), sumber: body.sumber || body.type || 'unknown', data: body.data || body };
        let old = [];
        try {
          const r = await fetch('https://api.github.com/gists/' + env.GIST_ID, { headers: { 'Authorization': 'token ' + env.GITHUB_TOKEN, 'User-Agent': 'CF' } });
          if (!r.ok) return new Response(JSON.stringify({ status: 'error', step: 'gist-get', code: r.status, msg: await r.text() }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
          const g = await r.json();
          if (g.files && g.files['data.json']) old = JSON.parse(g.files['data.json'].content || '[]');
        } catch(e) {
          return new Response(JSON.stringify({ status: 'error', step: 'gist-get', msg: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
        }
        old.push(d);
        if (old.length > 1000) old = old.slice(-1000);
        const patchResp = await fetch('https://api.github.com/gists/' + env.GIST_ID, {
          method: 'PATCH',
          headers: { 'Authorization': 'token ' + env.GITHUB_TOKEN, 'Content-Type': 'application/json', 'User-Agent': 'CF' },
          body: JSON.stringify({ files: { 'data.json': { content: JSON.stringify(old, null, 2) } } })
        });
        if (!patchResp.ok) return new Response(JSON.stringify({ status: 'error', step: 'gist-patch', code: patchResp.status, msg: await patchResp.text() }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
        return new Response(JSON.stringify({ status: 'ok' }), { headers: { 'Content-Type': 'application/json', ...cors } });
      } catch(e) {
        return new Response(JSON.stringify({ status: 'error', msg: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
      }
    }

    if ((url.pathname === '/data' || url.pathname === '/api/data') && method === 'GET') {
      if (url.searchParams.get('key') !== env.PASSWORD) return new Response('{"error":"Access Denied"}', { status: 403, headers: { 'Content-Type': 'application/json', ...cors } });
      try {
        const r = await fetch('https://api.github.com/gists/' + env.GIST_ID, { headers: { 'Authorization': 'token ' + env.GITHUB_TOKEN, 'User-Agent': 'CF' } });
        if (!r.ok) return new Response(JSON.stringify({ status: 'error', step: 'gist-get', code: r.status, msg: await r.text() }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
        const g = await r.json();
        const data = g.files && g.files['data.json'] ? JSON.parse(g.files['data.json'].content || '[]') : [];
        return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...cors } });
      } catch(e) {
        return new Response(JSON.stringify({ status: 'error', msg: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
      }
    }

    return new Response('{"error":"Not Found"}', { status: 404, headers: { 'Content-Type': 'application/json', ...cors } });
  }
};
