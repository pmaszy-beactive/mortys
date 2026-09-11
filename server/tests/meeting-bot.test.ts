/**
 * Unit tests for meeting-bot helpers.
 *
 * Covers:
 *  - parseZoomMeeting   (URL parsing)
 *  - normalizeName        (normalisation)
 *  - levenshtein          (edit distance)
 *  - similarityRatio      (0–1 ratio)
 *  - matchSpeakersToStudents  (fuzzy name matching)
 *
 * No database access — all helpers are pure functions.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  dispatchMeetingBot,
  getMeetingBotRecording,
  getMeetingBotTranscript,
  parseZoomMeeting,
  stopMeetingBot,
} from "../services/meeting-bot-client";
import {
  normalizeName,
  levenshtein,
  similarityRatio,
  matchSpeakersToStudents,
  type NameCandidate,
} from "../services/meeting-bot";

// ---------------------------------------------------------------------------
// parseZoomMeeting
// ---------------------------------------------------------------------------

describe("parseZoomMeeting", () => {
  it("returns null for null/undefined/empty", () => {
    expect(parseZoomMeeting(null)).toBeNull();
    expect(parseZoomMeeting(undefined)).toBeNull();
    expect(parseZoomMeeting("")).toBeNull();
  });

  it("parses a plain https://zoom.us/j/<id> URL", () => {
    expect(parseZoomMeeting("https://zoom.us/j/12345678901")).toEqual({
      nativeMeetingId: "12345678901",
    });
  });

  it("preserves the pwd query param", () => {
    const url = "https://zoom.us/j/12345678901?pwd=secretxyz";
    const result = parseZoomMeeting(url);
    expect(result).toEqual({
      nativeMeetingId: "12345678901",
      passcode: "secretxyz",
    });
  });

  it("strips extra query params beyond pwd", () => {
    const url = "https://zoom.us/j/12345678901?pwd=abc&utm_source=email&foo=bar";
    expect(parseZoomMeeting(url)).toEqual({
      nativeMeetingId: "12345678901",
      passcode: "abc",
    });
  });

  it("handles subdomain URLs (us02web.zoom.us)", () => {
    const url = "https://us02web.zoom.us/j/99988877766?pwd=testpwd";
    expect(parseZoomMeeting(url)?.nativeMeetingId).toBe("99988877766");
  });

  it("handles URL without protocol when host is *.zoom.us", () => {
    const url = "zoom.us/j/12345678901";
    expect(parseZoomMeeting(url)?.nativeMeetingId).toBe("12345678901");
  });

  it("converts a plain 11-digit meeting ID to a URL", () => {
    expect(parseZoomMeeting("12345678901")).toEqual({
      nativeMeetingId: "12345678901",
    });
  });

  it("converts a hyphenated meeting ID (111-222-333) — 9 digits", () => {
    // strip hyphens → 9 digits
    expect(parseZoomMeeting("111-222-333")).toEqual({
      nativeMeetingId: "111222333",
    });
  });

  it("returns null for non-Zoom URLs", () => {
    expect(parseZoomMeeting("https://teams.microsoft.com/l/meetup")).toBeNull();
    expect(parseZoomMeeting("https://meet.google.com/abc-def-ghi")).toBeNull();
  });

  it("returns null for random strings", () => {
    expect(parseZoomMeeting("not a url at all")).toBeNull();
  });

  it("returns null when path is not /j/<id>", () => {
    expect(parseZoomMeeting("https://zoom.us/s/12345678901")).toBeNull();
  });
});

describe("Backbone Meeting Bot API client", () => {
  beforeEach(() => {
    process.env.MEETING_BOT_API_KEY = "test-key";
    process.env.MEETING_BOT_BASE_URL =
      "https://backbone.example.test/meeting-bot/";
  });

  afterEach(() => {
    delete process.env.MEETING_BOT_API_KEY;
    delete process.env.MEETING_BOT_BASE_URL;
    vi.unstubAllGlobals();
  });

  it("dispatches Zoom using native_meeting_id and passcode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          meeting_id: "meeting-1",
          session_id: "session-1",
          status: "joining",
          platform: "zoom",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await dispatchMeetingBot({
      nativeMeetingId: "12345678901",
      passcode: "encoded-passcode",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://backbone.example.test/meeting-bot/bots");
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe("test-key");
    expect(JSON.parse(init.body)).toMatchObject({
      platform: "zoom",
      native_meeting_id: "12345678901",
      passcode: "encoded-passcode",
    });
    expect(JSON.parse(init.body)).not.toHaveProperty("meeting_url");
  });

  it("uses the documented transcript endpoint and response shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          meeting_id: "meeting/1",
          session_id: "session-1",
          status: "completed",
          segments: [{ seq: 1, speaker: "Jane Doe", text: "Hi", start_time: 0, end_time: 1 }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const transcript = await getMeetingBotTranscript("meeting/1");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://backbone.example.test/meeting-bot/meetings/meeting%2F1/transcript",
    );
    expect(transcript.status).toBe("completed");
    expect(transcript.segments[0].speaker).toBe("Jane Doe");
  });

  it("returns the raw recording response and forwards download mode", async () => {
    const response = new Response("recording bytes", {
      status: 200,
      headers: { "Content-Type": "video/webm" },
    });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    expect(await getMeetingBotRecording("meeting-1", true)).toBe(response);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://backbone.example.test/meeting-bot/meetings/meeting-1/recording?download=1",
    );
  });

  it("stops the bot with the documented POST endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ meeting_id: "meeting-1", status: "completed" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await stopMeetingBot("meeting-1");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://backbone.example.test/meeting-bot/meetings/meeting-1/stop",
    );
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("fails explicitly instead of guessing a Backbone host", async () => {
    delete process.env.MEETING_BOT_BASE_URL;
    await expect(
      dispatchMeetingBot({ nativeMeetingId: "12345678901" }),
    ).rejects.toThrow("MEETING_BOT_BASE_URL");
  });
});

// ---------------------------------------------------------------------------
// normalizeName
// ---------------------------------------------------------------------------

describe("normalizeName", () => {
  it("lowercases and trims", () => {
    expect(normalizeName("  Jane Doe  ")).toBe("jane doe");
  });

  it("strips diacritics", () => {
    expect(normalizeName("Élodie Müller")).toBe("elodie muller");
  });

  it("removes punctuation", () => {
    expect(normalizeName("O'Brien")).toBe("obrien");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeName("John   Michael  Smith")).toBe("john michael smith");
  });
});

// ---------------------------------------------------------------------------
// levenshtein
// ---------------------------------------------------------------------------

describe("levenshtein", () => {
  it("returns 0 for equal strings", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
  });

  it("counts single character substitution", () => {
    expect(levenshtein("kitten", "sitten")).toBe(1);
  });

  it("counts insertions and deletions", () => {
    expect(levenshtein("abc", "abcd")).toBe(1);
    expect(levenshtein("abcd", "abc")).toBe(1);
  });

  it("returns full length for completely different strings", () => {
    expect(levenshtein("abc", "xyz")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// similarityRatio
// ---------------------------------------------------------------------------

describe("similarityRatio", () => {
  it("returns 1.0 for identical strings", () => {
    expect(similarityRatio("hello", "hello")).toBe(1);
  });

  it("returns 0 when both strings are empty", () => {
    expect(similarityRatio("", "")).toBe(1); // both empty = identical
  });

  it("returns a high ratio for a minor typo", () => {
    // 'johnsmith' vs 'johmsmith' = 1 edit / 9 chars ≈ 0.89
    expect(similarityRatio("johnsmith", "johmsmith")).toBeGreaterThan(0.8);
  });

  it("returns a lower ratio for very different strings", () => {
    expect(similarityRatio("abc", "xyz")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// matchSpeakersToStudents
// ---------------------------------------------------------------------------

function mkCandidate(
  id: number,
  firstName: string,
  lastName: string,
): NameCandidate {
  return {
    studentId: id,
    enrollmentId: id * 100,
    firstName,
    lastName,
    normalizedName: normalizeName(`${firstName} ${lastName}`),
  };
}

describe("matchSpeakersToStudents", () => {
  const roster: NameCandidate[] = [
    mkCandidate(1, "Jane", "Doe"),
    mkCandidate(2, "John", "Smith"),
    mkCandidate(3, "Alice", "Johnson"),
    mkCandidate(4, "Bob", "Brown"),
  ];

  it("exact full-name match", () => {
    const map = matchSpeakersToStudents(["Jane Doe"], roster);
    expect(map.get("Jane Doe")?.studentId).toBe(1);
  });

  it("case-insensitive match", () => {
    const map = matchSpeakersToStudents(["JANE DOE"], roster);
    expect(map.get("JANE DOE")?.studentId).toBe(1);
  });

  it("matches with minor typo (Jahn Smith → John Smith)", () => {
    const map = matchSpeakersToStudents(["Jahn Smith"], roster);
    // similarity("jahn smith", "john smith") > 0.7
    expect(map.get("Jahn Smith")?.studentId).toBe(2);
  });

  it("no double-assignment: each student matched at most once", () => {
    // Two speakers both close to 'Jane Doe'; only one should get matched
    const map = matchSpeakersToStudents(["Jane Doe", "Jane D"], roster);
    const matched = [...map.values()].filter((c) => c.studentId === 1);
    expect(matched).toHaveLength(1);
  });

  it("returns empty map for empty inputs", () => {
    expect(matchSpeakersToStudents([], roster).size).toBe(0);
    expect(matchSpeakersToStudents(["Alice Johnson"], []).size).toBe(0);
  });

  it("ignores speakers that don't match any candidate", () => {
    const map = matchSpeakersToStudents(["Zzzzz Yyyyy"], roster);
    expect(map.size).toBe(0);
  });

  it("matches first name only when unique", () => {
    // Only one 'Bob' in the roster
    const map = matchSpeakersToStudents(["Bob"], roster);
    expect(map.get("Bob")?.studentId).toBe(4);
  });

  it("does NOT match first name when ambiguous", () => {
    // Two Johns → first-name-only should not match
    const ambiguousRoster: NameCandidate[] = [
      mkCandidate(10, "John", "Smith"),
      mkCandidate(11, "John", "Williams"),
    ];
    const map = matchSpeakersToStudents(["John"], ambiguousRoster);
    // Should not match because first name is ambiguous
    expect(map.size).toBe(0);
  });

  it("handles diacritics (élodie → Elodie)", () => {
    const r: NameCandidate[] = [mkCandidate(20, "Élodie", "Martin")];
    const map = matchSpeakersToStudents(["elodie martin"], r);
    expect(map.get("elodie martin")?.studentId).toBe(20);
  });
});
