import { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { getYieldDashHtml } from "../components/YieldDash";
import { YieldCreativeStyle, YieldSlotFormat } from "../services/BidAggregator";
import { arbitrageEngine } from "../services/ArbitrageEngine";
import { withAuth } from "../middleware/auth";
import { YieldArbitrageRequestSchema } from "../lib/validation";

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

const sendHtml = (res: ServerResponse, status: number, html: string): void => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
};

const readJson = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }

  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
};

const sendValidationFailure = (res: ServerResponse, error: z.ZodError): void => {
  sendJson(res, 422, {
    error: "Validation failed",
    details: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
  });
};

export const handleYieldArbitrageEvaluate = withAuth(async (req: IncomingMessage, res: ServerResponse) => {
  const parsed = YieldArbitrageRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    sendValidationFailure(res, parsed.error);
    return;
  }

  sendJson(res, 200, arbitrageEngine.evaluate(parsed.data));
});

export const handleYieldDashboardSummary = withAuth(async (_req: IncomingMessage, res: ServerResponse) => {
  sendJson(res, 200, arbitrageEngine.getDashboard());
});

export const handleYieldDashboardPage = withAuth(async (req: IncomingMessage, res: ServerResponse) => {
  const rawAuthorization = req.headers.authorization?.slice(7) ?? "";
  sendHtml(res, 200, getYieldDashHtml({ token: rawAuthorization }));
});

export type { YieldCreativeStyle, YieldSlotFormat };
