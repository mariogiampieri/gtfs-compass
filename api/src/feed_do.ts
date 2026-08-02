import { DurableObject } from "cloudflare:workers";

// Stub: real implementation lands with U3 (alarm loop, self-suspend, snapshot).
export class FeedDO extends DurableObject {
  async fetch(_request: Request): Promise<Response> {
    return Response.json({ error: "not implemented" }, { status: 501 });
  }
}
