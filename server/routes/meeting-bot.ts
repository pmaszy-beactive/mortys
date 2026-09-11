import type { Express, RequestHandler } from "express";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { jobs as jobsTable, meetingBotMeetings } from "@shared/schema";
import { storage } from "../storage";
import { captureRequestError } from "../services/error-logger";
import {
  dispatchBotForClass,
  enqueueReconciliation,
  getMeetingBotMeeting,
  getMeetingBotMeetingByClass,
  listMeetingBotMeetings,
  syncMeetingStatus,
} from "../services/meeting-bot";
import {
  getMeetingBotRecording,
  MeetingBotApiError,
  parseZoomMeeting,
  stopMeetingBot,
} from "../services/meeting-bot-client";

export function registerMeetingBotAdminRoutes(
  app: Express,
  requireAdmin: RequestHandler,
): void {
  app.get("/api/admin/meeting-bot/sessions", requireAdmin, async (_req, res) => {
    try {
      res.json(await listMeetingBotMeetings());
    } catch (error) {
      captureRequestError(error);
      res.status(500).json({ message: "Failed to list meeting-bot sessions" });
    }
  });

  app.get(
    "/api/admin/classes/:classId/meeting-bot",
    requireAdmin,
    async (req, res) => {
      try {
        const classId = parseInt(req.params.classId, 10);
        if (!Number.isInteger(classId)) {
          return res.status(400).json({ message: "Invalid class id" });
        }
        const row = await getMeetingBotMeetingByClass(classId);
        if (
          row?.meetingId &&
          (row.status === "joining" || row.status === "active")
        ) {
          return res.json(await syncMeetingStatus(row.id));
        }
        if (
          row?.dispatchJobId &&
          !row.meetingId &&
          (row.status === "pending" || row.status === "joining")
        ) {
          const [dispatchJob] = await db
            .select({
              status: jobsTable.status,
              lastError: jobsTable.lastError,
            })
            .from(jobsTable)
            .where(eq(jobsTable.id, row.dispatchJobId));
          if (
            dispatchJob &&
            (dispatchJob.status === "failed" ||
              dispatchJob.status === "cancelled")
          ) {
            const [failed] = await db
              .update(meetingBotMeetings)
              .set({
                status: "failed",
                dispatchUncertain: row.status === "joining",
                errorMessage:
                  dispatchJob.lastError ||
                  "The dispatch job ended before a meeting id was saved",
                updatedAt: new Date(),
              })
              .where(eq(meetingBotMeetings.id, row.id))
              .returning();
            return res.json(failed);
          }
        }
        res.json(row);
      } catch (error) {
        captureRequestError(error);
        res.status(500).json({ message: "Failed to fetch meeting bot status" });
      }
    },
  );

  app.get(
    "/api/admin/meeting-bot/sessions/:id",
    requireAdmin,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const row = await getMeetingBotMeeting(id);
        if (!row) return res.status(404).json({ message: "Session not found" });
        res.json(row);
      } catch (error) {
        captureRequestError(error);
        res.status(500).json({ message: "Failed to fetch session" });
      }
    },
  );

  app.post(
    "/api/admin/meeting-bot/dispatch",
    requireAdmin,
    async (req, res) => {
      try {
        const { classId } = req.body ?? {};
        if (!classId || typeof classId !== "number") {
          return res
            .status(400)
            .json({ message: "classId (number) is required" });
        }
        const classRow = await storage.getClass(classId);
        if (!classRow) {
          return res.status(404).json({ message: "Class not found" });
        }
        if (!classRow.zoomLink) {
          return res.status(400).json({
            message: "Class has no Zoom link — set one before dispatching the bot",
          });
        }
        if (!parseZoomMeeting(classRow.zoomLink)) {
          return res.status(400).json({
            message: `Unrecognised Zoom URL on class: "${classRow.zoomLink}"`,
          });
        }
        res.status(202).json(
          await dispatchBotForClass(classId, classRow.zoomLink),
        );
      } catch (error: any) {
        captureRequestError(error);
        if (error?.message?.includes("already exists")) {
          return res.status(409).json({ message: error.message });
        }
        res.status(500).json({
          message: error?.message || "Failed to dispatch meeting bot",
        });
      }
    },
  );

  app.post(
    "/api/admin/meeting-bot/sessions/:id/reconcile",
    requireAdmin,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const row = await getMeetingBotMeeting(id);
        if (!row) return res.status(404).json({ message: "Session not found" });
        res.status(202).json({ jobId: await enqueueReconciliation(id) });
      } catch (error) {
        captureRequestError(error);
        res.status(500).json({ message: "Failed to enqueue reconcile job" });
      }
    },
  );

  app.post(
    "/api/admin/meeting-bot/sessions/:id/stop",
    requireAdmin,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const row = await getMeetingBotMeeting(id);
        if (!row) return res.status(404).json({ message: "Session not found" });
        if (!row.meetingId) {
          return res.status(400).json({
            message: "Bot has not been dispatched yet (no meeting id)",
          });
        }
        await stopMeetingBot(row.meetingId);
        await db
          .update(meetingBotMeetings)
          .set({
            status: "completed",
            endedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(meetingBotMeetings.id, id));
        await enqueueReconciliation(id, new Date(Date.now() + 60_000));
        res.json({ ok: true });
      } catch (error) {
        captureRequestError(error);
        res.status(500).json({ message: "Failed to stop bot session" });
      }
    },
  );

  app.get(
    "/api/admin/meeting-bot/sessions/:id/recording",
    requireAdmin,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const row = await getMeetingBotMeeting(id);
        if (!row) return res.status(404).json({ message: "Session not found" });
        if (!row.meetingId) {
          return res
            .status(400)
            .json({ message: "Bot has not been dispatched yet" });
        }
        const download = req.query.download === "1";
        let upstream: Response | null = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          upstream = await getMeetingBotRecording(row.meetingId, download);
          if (upstream.status !== 404) break;
          if (attempt < 3) {
            await new Promise((resolve) =>
              setTimeout(resolve, 2 ** attempt * 1000),
            );
          }
        }
        if (!upstream || upstream.status === 404) {
          return res.status(404).json({
            message: "Recording is still being prepared. Please try again shortly.",
          });
        }
        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => "");
          throw new MeetingBotApiError(
            upstream.status,
            `Recording request failed: ${detail || upstream.statusText}`,
          );
        }
        const contentType = upstream.headers.get("content-type");
        const disposition = upstream.headers.get("content-disposition");
        const length = upstream.headers.get("content-length");
        if (contentType) res.setHeader("Content-Type", contentType);
        if (disposition) res.setHeader("Content-Disposition", disposition);
        if (length) res.setHeader("Content-Length", length);
        await db
          .update(meetingBotMeetings)
          .set({ recordingAvailable: true, updatedAt: new Date() })
          .where(eq(meetingBotMeetings.id, id));
        if (!upstream.body) {
          return res
            .status(502)
            .json({ message: "Recording response was empty" });
        }
        Readable.fromWeb(upstream.body as any).pipe(res);
      } catch (error) {
        captureRequestError(error);
        res.status(500).json({ message: "Failed to fetch recording" });
      }
    },
  );

  app.post(
    "/api/admin/meeting-bot/sessions/:id/sync-status",
    requireAdmin,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const row = await getMeetingBotMeeting(id);
        if (!row) return res.status(404).json({ message: "Session not found" });
        if (!row.meetingId) {
          return res.status(400).json({
            message: "No meeting id — session has not been dispatched",
          });
        }
        res.json(await syncMeetingStatus(id));
      } catch (error) {
        captureRequestError(error);
        res.status(500).json({ message: "Failed to sync session status" });
      }
    },
  );
}