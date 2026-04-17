import { IncomingMessage, ServerResponse } from "node:http";
import { BciAttentionSignalSchema } from "../lib/validation";
import { BciAttentionSignal } from "../types";
import { bciAttentionStore } from "../bci/AttentionStore";
import { withAuth } from "../middleware/auth";
import { logger } from "../lib/logger";

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

const readJson = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
};

/**
 * POST /api/v1/bci/attention
 *
 * Ingests a BCI attention signal for the authenticated user.
 * Only derived attention scores are stored – raw neural data is never sent or persisted.
 * Requires a valid Quantmail Bearer JWT.
 */
export const handleBciIngest = withAuth(async (req: IncomingMessage, res: ServerResponse) => {
  const raw = await readJson(req);
  const parsed = BciAttentionSignalSchema.safeParse(raw);

  if (!parsed.success) {
    const errors = parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
    logger.warn({ errors }, "BCI attention signal validation failed");
    sendJson(res, 422, { error: "Validation failed", details: errors });
    return;
  }

  const signal = parsed.data as BciAttentionSignal;
  logger.info({ sessionId: signal.sessionId, platform: signal.platform }, "BCI attention signal ingested");

  const record = bciAttentionStore.ingest(signal);
  sendJson(res, 201, record);
});

/**
 * GET /api/v1/bci/attention/:userId/aggregated
 *
 * Returns aggregated BCI attention metrics for the given user.
 * Requires a valid Quantmail Bearer JWT.
 */
export const handleBciAggregated = withAuth(async (req: IncomingMessage, res: ServerResponse) => {
  const match = req.url?.match(/^\/api\/v1\/bci\/attention\/([^/]+)\/aggregated$/);

  if (!match) {
    sendJson(res, 404, { error: "BCI route not found" });
    return;
  }

  const userId = decodeURIComponent(match[1]);
  const metrics = bciAttentionStore.getAggregated(userId);

  if (!metrics) {
    sendJson(res, 404, { error: "No BCI signals found for the specified user" });
    return;
  }

  sendJson(res, 200, metrics);
});
