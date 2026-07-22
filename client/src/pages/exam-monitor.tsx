import { Fragment, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2, ClipboardCheck, Flag, CheckCircle2, XCircle, Clock, ArrowLeft, Eye, RefreshCcw, History,
} from "lucide-react";

type RecalcChange = {
  attemptId: number;
  studentId: number;
  studentName?: string;
  classId: number | null;
  before: { score: number | null; passed: boolean | null; correctCount: number | null };
  after: { score: number | null; passed: boolean | null; correctCount: number | null };
  studentNotified?: boolean;
};

type RecalcResult = {
  checked: number;
  corrected: number;
  changes: RecalcChange[];
};

type RecalcLog = {
  id: number;
  adminId: string;
  adminEmail: string | null;
  adminName: string | null;
  checkedCount: number;
  correctedCount: number;
  changes: RecalcChange[];
  createdAt: string;
};

type ExamClass = {
  id: number;
  date: string;
  time: string;
  courseType: string;
  instructorId: number | null;
};

type AttemptRow = {
  id: number;
  studentId: number;
  studentName?: string;
  attemptNumber: number;
  status: string;
  testCode: string;
  score: number | null;
  passed: boolean | null;
  answeredCount?: number;
  totalQuestions?: number;
  flaggedCount?: number;
  submittedAt: string | null;
};

type ReviewData = {
  id: number;
  student: { id: number; name: string; email: string } | null;
  attemptNumber: number;
  status: string;
  score: number | null;
  passed: boolean | null;
  questions: {
    questionNumber: number;
    studentAnswer: string | null;
    correctAnswer: string;
    correct: boolean;
    flagged: boolean;
  }[];
};

function statusBadge(a: AttemptRow) {
  if (a.status === "submitted" || a.status === "graded") {
    if (a.passed === true) return <Badge className="bg-green-600">Passed {a.score}%</Badge>;
    if (a.passed === false) return <Badge variant="destructive">Failed {a.score}%</Badge>;
    return <Badge variant="secondary">Submitted</Badge>;
  }
  return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />In progress</Badge>;
}

