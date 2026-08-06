import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Cog, RefreshCw, XCircle, Play, RotateCcw, ChevronDown, ChevronRight, PauseCircle } from "lucide-react";
import { format } from "date-fns";
import type { Job } from "@shared/schema";

type JobWithHeld = Job & { held: boolean };

interface JobsResponse {
  billingHoldUntil: string | null;
  billingHoldActive: boolean;
  jobs: JobWithHeld[];
}

const STATUS_OPTIONS = ["all", "queued", "running", "succeeded", "failed", "cancelled"] as const;
const CATEGORY_OPTIONS = ["all", "billing", "general"] as const;

function statusBadge(job: JobWithHeld) {
  if (job.held) {
    return (
      <Badge variant="outline" className="border-amber-400 text-amber-700 bg-amber-50" data-testid={`badge-status-${job.id}`}>
        <PauseCircle className="h-3 w-3 mr-1" /> Held (billing)
      </Badge>
    );
  }
  const variants: Record<string, string> = {
    queued: "bg-blue-50 text-blue-700 border-blue-300",
    running: "bg-purple-50 text-purple-700 border-purple-300",
    succeeded: "bg-green-50 text-green-700 border-green-300",
    failed: "bg-red-50 text-red-700 border-red-300",
    cancelled: "bg-gray-100 text-gray-600 border-gray-300",
  };
  return (
    <Badge variant="outline" className={variants[job.status] || ""} data-testid={`badge-status-${job.id}`}>
      {job.status}
    </Badge>
  );
}

function fmt(d: string | Date | null) {
  if (!d) return "—";
  try {
    return format(new Date(d), "MMM d, HH:mm:ss");
  } catch {
    return String(d);
  }
}

export default function JobControl() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const params = new URLSearchParams();
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (categoryFilter !== "all") params.set("category", categoryFilter);
  const url = `/api/admin/jobs${params.toString() ? `?${params.toString()}` : ""}`;

  const { data, isLoading, refetch, isFetching } = useQuery<JobsResponse>({
    queryKey: ["/api/admin/jobs", statusFilter, categoryFilter],
    queryFn: async () => {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch jobs");
      return response.json();
    },
    refetchInterval: 5000,
  });

  const action = useMutation({
    mutationFn: async ({ id, verb }: { id: number; verb: "retry" | "cancel" | "run-now" }) => {
      return apiRequest("POST", `/api/admin/jobs/${id}/${verb}`);
    },
    onSuccess: (_data, { verb }) => {
      toast({ title: `Job ${verb === "run-now" ? "started" : verb === "retry" ? "requeued" : "cancelled"}` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/jobs"] });
    },
    onError: (error: any, { verb }) => {
      toast({ title: `Could not ${verb} job`, description: error?.message || "Action failed", variant: "destructive" });
    },
  });

  const jobs = data?.jobs ?? [];

  return (
    <div className="p-6 space-y-6" data-testid="page-job-control">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cog className="h-6 w-6" /> Job Control
          </h1>
          <p className="text-muted-foreground">Background job queue — status, output, and controls</p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh">
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {data?.billingHoldActive && (
        <Card className="border-amber-300 bg-amber-50" data-testid="card-billing-hold">
          <CardContent className="py-3 flex items-center gap-2 text-amber-800">
            <PauseCircle className="h-5 w-5 shrink-0" />
            <span>
              Billing jobs are held after server startup and will not run before{" "}
              <strong>{data.billingHoldUntil ? format(new Date(data.billingHoldUntil), "MMM d, HH:mm") : "—"}</strong>.
              Use "Run now" to force one through.
            </span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Jobs</CardTitle>
          <CardDescription className="flex flex-wrap gap-3 items-center pt-1">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40" data-testid="select-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-40" data-testid="select-category-filter">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((c) => (
                  <SelectItem key={c} value={c}>{c === "all" ? "All categories" : c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground py-8 text-center">Loading jobs…</p>
          ) : jobs.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center" data-testid="text-no-jobs">No jobs match the current filters.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Finished</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <>
                    <TableRow
                      key={job.id}
                      className="cursor-pointer"
                      onClick={() => setExpandedId(expandedId === job.id ? null : job.id)}
                      data-testid={`row-job-${job.id}`}
                    >
                      <TableCell>
                        {expandedId === job.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </TableCell>
                      <TableCell className="font-mono">{job.id}</TableCell>
                      <TableCell className="font-medium">{job.type}</TableCell>
                      <TableCell>
                        <Badge variant={job.category === "billing" ? "default" : "secondary"}>{job.category}</Badge>
                      </TableCell>
                      <TableCell>{statusBadge(job)}</TableCell>
                      <TableCell>{job.attempts}/{job.maxAttempts}</TableCell>
                      <TableCell className="text-sm">{fmt(job.scheduledFor)}</TableCell>
                      <TableCell className="text-sm">{fmt(job.startedAt)}</TableCell>
                      <TableCell className="text-sm">{fmt(job.finishedAt)}</TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1 justify-end">
                          {job.status === "queued" && (
                            <Button size="sm" variant="outline" disabled={action.isPending}
                              onClick={() => action.mutate({ id: job.id, verb: "run-now" })}
                              data-testid={`button-run-now-${job.id}`}>
                              <Play className="h-3 w-3 mr-1" /> Run now
                            </Button>
                          )}
                          {(job.status === "queued" || job.status === "running") && (
                            <Button size="sm" variant="outline" disabled={action.isPending}
                              onClick={() => action.mutate({ id: job.id, verb: "cancel" })}
                              data-testid={`button-cancel-${job.id}`}>
                              <XCircle className="h-3 w-3 mr-1" /> Cancel
                            </Button>
                          )}
                          {(job.status === "failed" || job.status === "cancelled" || job.status === "succeeded") && (
                            <Button size="sm" variant="outline" disabled={action.isPending}
                              onClick={() => action.mutate({ id: job.id, verb: "retry" })}
                              data-testid={`button-retry-${job.id}`}>
                              <RotateCcw className="h-3 w-3 mr-1" /> Retry
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {expandedId === job.id && (
                      <TableRow key={`${job.id}-output`} data-testid={`row-output-${job.id}`}>
                        <TableCell colSpan={10} className="bg-muted/40">
                          {job.lastError && (
                            <p className="text-sm text-red-600 mb-2 font-mono" data-testid={`text-last-error-${job.id}`}>
                              Last error: {job.lastError}
                            </p>
                          )}
                          <ScrollArea className="max-h-64 overflow-auto rounded border bg-black/90 p-3">
                            <pre className="text-xs text-green-300 whitespace-pre-wrap font-mono" data-testid={`text-output-${job.id}`}>
                              {job.output || "(no output yet)"}
                            </pre>
                          </ScrollArea>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
