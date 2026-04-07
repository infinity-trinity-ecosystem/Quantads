import { IncomingMessage, ServerResponse } from "node:http";
import { auctionEngine } from "../auctions/AuctionEngine";
import { outcomeStore } from "../lib/outcome-store";
import { OutcomeReportRequestSchema } from "../lib/validation";
import { withAuth } from "../middleware/auth";

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

const parseInvoiceId = (url: string | undefined): string | null => {
  if (!url) {
    return null;
  }

  const match = url.match(/^\/api\/v1\/outcomes\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
};

export const handleOutcomeReport = withAuth(async (req: IncomingMessage, res: ServerResponse) => {
  const raw = await readJson(req);
  const parsed = OutcomeReportRequestSchema.safeParse(raw);

  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    sendJson(res, 422, { error: "Validation failed", details: errors });
    return;
  }

  if (!auctionEngine.hasInvoice(parsed.data.invoiceId)) {
    sendJson(res, 404, { error: "Invoice not registered in auction workflow" });
    return;
  }

  sendJson(res, 200, outcomeStore.recordOutcome(parsed.data));
});

export const handleOutcomeLookup = withAuth(async (req: IncomingMessage, res: ServerResponse) => {
  const invoiceId = parseInvoiceId(req.url);

  if (!invoiceId) {
    sendJson(res, 404, { error: "Outcome route not found" });
    return;
  }

  const ledger = outcomeStore.getInvoice(invoiceId);

  if (!ledger) {
    sendJson(res, 404, { error: "Invoice outcome ledger not found" });
    return;
  }

  sendJson(res, 200, ledger);
});
