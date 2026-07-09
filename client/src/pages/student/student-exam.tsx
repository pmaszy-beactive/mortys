import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Lock, Clock, Video, CheckCircle2, XCircle, Flag, ShieldCheck,
  ChevronLeft, ChevronRight, HelpCircle,
} from "lucide-react";

type ExamStatus = {
  hasClass: boolean;
  classId?: number;
  classDate?: string;
  classTime?: string;
  zoomLink?: string | null;
  unlockAt?: string | null;
  resultsVisibleAt?: string | null;
  unlocked?: boolean;
  resultsVisible?: boolean;
  passedAny?: boolean;
  canRetake?: boolean;
  attempt?: {
    id: number;
    attemptNumber: number;
    status: string;
    testCode: string;
    score: number | null;
    passed: boolean | null;
    submittedAt: string | null;
  } | null;
};

type Question = { questionNumber: number; imagePath: string; options: string[] };

type ActiveExam = {
  attemptId: number;
  testCode: string;
  attemptNumber: number;
  answers: Record<string, string>;
  flaggedQuestions: number[];
  resultsVisibleAt: string | null;
  questions: Question[];
};

function useCountdown(target?: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!target) return null;
  const diff = new Date(target).getTime() - now;
  if (diff <= 0) return "now";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${h > 0 ? `${h}h ` : ""}${m}m ${s}s`;
}

export default function StudentExam() {
  const { toast } = useToast();
  const [active, setActive] = useState<ActiveExam | null>(null);
  const [current, setCurrent] = useState(0);
  const [integrityAgreed, setIntegrityAgreed] = useState(false);
  const [integrityName, setIntegrityName] = useState("");
  const [confirmSubmit, setConfirmSubmit] = useState(false);

  const { data: status, isLoading, refetch } = useQuery<ExamStatus>({
    queryKey: ["/api/student/exam/status"],
    refetchInterval: active ? false : 15000,
  });

  const unlockCountdown = useCountdown(status?.unlockAt);
  const resultsCountdown = useCountdown(active?.resultsVisibleAt || status?.resultsVisibleAt);

  const startMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/student/exam/start", { integrityAgreed, integrityName }),
    onSuccess: (data: any) => {
      setActive(data);
      setCurrent(0);
    },
    onError: (e: any) => toast({ title: "Cannot start test", description: e.message, variant: "destructive" }),
  });

  const answerMutation = useMutation({
    mutationFn: async ({ attemptId, questionNumber, option }: { attemptId: number; questionNumber: number; option: string | null }) =>
      apiRequest("PATCH", `/api/student/exam/attempt/${attemptId}/answer`, { questionNumber, option }),
  });

  const submitMutation = useMutation({
    mutationFn: async (attemptId: number) => apiRequest("POST", `/api/student/exam/attempt/${attemptId}/submit`, {}),
    onSuccess: async () => {
      toast({ title: "Test submitted", description: "Your answers have been recorded." });
      setActive(null);
      queryClient.invalidateQueries({ queryKey: ["/api/student/exam/status"] });
      refetch();
    },
    onError: (e: any) => toast({ title: "Could not submit", description: e.message, variant: "destructive" }),
  });

  const flagMutation = useMutation({
    mutationFn: async ({ attemptId, questionNumber }: { attemptId: number; questionNumber: number }) =>
      apiRequest("POST", `/api/student/exam/attempt/${attemptId}/flag`, { questionNumber }),
    onSuccess: (data: any) => {
      setActive((prev) => (prev ? { ...prev, flaggedQuestions: data.flaggedQuestions } : prev));
      toast({ title: "Question flagged", description: "Our exam support team has been notified." });
    },
    onError: (e: any) => toast({ title: "Could not flag question", description: e.message, variant: "destructive" }),
  });

  const answeredCount = useMemo(
    () => (active ? Object.keys(active.answers).filter((k) => active.answers[k]).length : 0),
    [active],
  );

  const selectAnswer = (option: string) => {
    if (!active) return;
    const q = active.questions[current];
    const next = { ...active.answers, [String(q.questionNumber)]: option };
    setActive({ ...active, answers: next });
    answerMutation.mutate({ attemptId: active.attemptId, questionNumber: q.questionNumber, option });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-[#ECC462]" />
      </div>
    );
  }

  // ------- No Module 5 class -------
  if (!status?.hasClass) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-[#ECC462]" /> Module 5 Online Exam
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600" data-testid="text-no-exam">
              You don't have a Module 5 (Theory 5) class scheduled yet. Once you're booked into your Theory 5 class,
              your online exam will appear here.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ------- Active exam in progress -------
  if (active) {
    const q = active.questions[current];
    const selected = active.answers[String(q.questionNumber)];
    const isFlagged = active.flaggedQuestions.includes(q.questionNumber);
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-bold text-[#111111]">Module 5 Exam</h1>
            <p className="text-sm text-gray-500">
              Attempt #{active.attemptNumber} · {answeredCount}/{active.questions.length} answered
            </p>
          </div>
          {resultsCountdown && resultsCountdown !== "now" && (
            <Badge variant="outline" className="text-xs">
              <Clock className="h-3 w-3 mr-1" /> Results in {resultsCountdown}
            </Badge>
          )}
        </div>

        <Progress value={(answeredCount / active.questions.length) * 100} className="h-2" />

        {/* Question navigator */}
        <div className="flex flex-wrap gap-1.5">
          {active.questions.map((qq, i) => {
            const done = !!active.answers[String(qq.questionNumber)];
            const flagged = active.flaggedQuestions.includes(qq.questionNumber);
            return (
              <button
                key={qq.questionNumber}
                onClick={() => setCurrent(i)}
                className={`w-8 h-8 rounded text-xs font-medium border transition-colors ${
                  i === current ? "ring-2 ring-[#ECC462]" : ""
                } ${done ? "bg-[#ECC462] text-[#111111] border-[#ECC462]" : "bg-white text-gray-600 border-gray-300"} ${
                  flagged ? "border-red-400" : ""
                }`}
                data-testid={`button-nav-q${qq.questionNumber}`}
              >
                {qq.questionNumber}
              </button>
            );
          })}
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Question {q.questionNumber}</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className={isFlagged ? "text-red-500" : "text-gray-500"}
              onClick={() => flagMutation.mutate({ attemptId: active.attemptId, questionNumber: q.questionNumber })}
              disabled={flagMutation.isPending || isFlagged}
              data-testid="button-flag"
            >
              <Flag className="h-4 w-4 mr-1" /> {isFlagged ? "Flagged" : "Flag for help"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <img
              src={q.imagePath}
              alt={`Question ${q.questionNumber}`}
              className="w-full rounded-lg border"
              data-testid={`img-question-${q.questionNumber}`}
            />
            <div className="grid grid-cols-2 gap-3">
              {q.options.map((opt) => (
                <button
                  key={opt}
                  onClick={() => selectAnswer(opt)}
                  className={`py-3 rounded-lg border-2 font-semibold transition-colors ${
                    selected === opt
                      ? "bg-[#ECC462] border-[#ECC462] text-[#111111]"
                      : "bg-white border-gray-200 text-gray-700 hover:border-[#ECC462]"
                  }`}
                  data-testid={`button-option-${opt}`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            onClick={() => setCurrent((c) => Math.max(0, c - 1))}
            disabled={current === 0}
            data-testid="button-prev"
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> Previous
          </Button>
          {current < active.questions.length - 1 ? (
            <Button
              onClick={() => setCurrent((c) => Math.min(active.questions.length - 1, c + 1))}
              className="bg-[#111111] hover:bg-[#2d2d2d] text-white"
              data-testid="button-next"
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button
              onClick={() => setConfirmSubmit(true)}
              className="bg-green-600 hover:bg-green-700 text-white"
              data-testid="button-submit"
            >
              Submit Test
            </Button>
          )}
        </div>

        <p className="text-xs text-center text-gray-400 flex items-center justify-center gap-1">
          <HelpCircle className="h-3 w-3" /> Your camera stays on in Zoom for the whole exam. Need help? Flag a question or email info@mortysdrivingschool.com
        </p>

        <AlertDialog open={confirmSubmit} onOpenChange={setConfirmSubmit}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Submit your test?</AlertDialogTitle>
              <AlertDialogDescription>
                You've answered {answeredCount} of {active.questions.length} questions.
                You can still change answers until the end of the second hour of class. Your results
                will be shown at that time.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-submit">Keep working</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => submitMutation.mutate(active.attemptId)}
                className="bg-green-600 hover:bg-green-700"
                data-testid="button-confirm-submit"
              >
                Submit
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // ------- Results visible -------
  if (status.resultsVisible && status.attempt && status.attempt.passed !== null) {
    const passed = status.attempt.passed;
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card>
          <CardHeader className="text-center">
            {passed ? (
              <CheckCircle2 className="h-14 w-14 text-green-500 mx-auto mb-2" />
            ) : (
              <XCircle className="h-14 w-14 text-red-500 mx-auto mb-2" />
            )}
            <CardTitle className="text-2xl" data-testid="text-result-title">
              {passed ? "Congratulations — you passed!" : "You did not pass this time"}
            </CardTitle>
            <CardDescription>Attempt #{status.attempt.attemptNumber}</CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <div className="text-4xl font-bold text-[#111111]" data-testid="text-score">
              {status.attempt.score}%
            </div>
            <p className="text-sm text-gray-500">Passing score is 75%.</p>
            {!passed && status.canRetake && (
              <div className="space-y-3">
                <p className="text-gray-700">
                  You're entitled to one free retake. Review the material and try again when you're ready.
                </p>
                <Button
                  onClick={() => startMutation.mutate()}
                  disabled={startMutation.isPending}
                  className="bg-[#ECC462] hover:bg-[#d4b058] text-[#111111]"
                  data-testid="button-start-retake"
                >
                  {startMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Start Free Retake
                </Button>
              </div>
            )}
            {!passed && !status.canRetake && (
              <p className="text-gray-700">
                Please contact the school at <a className="text-[#ECC462] underline" href="mailto:info@mortysdrivingschool.com">info@mortysdrivingschool.com</a> about next steps.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ------- Submitted, waiting for results -------
  if (status.attempt && status.attempt.status === "submitted" && !status.resultsVisible) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card>
          <CardHeader className="text-center">
            <Clock className="h-14 w-14 text-[#ECC462] mx-auto mb-2" />
            <CardTitle>Test submitted</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-3">
            <p className="text-gray-600">
              Thanks! Your answers are in. Your results will be available at the end of the second hour of your class.
            </p>
            {resultsCountdown && resultsCountdown !== "now" && (
              <Badge variant="outline"><Clock className="h-3 w-3 mr-1" /> Results in {resultsCountdown}</Badge>
            )}
            <div>
              <Button variant="outline" onClick={() => refetch()} data-testid="button-refresh-results">
                Check for results
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ------- Locked / not open yet -------
  if (!status.unlocked) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-gray-400" /> Module 5 Online Exam
            </CardTitle>
            <CardDescription>
              Your class is on{" "}
              {status.classDate
                ? new Date(`${status.classDate}T${status.classTime || "00:00"}:00`).toLocaleDateString(undefined, {
                    weekday: "long", month: "long", day: "numeric",
                  })
                : ""}
              {status.classTime ? ` at ${status.classTime}` : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
              <p className="text-sm text-amber-800">
                The <strong>Begin Test</strong> button unlocks one hour after your class starts.
              </p>
              {unlockCountdown && unlockCountdown !== "now" && (
                <p className="mt-2 font-semibold text-amber-900" data-testid="text-unlock-countdown">
                  Unlocks in {unlockCountdown}
                </p>
              )}
            </div>
            {status.zoomLink && (
              <a href={status.zoomLink} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" className="w-full" data-testid="button-join-zoom">
                  <Video className="h-4 w-4 mr-2" /> Join Zoom Class
                </Button>
              </a>
            )}
            <p className="text-xs text-gray-400 text-center">
              You must be present on Zoom with your camera on for the entire exam.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ------- Unlocked: integrity declaration + begin -------
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#ECC462]" /> Module 5 Online Exam
          </CardTitle>
          <CardDescription>
            {status.canRetake ? "Free retake available" : "First attempt"} · Passing score 75%
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-gray-50 rounded-lg border text-sm text-gray-700 space-y-2">
            <p className="font-semibold text-[#111111]">Integrity Declaration</p>
            <p>
              I declare that I will complete this exam on my own, without help from any other person or
              unauthorized material, and that I will remain visible on my Zoom camera for the entire exam.
              I understand that any breach may invalidate my results.
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-[#111111]">Type your full legal name</label>
            <Input
              value={integrityName}
              onChange={(e) => setIntegrityName(e.target.value)}
              placeholder="First and last name"
              className="mt-1"
              data-testid="input-integrity-name"
            />
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="integrity"
              checked={integrityAgreed}
              onCheckedChange={(c) => setIntegrityAgreed(!!c)}
              data-testid="checkbox-integrity"
            />
            <label htmlFor="integrity" className="text-sm text-gray-700">
              I have read and agree to the integrity declaration above.
            </label>
          </div>
          {status.zoomLink && (
            <a href={status.zoomLink} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="w-full" data-testid="button-join-zoom">
                <Video className="h-4 w-4 mr-2" /> Join Zoom Class
              </Button>
            </a>
          )}
          <Button
            onClick={() => startMutation.mutate()}
            disabled={!integrityAgreed || !integrityName.trim() || startMutation.isPending}
            className="w-full bg-[#ECC462] hover:bg-[#d4b058] text-[#111111]"
            data-testid="button-begin-test"
          >
            {startMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Begin Test
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
