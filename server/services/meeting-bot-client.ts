/**
 * Server-only client for Backbone's Meeting Bot tenant API.
 *
 * MEETING_BOT_BASE_URL must include the `/meeting-bot` prefix, for example:
 * https://backbone.example.com/meeting-bot
 */

const DISPATCH_TIMEOUT_MS = 3 * 60 * 1000;

export interface ZoomMeetingDetails {
  nativeMeetingId: string;
  passcode?: string;
}

export interface MeetingBotDispatchResponse {
  meeting_id: string;
  session_id: string;
  status: "joining" | "active" | "completed" | "failed";
  platform: "zoom";
  mock?: boolean;
}

export interface MeetingBotTranscriptSegment {
  seq: number;
  speaker: string;
  speaker_id?: string;
  text: string;
  start_time: number;
  end_time: number;
  language?: string;
  is_final?: boolean;
}

export interface MeetingBotTranscriptResponse {
  meeting_id: string;
  session_id: string;
  status: "joining" | "active" | "completed" | "failed";
  segments: MeetingBotTranscriptSegment[];
}

export interface MeetingBotStopResponse {
  meeting_id: string;
  status: "completed" | "failed";
  recorded_seconds?: number;
  transcribed_seconds?: number;
  charged_usd?: number;
}

export class MeetingBotApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "MeetingBotApiError";
  }
}

/**
 * Zoom URLs are not parsed by Backbone, so extract the native numeric ID and
 * password token here. Plain 9–11 digit meeting IDs are also accepted.
 */
export function parseZoomMeeting(
  raw: string | null | undefined,
): ZoomMeetingDetails | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const plainId = trimmed.replace(/[\s-]/g, "");
  if (/^\d{9,11}$/.test(plainId)) {
    return { nativeMeetingId: plainId };
  }

  let url: URL;
  try {
    const withProtocol = /^([a-z0-9-]+\.)*zoom\.us(?:\/|$)/i.test(trimmed)
      ? `https://${trimmed}`
      : trimmed;
    url = new URL(withProtocol);
  } catch {
    return null;
  }

  if (url.hostname !== "zoom.us" && !url.hostname.endsWith(".zoom.us")) {
    return null;
  }
  const match = url.pathname.match(/^\/(?:j|wc\/join)\/(\d{9,11})(?:\/|$)/);
  if (!match) return null;
  const passcode = url.searchParams.get("pwd") || undefined;
  return { nativeMeetingId: match[1], passcode };
}

function getConfig(): { apiKey: string; baseUrl: string } {
  const apiKey = process.env.MEETING_BOT_API_KEY?.trim();
  const baseUrl = process.env.MEETING_BOT_BASE_URL?.trim().replace(/\/+$/, "");
  if (!apiKey) {
    throw new Error(
      "MEETING_BOT_API_KEY is not configured in server secrets",
    );
  }
  if (!baseUrl) {
    throw new Error(
      "MEETING_BOT_BASE_URL is not configured (it must end with /meeting-bot)",
    );
  }
  return { apiKey, baseUrl };
}

async function meetingBotFetch(
  path: string,
  options: RequestInit = {},
  timeoutMs = 30_000,
): Promise<Response> {
  const { apiKey, baseUrl } = getConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        "x-api-key": apiKey,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error(`Meeting Bot request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson<T>(response: Response, path: string): Promise<T> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new MeetingBotApiError(
      response.status,
      `Meeting Bot ${path} failed (${response.status}): ${body || response.statusText}`,
    );
  }
  return response.json() as Promise<T>;
}

export async function dispatchMeetingBot(
  zoom: ZoomMeetingDetails,
  botName = "Morty's Attendance Bot",
): Promise<MeetingBotDispatchResponse> {
  const path = "/bots";
  const response = await meetingBotFetch(
    path,
    {
      method: "POST",
      body: JSON.stringify({
        platform: "zoom",
        native_meeting_id: zoom.nativeMeetingId,
        ...(zoom.passcode ? { passcode: zoom.passcode } : {}),
        bot_name: botName,
        language: "en",
      }),
    },
    DISPATCH_TIMEOUT_MS,
  );
  return readJson<MeetingBotDispatchResponse>(response, path);
}

export async function getMeetingBotTranscript(
  meetingId: string,
): Promise<MeetingBotTranscriptResponse> {
  const path = `/meetings/${encodeURIComponent(meetingId)}/transcript`;
  return readJson<MeetingBotTranscriptResponse>(
    await meetingBotFetch(path),
    path,
  );
}

export async function stopMeetingBot(
  meetingId: string,
): Promise<MeetingBotStopResponse> {
  const path = `/meetings/${encodeURIComponent(meetingId)}/stop`;
  return readJson<MeetingBotStopResponse>(
    await meetingBotFetch(path, { method: "POST" }),
    path,
  );
}

/** Returns the raw recording response so the authenticated server route can stream it. */
export async function getMeetingBotRecording(
  meetingId: string,
  download = false,
): Promise<Response> {
  const suffix = download ? "?download=1" : "";
  return meetingBotFetch(
    `/meetings/${encodeURIComponent(meetingId)}/recording${suffix}`,
    {},
    60_000,
  );
}