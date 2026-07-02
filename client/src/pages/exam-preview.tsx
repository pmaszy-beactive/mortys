import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  EXAM_TESTS,
  FIRST_ATTEMPT_CODE,
  questionImagePath,
  EXAM_OPTIONS,
} from "@shared/examData";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  ClipboardCheck,
} from "lucide-react";

export default function ExamPreview() {
  const [, navigate] = useLocation();
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [showAnswers, setShowAnswers] = useState(true);

  const def = EXAM_TESTS[FIRST_ATTEMPT_CODE];
  const questions = useMemo(() => {
    const list = [];
    for (let n = 1; n <= def.questionCount; n++) {
      list.push({
        questionNumber: n,
        imagePath: questionImagePath(FIRST_ATTEMPT_CODE, n),
        options: EXAM_OPTIONS,
        correctAnswer: def.answerKey[n],
      });
    }
    return list;
  }, [def]);

  const q = questions[current];
  const selected = answers[q.questionNumber];
  const answeredCount = Object.keys(answers).length;

  const selectAnswer = (opt: string) => {
    setAnswers((prev) => ({ ...prev, [q.questionNumber]: opt }));
  };

  const optionStyle = (opt: string) => {
    if (!selected) {
      return "bg-white border-gray-200 text-gray-700 hover:border-[#ECC462]";
    }
    if (showAnswers) {
      if (opt === q.correctAnswer) return "bg-green-100 border-green-500 text-green-800 font-bold";
      if (opt === selected && selected !== q.correctAnswer)
        return "bg-red-100 border-red-400 text-red-700 line-through";
      return "bg-white border-gray-200 text-gray-400";
    }
    if (opt === selected) return "bg-[#ECC462] border-[#ECC462] text-[#111111]";
    return "bg-white border-gray-200 text-gray-400";
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      {/* Demo banner */}
      <div className="rounded-lg bg-[#ECC462] px-4 py-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-[#111111]" />
          <span className="font-semibold text-[#111111] text-sm">
            DEMO MODE — Module 5 Knowledge Test (First Attempt)
          </span>
          <Badge className="bg-[#111111] text-[#ECC462] text-xs border-0">Admin Preview</Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-[#111111] hover:bg-[#d4b058] h-7 px-2"
          onClick={() => navigate("/exam-monitor")}
          data-testid="button-exit-preview"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Exit
        </Button>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-[#111111]">Module 5 Exam</h1>
          <p className="text-sm text-gray-500">
            {answeredCount}/{questions.length} answered · browsing all {questions.length} questions
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAnswers((v) => !v)}
          data-testid="button-toggle-answers"
        >
          {showAnswers ? (
            <><Eye className="h-3.5 w-3.5 mr-1.5" /> Showing correct answers</>
          ) : (
            <><EyeOff className="h-3.5 w-3.5 mr-1.5" /> Hiding correct answers</>
          )}
        </Button>
      </div>

      <Progress value={(answeredCount / questions.length) * 100} className="h-2" />

      {/* Question navigator */}
      <div className="flex flex-wrap gap-1.5">
        {questions.map((qq, i) => {
          const done = !!answers[qq.questionNumber];
          const isCorrect = done && answers[qq.questionNumber] === qq.correctAnswer;
          return (
            <button
              key={qq.questionNumber}
              onClick={() => setCurrent(i)}
              className={`w-8 h-8 rounded text-xs font-medium border transition-colors ${
                i === current ? "ring-2 ring-[#ECC462]" : ""
              } ${
                done
                  ? showAnswers
                    ? isCorrect
                      ? "bg-green-100 border-green-400 text-green-800"
                      : "bg-red-100 border-red-400 text-red-700"
                    : "bg-[#ECC462] border-[#ECC462] text-[#111111]"
                  : "bg-white text-gray-600 border-gray-300"
              }`}
              data-testid={`button-nav-q${qq.questionNumber}`}
            >
              {qq.questionNumber}
            </button>
          );
        })}
      </div>

      {/* Question card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Question {q.questionNumber}</CardTitle>
          <span className="text-xs text-gray-400">{current + 1} of {questions.length}</span>
        </CardHeader>
        <CardContent className="space-y-4">
          <img
            src={q.imagePath}
            alt={`Question ${q.questionNumber}`}
            className="w-full rounded-lg border bg-gray-50"
            data-testid={`img-question-${q.questionNumber}`}
          />
          <div className="grid grid-cols-2 gap-3">
            {q.options.map((opt) => (
              <button
                key={opt}
                onClick={() => selectAnswer(opt)}
                className={`py-3 rounded-lg border-2 font-semibold transition-colors ${optionStyle(opt)}`}
                data-testid={`button-option-${opt}`}
              >
                {opt}
                {showAnswers && selected && opt === q.correctAnswer && (
                  <span className="ml-1 text-xs font-normal">✓</span>
                )}
              </button>
            ))}
          </div>
          {showAnswers && selected && (
            <p className="text-xs text-center text-gray-500" data-testid="text-answer-hint">
              Correct answer: <strong>{q.correctAnswer}</strong>
              {selected === q.correctAnswer ? " — well done! ✓" : ` — you selected ${selected}`}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setCurrent((c) => Math.max(0, c - 1))}
          disabled={current === 0}
          data-testid="button-prev"
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-gray-400 cursor-default"
          disabled
          data-testid="button-submit-disabled"
        >
          Submit disabled in demo
        </Button>
        <Button
          onClick={() => setCurrent((c) => Math.min(questions.length - 1, c + 1))}
          disabled={current === questions.length - 1}
          className="bg-[#111111] hover:bg-[#2d2d2d] text-white"
          data-testid="button-next"
        >
          Next <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