export default function ExamMonitor() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedClass, setSelectedClass] = useState<ExamClass | null>(null);
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [recalcResult, setRecalcResult] = useState<RecalcResult | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const isAdmin = !!user;

  const { data: recalcLogs = [], isLoading: recalcLogsLoading } = useQuery<RecalcLog[]>({
    queryKey: ["/api/admin/exam-recalc-logs"],
    enabled: isAdmin && !selectedClass,
  });

  const recalcMutation = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/admin/exam-attempts/recalculate")) as RecalcResult,
    onSuccess: (result) => {
      setRecalcResult(result);
      queryClient.invalidateQueries({ queryKey: ["/api/exam/class"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/exam-recalc-logs"] });
    },
    onError: (error: any) => {
      toast({
        title: "Recalculation failed",
        description: error?.message || "Could not recalculate exam scores.",
        variant: "destructive",
      });
    },
  });

  const { data: classes = [], isLoading: classesLoading } = useQuery<ExamClass[]>({
    queryKey: ["/api/exam/classes"],
  });

  const { data: attempts = [], isLoading: attemptsLoading } = useQuery<AttemptRow[]>({
    queryKey: ["/api/exam/class", selectedClass?.id, "attempts"],
    queryFn: () => apiRequest("GET", `/api/exam/class/${selectedClass!.id}/attempts`),
    enabled: !!selectedClass,
    refetchInterval: selectedClass ? 15000 : false,
  });

  const { data: review, isLoading: reviewLoading } = useQuery<ReviewData>({
    queryKey: ["/api/exam/attempt", reviewId, "review"],
    queryFn: () => apiRequest("GET", `/api/exam/attempt/${reviewId}/review`),
    enabled: !!reviewId,
  });

  if (!selectedClass) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-[#111111] flex items-center gap-2">
              <ClipboardCheck className="h-6 w-6 text-[#ECC462]" /> Module 5 Exam Monitor
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Select a Theory 5 class to see who is taking the online exam and their results.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {isAdmin && (
              <Button
                variant="outline"
                onClick={() => recalcMutation.mutate()}
                disabled={recalcMutation.isPending}
                className="flex items-center gap-2"
                data-testid="button-recalculate-scores"
              >
                {recalcMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="h-4 w-4" />
                )}
                Recalculate Exam Scores
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => navigate("/exam-preview")}
              className="flex items-center gap-2"
              data-testid="button-preview-exam"
            >
              <Eye className="h-4 w-4" /> Preview Exam
            </Button>
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Theory 5 Classes</CardTitle>
          </CardHeader>
          <CardContent>
            {classesLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-[#ECC462]" /></div>
            ) : classes.length === 0 ? (
              <p className="text-center text-gray-500 py-8" data-testid="text-no-classes">
                No Theory 5 classes found.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {classes.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedClass(c)}
                    className="text-left p-4 rounded-lg border hover:border-[#ECC462] hover:shadow-sm transition-all"
                    data-testid={`card-class-${c.id}`}
                  >
                    <p className="font-semibold text-[#111111]">
                      {new Date(`${c.date}T00:00:00`).toLocaleDateString(undefined, {
                        weekday: "short", month: "short", day: "numeric",
                      })}
                    </p>
                    <p className="text-sm text-gray-500">{c.time} · {c.courseType}</p>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5 text-[#ECC462]" /> Recalculation History
              </CardTitle>
              <CardDescription>
                Audit trail of past "Recalculate Exam Scores" runs — who ran each one, when, and which attempts changed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {recalcLogsLoading ? (
                <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-[#ECC462]" /></div>
              ) : recalcLogs.length === 0 ? (
                <p className="text-center text-gray-500 py-6 text-sm" data-testid="text-no-recalc-logs">
                  No recalculations have been run yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Run by</TableHead>
                      <TableHead>Checked</TableHead>
                      <TableHead>Corrected</TableHead>
                      <TableHead className="text-right">Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recalcLogs.map((log) => (
                      <Fragment key={log.id}>
                        <TableRow data-testid={`row-recalc-log-${log.id}`}>
                          <TableCell className="whitespace-nowrap" data-testid={`text-recalc-log-when-${log.id}`}>
                            {new Date(log.createdAt).toLocaleString(undefined, {
                              month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
                            })}
                          </TableCell>
                          <TableCell className="font-medium" data-testid={`text-recalc-log-admin-${log.id}`}>
                            {log.adminName || log.adminEmail || `User ${log.adminId}`}
                            {log.adminName && log.adminEmail && (
                              <span className="block text-xs text-gray-500 font-normal">{log.adminEmail}</span>
                            )}
                          </TableCell>
                          <TableCell>{log.checkedCount}</TableCell>
                          <TableCell>
                            {log.correctedCount > 0 ? (
                              <Badge variant="destructive">{log.correctedCount}</Badge>
                            ) : (
                              <span className="text-green-600 flex items-center gap-1 text-sm">
                                <CheckCircle2 className="h-4 w-4" /> 0
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {log.correctedCount > 0 ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
                                data-testid={`button-expand-recalc-log-${log.id}`}
                              >
                                {expandedLogId === log.id ? "Hide" : "View"}
                              </Button>
                            ) : (
                              <span className="text-sm text-gray-400">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                        {expandedLogId === log.id && log.changes.length > 0 && (
                          <TableRow key={`${log.id}-details`}>
                            <TableCell colSpan={5} className="bg-gray-50">
                              <div className="space-y-1 py-1">
                                <p className="text-xs font-medium text-gray-600">Corrected attempts:</p>
                                {log.changes.map((c) => (
                                  <div
                                    key={c.attemptId}
                                    className="text-sm flex flex-wrap items-center gap-2"
                                    data-testid={`row-recalc-log-change-${log.id}-${c.attemptId}`}
                                  >
                                    <span className="font-medium">{c.studentName || `Student #${c.studentId}`}</span>
                                    <span className="text-gray-500">
                                      {c.before.score != null ? `${c.before.score}%` : "—"}
                                      {c.before.passed === true ? " (Pass)" : c.before.passed === false ? " (Fail)" : ""}
                                      {" → "}
                                      {c.after.score != null ? `${c.after.score}%` : "—"}
                                      {c.after.passed === true ? " (Pass)" : c.after.passed === false ? " (Fail)" : ""}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        <Dialog open={!!recalcResult} onOpenChange={(o) => !o && setRecalcResult(null)}>
          <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Exam Score Recalculation</DialogTitle>
            </DialogHeader>
            {recalcResult && (
              <div className="space-y-4">
                <div className="flex gap-6">
                  <div>
                    <p className="text-2xl font-bold" data-testid="text-recalc-checked">{recalcResult.checked}</p>
                    <p className="text-sm text-gray-500">attempts checked</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold" data-testid="text-recalc-corrected">{recalcResult.corrected}</p>
                    <p className="text-sm text-gray-500">scores corrected</p>
                  </div>
                </div>
                {recalcResult.corrected === 0 ? (
                  <p className="text-sm text-green-600 flex items-center gap-2" data-testid="text-recalc-clean">
                    <CheckCircle2 className="h-4 w-4" /> All submitted exam scores are correct — nothing needed fixing.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Corrected attempts:</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Student</TableHead>
                          <TableHead>Before</TableHead>
                          <TableHead>After</TableHead>
                          <TableHead>Notification</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {recalcResult.changes.map((c) => (
                          <TableRow key={c.attemptId} data-testid={`row-recalc-${c.attemptId}`}>
                            <TableCell className="font-medium">
                              {c.studentName || `Student #${c.studentId}`}
                            </TableCell>
                            <TableCell>
                              {c.before.score != null ? `${c.before.score}%` : "—"}{" "}
                              {c.before.passed === true ? (
                                <Badge className="bg-green-600 ml-1">Pass</Badge>
                              ) : c.before.passed === false ? (
                                <Badge variant="destructive" className="ml-1">Fail</Badge>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              {c.after.score != null ? `${c.after.score}%` : "—"}{" "}
                              {c.after.passed === true ? (
                                <Badge className="bg-green-600 ml-1">Pass</Badge>
                              ) : c.after.passed === false ? (
                                <Badge variant="destructive" className="ml-1">Fail</Badge>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              {c.studentNotified === true ? (
                                <Badge className="bg-green-600" data-testid={`badge-notified-${c.attemptId}`}>
                                  <CheckCircle2 className="h-3 w-3 mr-1" /> Student notified
                                </Badge>
                              ) : c.studentNotified === false ? (
                                <Badge variant="destructive" data-testid={`badge-notify-failed-${c.attemptId}`}>
                                  <XCircle className="h-3 w-3 mr-1" /> Notification failed — contact student
                                </Badge>
                              ) : (
                                <span className="text-sm text-gray-500" data-testid={`text-no-notify-${c.attemptId}`}>
                                  Not needed (score-only change)
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setSelectedClass(null)} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div>
          <h1 className="text-xl font-bold text-[#111111]">
            Theory 5 — {new Date(`${selectedClass.date}T00:00:00`).toLocaleDateString(undefined, {
              weekday: "long", month: "long", day: "numeric",
            })} · {selectedClass.time}
          </h1>
          <p className="text-sm text-gray-500">Live exam status (auto-refreshes)</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Student Attempts</CardTitle>
          <CardDescription>Camera monitoring happens in Zoom. This shows exam progress and results.</CardDescription>
        </CardHeader>
        <CardContent>
          {attemptsLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-[#ECC462]" /></div>
          ) : attempts.length === 0 ? (
            <p className="text-center text-gray-500 py-8" data-testid="text-no-attempts">
              No students have started the exam yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Attempt</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attempts.map((a) => (
                  <TableRow key={a.id} data-testid={`row-attempt-${a.id}`}>
                    <TableCell className="font-medium">{a.studentName || `Student #${a.studentId}`}</TableCell>
                    <TableCell>#{a.attemptNumber}</TableCell>
                    <TableCell>
                      {a.answeredCount != null && a.totalQuestions != null
                        ? `${a.answeredCount}/${a.totalQuestions}`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {a.flaggedCount ? (
                        <span className="text-red-500 flex items-center gap-1">
                          <Flag className="h-3 w-3" /> {a.flaggedCount}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell>{statusBadge(a)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setReviewId(a.id)}
                        disabled={a.status === "in_progress"}
                        data-testid={`button-review-${a.id}`}
                      >
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!reviewId} onOpenChange={(o) => !o && setReviewId(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Answer Review</DialogTitle>
          </DialogHeader>
          {reviewLoading || !review ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-[#ECC462]" /></div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{review.student?.name || "Student"}</span>
                <span className="text-sm text-gray-500">
                  Attempt #{review.attemptNumber}
                  {review.score != null && ` · ${review.score}%`}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {review.questions.map((q) => (
                  <div
                    key={q.questionNumber}
                    className="flex items-center justify-between text-sm py-1.5 px-2 rounded border"
                    data-testid={`review-q${q.questionNumber}`}
                  >
                    <span className="flex items-center gap-2">
                      {q.correct ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                      Q{q.questionNumber}
                      {q.flagged && <Flag className="h-3 w-3 text-red-400" />}
                    </span>
                    <span className="text-gray-600">
                      Answered: <strong>{q.studentAnswer || "—"}</strong> · Correct: <strong>{q.correctAnswer}</strong>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
