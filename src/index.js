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

    // === ENDPOINT DEBUG ===
    if (url.pathname === '/api/debug') {
      try {
        const r1 = await fetch('https://api.github.com/rate_limit');
        const t1 = await r1.text();
        const r2 = await fetch('https://gist.githubusercontent.com/pandora-site/' + env.GIST_ID + '/raw/data.json');
        const t2 = await r2.text();
        return new Response(JSON.stringify({
          hasToken: !!env.GITHUB_TOKEN,
          hasGistId: !!env.GIST_ID,
          hasPassword: !!env.PASSWORD,
          gistId: env.GIST_ID || '(undefined)',
          test1_status: r1.status,
          test1_body: t1.substring(0, 200),
          test2_status: r2.status,
          test2_body: t2.substring(0, 200)
        }, null, 2), { headers: { 'Content-Type': 'application/json', ...cors } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { headers: { 'Content-Type': 'application/json', ...cors } });
      }
    }

    // === ENDPOINT POST ===
    if ((url.pathname === '/data' || url.pathname === '/api/data') && method === 'POST') {
      try {
        const body = await request.json();
        const d = {
          waktu: new Date().toISOString(),
          sumber: body.sumber || body.type || 'unknown',
          data: body.data || body
        };

        // Baca data lama dari raw URL
        let old = [];
        try {
          const rawRes = await fetch('https://gist.githubusercontent.com/pandora-site/' + env.GIST_ID + '/raw/data.json');
          if (rawRes.ok) {
            const text = await rawRes.text();
            try { old = JSON.parse(text || '[]'); } catch(e) {}
          }
        } catch(e) {}

        old.push(d);
        if (old.length > 1000) old = old.slice(-1000);

        // Simpan ke Gist via API
        const patchRes = await fetch('https://api.github.com/gists/' + env.GIST_ID, {
          method: 'PATCH',
          headers: {
            'Authorization': 'token ' + env.GITHUB_TOKEN,
            'Content-Type': 'application/json',
            'User-Agent': 'CF-Worker',
            'Accept': 'application/vnd.github.v3+json'
          },
          body: JSON.stringify({
            files: { 'data.json': { content: JSON.stringify(old, null, 2) } }
          })
        });

        if (!patchRes.ok) {
          const errText = await patchRes.text();
          return new Response(JSON.stringify({ status: 'error', code: patchRes.status, msg: errText.substring(0, 300) }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
        }

        return new Response(JSON.stringify({ status: 'ok', total: old.length }), { headers: { 'Content-Type': 'application/json', ...cors } });
      } catch(e) {
        return new Response(JSON.stringify({ status: 'error', msg: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
      }
    }

    // === ENDPOINT GET ===
    if ((url.pathname === '/data' || url.pathname === '/api/data') && method === 'GET') {
      if (url.searchParams.get('key') !== env.PASSWORD) {
        return new Response('{"error":"Access Denied"}', { status: 403, headers: { 'Content-Type': 'application/json', ...cors } });
      }
      try {
        const rawRes = await fetch('https://gist.githubusercontent.com/pandora-site/' + env.GIST_ID + '/raw/data.json');
        if (rawRes.ok) {
          const text = await rawRes.text();
          const data = (() => { try { return JSON.parse(text || '[]'); } catch(e) { return []; } })();
          return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...cors } });
        }
        return new Response('[]', { headers: { 'Content-Type': 'application/json', ...cors } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
      }
    }

    return new Response('{"error":"Not Found"}', { status: 404, headers: { 'Content-Type': 'application/json', ...cors } });
  }
};
