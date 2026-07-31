export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Endpoint /data
    if (path === "/data" || path === "/data/") {
      return new Response(JSON.stringify({ message: "Data endpoint" }), {
        headers: { "content-type": "application/json" },
      });
    }

    // Endpoint /api/data
    if (path === "/api/data" || path === "/api/data/") {
      return new Response(JSON.stringify({ message: "API data endpoint" }), {
        headers: { "content-type": "application/json" },
      });
    }

    // Fallback
    return new Response("Not found", { status: 404 });
  },
};
