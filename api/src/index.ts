export { FeedDO } from "./feed_do";

// Stub: real routing (allowlist, rate limit, debug route) lands with U4.
export default {
  async fetch(_request: Request, _env: Env): Promise<Response> {
    return Response.json({ error: "not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
