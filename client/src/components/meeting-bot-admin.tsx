import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CircleDot,
  Download,
  ExternalLink,
  Loader2,
  Mic2,
  Play,
  RefreshCw,
  Send,
  Square,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type MeetingBotStatus = "pending" | "joining" | "active" | "completed" | "failed" | "stopped";

export interface MeetingBotMeeting {
  id: number;
  classId: number;
  meetingId: string | null;
  sessionId: string | null;
  status: MeetingBotStatus;
  dispatchedAt: string | null;
  endedAt: string | null;
  recordingAvailable: boolean;
  reconcileReport: {
    matched: ReconcileEntry[];
    unmatched: ReconcileEntry[];
    unknownSpeakers: string[];
  } | null;
  reconciledAt: string | null;
  dispatchUncertain: boolean;
  errorMessage: string | null;
}

interface ReconcileEntry {
  enrollmentId: number;
  studentId: number;
  firstName: string;
  lastName: string;
  matchedSpeaker: string | null;
  attendanceStatus: string;
  skippedDueToOverride: boolean;
}

interface MeetingBotAdminProps {
  classId: number;
}

const statusCopy: Record<MeetingBotStatus, string> = {
  pending: "Queued",
  joining: "Joining meeting",
  active: "Recording",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
};

const statusClass: Record<MeetingBotStatus, string> = {
  pending: "border-slate-300 bg-slate-50 text-slate-700",
  joining: "border-blue-200 bg-blue-50 text-blue-700",
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  completed: "border-teal-200 bg-teal-50 text-teal-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  stopped: "border-amber-200 bg-amber-50 text-amber-800",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function Metric({ label, value, tone = "text-slate-900" }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

export default function MeetingBotAdmin({ classId }: MeetingBotAdminProps) {
  const { toast } = useToast();
  const queryKey = ["/api/admin/classes", classId, "meeting-bot"];
  const { data: meeting, isLoading, isError, refetch } = useQuery<MeetingBotMeeting | null>({
    queryKey,
    queryFn: () => apiRequest("GET", `/api/admin/classes/${classId}/meeting-bot`),
    enabled: !!classId,
    staleTime: 0,
    refetchInterval: (query) => {
      const current = query.state.data as MeetingBotMeeting | null | undefined;
      if (!current) return false;
      return ["pending", "joining", "active"].includes(current.status) ||
        (current.status === "completed" && !current.reconciledAt)
        ? 10_000
        : false;
    },
  });

  useEffect(() => {
    if (meeting?.reconciledAt) {
      queryClient.invalidateQueries({
        queryKey: ["/api/classes", classId, "enrolled-students"],
      });
    }
  }, [classId, meeting?.reconciledAt]);

  const action = useMutation({
    mutationFn: ({ method, url, body }: { method: string; url: string; body?: unknown }) =>
      apiRequest(method, url, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (error: Error) => toast({ title: "Meeting bot action failed", description: error.message, variant: "destructive" }),
  });

  const dispatch = () => action.mutate(
    { method: "POST", url: "/api/admin/meeting-bot/dispatch", body: { classId } },
    { onSuccess: () => toast({ title: "Meeting bot dispatched", description: "The office session is queued to join Zoom." }) },
  );
  const sync = () => action.mutate(
    { method: "POST", url: `/api/admin/meeting-bot/sessions/${meeting?.id}/sync-status` },
    { onSuccess: () => toast({ title: "Status refreshed" }) },
  );
  const stop = () => action.mutate(
    { method: "POST", url: `/api/admin/meeting-bot/sessions/${meeting?.id}/stop` },
    { onSuccess: () => toast({ title: "Recording stopped" }) },
  );
  const reconcile = () => action.mutate(
    { method: "POST", url: `/api/admin/meeting-bot/sessions/${meeting?.id}/reconcile` },
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/classes", classId, "enrolled-students"] });
        toast({ title: "Attendance reconciliation queued", description: "Results will appear here when transcript processing finishes." });
      },
    },
  );

  if (isLoading) {
    return <div className="mt-4 animate-pulse space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4" aria-label="Loading meeting bot details">
      <div className="h-4 w-36 rounded bg-slate-200" /><div className="h-12 rounded bg-slate-200" /><div className="h-8 w-2/3 rounded bg-slate-200" />
    </div>;
  }

  if (isError) {
    return <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <span>Meeting bot details could not be loaded.</span>
      <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="mr-2 h-3.5 w-3.5" />Retry</Button>
    </div>;
  }

  if (!meeting) {
    return (
      <section className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50/80 p-4" data-testid="meeting-bot-empty">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Mic2 className="h-4 w-4 text-[#b38b2f]" />Meeting bot</div>
            <p className="mt-1 text-xs text-slate-500">No attendance session has been sent for this Zoom class.</p>
          </div>
          <Button size="sm" onClick={dispatch} disabled={action.isPending} className="bg-[#ecc462] text-[#171717] hover:bg-[#d8af50]">
            {action.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send meeting bot
          </Button>
        </div>
      </section>
    );
  }

  const report = meeting.reconcileReport;
  const canStop = meeting.status === "joining" || meeting.status === "active";
  const canReconcile = meeting.status === "completed" || meeting.status === "stopped";
  const recordingUrl = `/api/admin/meeting-bot/sessions/${meeting.id}/recording`;

  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-50/80" data-testid="meeting-bot-admin">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Mic2 className="h-4 w-4 text-[#b38b2f]" />
          <div><h3 className="text-sm font-semibold text-slate-900">Meeting bot</h3><p className="text-xs text-slate-500">Zoom attendance capture</p></div>
          <Badge variant="outline" className={`ml-1 capitalize ${statusClass[meeting.status]}`}><CircleDot className="mr-1 h-3 w-3" />{statusCopy[meeting.status]}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={sync} disabled={action.isPending}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${action.isPending ? "animate-spin" : ""}`} />Refresh</Button>
          {canStop && <Button size="sm" variant="outline" className="border-amber-300 text-amber-800 hover:bg-amber-50" onClick={stop} disabled={action.isPending}><Square className="mr-1.5 h-3.5 w-3.5" />Stop</Button>}
          {canReconcile && <Button size="sm" onClick={reconcile} disabled={action.isPending}><Check className="mr-1.5 h-3.5 w-3.5" />Reconcile</Button>}
          {meeting.status === "failed" && !meeting.dispatchUncertain && <Button size="sm" onClick={dispatch} disabled={action.isPending}><Send className="mr-1.5 h-3.5 w-3.5" />Send again</Button>}
        </div>
      </div>
      <div className="space-y-4 p-4">
        {(meeting.status === "failed" || meeting.errorMessage) && <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{meeting.errorMessage || "The meeting bot reported an error."}{meeting.dispatchUncertain && " The bot may still have joined; verify the meeting in Backbone before trying again."}</span></div>}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Matched" value={report?.matched.length ?? "—"} tone="text-emerald-700" />
          <Metric label="Absent" value={report?.unmatched.length ?? "—"} tone="text-amber-700" />
          <Metric label="Unknown speakers" value={report?.unknownSpeakers.length ?? "—"} tone="text-red-700" />
          <Metric label="Reconciled" value={meeting.reconciledAt ? "Yes" : "No"} tone={meeting.reconciledAt ? "text-emerald-700" : "text-slate-500"} />
        </div>
        <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
          <div><span className="font-semibold text-slate-700">Meeting ID</span><div className="mt-0.5 break-all font-mono text-[11px]">{meeting.meetingId || "Not assigned"}</div></div>
          <div><span className="font-semibold text-slate-700">Session ID</span><div className="mt-0.5 break-all font-mono text-[11px]">{meeting.sessionId || meeting.id}</div></div>
          <div><span className="font-semibold text-slate-700">Dispatched</span><div className="mt-0.5">{formatDate(meeting.dispatchedAt)}</div></div>
          <div><span className="font-semibold text-slate-700">Ended</span><div className="mt-0.5">{formatDate(meeting.endedAt)}</div></div>
        </div>
        {report && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Attended</div>
              {report.matched.length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                  {report.matched.map((entry) => (
                    <li key={entry.enrollmentId}>
                      {entry.firstName} {entry.lastName}
                      {entry.matchedSpeaker && <span className="text-xs text-slate-500"> — “{entry.matchedSpeaker}”</span>}
                      {entry.skippedDueToOverride && <Badge variant="outline" className="ml-2 text-[10px]">Manual override kept</Badge>}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-xs text-slate-500">No enrolled students matched.</p>}
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">Absent / unmatched</div>
              {report.unmatched.length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                  {report.unmatched.map((entry) => (
                    <li key={entry.enrollmentId}>
                      {entry.firstName} {entry.lastName}
                      {entry.skippedDueToOverride && <Badge variant="outline" className="ml-2 text-[10px]">Manual override kept</Badge>}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-xs text-slate-500">Everyone on the roster matched.</p>}
            </div>
            {report.unknownSpeakers.length > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50/60 p-3 sm:col-span-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-red-800">Unmatched Zoom names</div>
                <p className="mt-2 text-sm text-slate-700">{report.unknownSpeakers.join(", ")}</p>
              </div>
            )}
          </div>
        )}
        {(meeting.status === "completed" || meeting.status === "stopped" || meeting.recordingAvailable) && (
          <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-slate-800"><Play className="h-4 w-4 text-[#b38b2f]" />{meeting.recordingAvailable ? "Recording available" : "Meeting recording"}</div>
              {!meeting.recordingAvailable && <p className="mt-1 text-xs text-slate-500">Backbone may still be preparing it; the action retries briefly.</p>}
            </div>
            <div className="flex gap-2">
              <a href={recordingUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Play</a>
              <a href={`${recordingUrl}?download=1`} download className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"><Download className="mr-1.5 h-3.5 w-3.5" />Download</a>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}