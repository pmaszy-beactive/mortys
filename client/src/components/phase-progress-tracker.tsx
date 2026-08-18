import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle, Lock, BookOpen, Car, Info, Landmark, CalendarPlus } from "lucide-react";
import { formatDate, formatTime } from "@/lib/utils";
import type { PhaseProgressData, PhaseProgress, PhaseClassProgress, ExternalMilestoneProgress } from "@shared/phaseConfig";
import { Button } from "@/components/ui/button";

interface PhaseProgressTrackerProps {
  phaseData: PhaseProgressData;
  compact?: boolean;
  /** When provided, each class row shows a right-aligned Book button. */
  getBookState?: (classItem: PhaseClassProgress, phase: PhaseProgress) => ClassBookState;
  onBookClass?: (classItem: PhaseClassProgress) => void;
}

const DISABLED_LABELS: Record<Exclude<ClassBookState["status"], "available" | "completed">, string> = {
  booked: "Booked",
  locked: "Locked",
  blocked: "Locked",
  none: "None",
};
function PhaseClassRow({
  classItem,
  compact,
  bookState,
  onBookClass,
}: {
  classItem: PhaseClassProgress;
  compact?: boolean;
  bookState?: ClassBookState;
  onBookClass?: (classItem: PhaseClassProgress) => void;
}) {
  const isTheory = classItem.classType === 'theory';

  return (
    <div
      className={`flex items-start gap-2 py-1.5 px-2 rounded-md transition-colors ${
        classItem.isCompleted ? 'bg-green-50/80' : ''
      }`}
      data-testid={`row-phase-class-${classItem.id}`}
    >
      <div className={`flex-shrink-0 mt-0.5 ${classItem.isCompleted ? '' : 'opacity-50'}`}>
        {classItem.isCompleted ? (
          <CheckCircle className="h-4 w-4 text-green-600" />
        ) : (
          <div className="h-4 w-4 rounded-full border-2 border-gray-300" />
        )}
      </div>
      <div className={`flex-1 min-w-0 ${classItem.isCompleted ? '' : 'opacity-70'}`}>
        <div className="flex items-center gap-1.5 flex-wrap">
          {isTheory ? (
            <BookOpen className="h-3 w-3 text-blue-600 flex-shrink-0" />
          ) : (
            <Car className="h-3 w-3 text-amber-600 flex-shrink-0" />
          )}
          <span className={`text-sm font-medium ${classItem.isCompleted ? 'text-gray-900' : 'text-gray-500'}`}>
            {classItem.label}
          </span>
          {classItem.specialNote && (
            <span className="text-xs text-amber-700 font-medium">{classItem.specialNote}</span>
          )}
          {classItem.isCompleted && (
            <Badge className="bg-green-100 text-green-800 border-green-200 text-[10px] px-1.5 py-0 h-4">
              P
            </Badge>
          )}
        </div>
        {classItem.isCompleted && classItem.date && !compact && (
          <div className="text-xs text-gray-500 mt-0.5">
            {isTheory ? (
              <>Date: {formatDate(classItem.date)} {classItem.time && `Time: ${formatTime(classItem.time)}`}</>
            ) : (
              <>Date: {formatDate(classItem.date)} {classItem.instructorName && `with ${classItem.instructorName}`}</>
            )}
          </div>
        )}
        {bookState && bookState.status !== "available" && bookState.status !== "completed" && bookState.reason && (
          <div className="text-[10px] text-gray-400 mt-0.5 leading-tight" data-testid={`text-book-reason-${classItem.id}`}>
            {bookState.reason}
          </div>
        )}
      </div>
      {bookState && bookState.status !== "completed" && (
        <div className="flex-shrink-0 ml-auto">
          {bookState.status === "available" ? (
            <Button
              size="sm"
              className="h-6 px-2 text-xs bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] shadow-none"
              onClick={() => onBookClass?.(classItem)}
              data-testid={`button-book-${classItem.id}`}
            >
              <CalendarPlus className="h-3 w-3 mr-1" />
              Book
            </Button>
          ) : (
            <Button
              size="sm"
              disabled
              title={bookState.reason}
              className="h-6 px-2 text-xs bg-gray-100 text-gray-400 border border-gray-200 shadow-none"
              data-testid={`button-book-${classItem.id}`}
            >
              {bookState.status === "booked" ? (
                "Booked"
              ) : (
                <>
                  <Lock className="h-3 w-3 mr-1" />
                  {DISABLED_LABELS[bookState.status]}
                </>
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function PhaseCard({
  phase,
  compact,
  getBookState,
  onBookClass,
}: {
  phase: PhaseProgress;
  compact?: boolean;
  getBookState?: (classItem: PhaseClassProgress, phase: PhaseProgress) => ClassBookState;
  onBookClass?: (classItem: PhaseClassProgress) => void;
}) {
  const borderColor = phase.isCurrent
    ? 'border-[#ECC462] border-2 shadow-lg shadow-[#ECC462]/20'
    : phase.isComplete
    ? 'border-green-300'
    : phase.isLocked
    ? 'border-gray-200 opacity-60'
    : 'border-gray-200';

  return (
    <Card className={`${borderColor} transition-all duration-300 flex-shrink-0 ${compact ? 'w-[260px]' : 'w-[320px]'}`}>
      <CardHeader className={`pb-2 ${compact ? 'p-3' : 'p-4'}`}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            {phase.isComplete ? (
              <CheckCircle className="h-5 w-5 text-green-600" />
            ) : phase.isLocked ? (
              <Lock className="h-5 w-5 text-gray-400" />
            ) : (
              <div className="h-5 w-5 rounded-full bg-[#ECC462] flex items-center justify-center">
                <span className="text-xs font-bold text-[#111111]">{phase.phase}</span>
              </div>
            )}
            {phase.label}
          </CardTitle>
          {phase.isCurrent && (
            <Badge className="bg-[#ECC462] text-[#111111] text-[10px]">Current</Badge>
          )}
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-gray-500">
            Day count: {phase.dayCount}/{phase.minimumDays}
          </span>
          <span className="text-xs font-medium text-gray-700">
            {phase.completedCount}/{phase.totalCount} completed
          </span>
        </div>
      </CardHeader>
      <CardContent className={`${compact ? 'px-3 pb-3' : 'px-4 pb-4'} pt-0`}>
        <div className="space-y-0.5">
          {phase.classes.map((classItem) => (
            <PhaseClassRow
              key={classItem.id}
              classItem={classItem}
              compact={compact}
              bookState={getBookState ? getBookState(classItem, phase) : undefined}
              onBookClass={onBookClass}
            />
          ))}
        </div>
        {!compact && (
          <div className="mt-3 pt-2 border-t border-gray-100">
            <div className="flex items-start gap-1.5">
              <Info className="h-3 w-3 text-gray-400 mt-0.5 flex-shrink-0" />
              <p className="text-[10px] text-gray-400 leading-tight">{phase.notes}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PhaseProgressTrackerSkeleton() {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex-shrink-0 w-[300px]">
          <Skeleton className="h-[350px] w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}

function ExternalMilestoneRow({ milestone }: { milestone: ExternalMilestoneProgress }) {
  return (
    <div
      className={`flex items-start gap-2 py-1.5 px-2 rounded-md ${milestone.isCompleted ? 'bg-green-50/80' : ''}`}
      data-testid={`milestone-${milestone.id}`}
    >
      <div className="flex-shrink-0 mt-0.5">
        {milestone.isCompleted ? (
          <CheckCircle className="h-4 w-4 text-green-600" />
        ) : (
          <Landmark className="h-4 w-4 text-gray-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-sm font-medium ${milestone.isCompleted ? 'text-gray-900' : 'text-gray-600'}`}>
            {milestone.label}
          </span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-gray-500">SAAQ</Badge>
          {milestone.isCompleted && milestone.date && (
            <span className="text-xs text-green-700">Passed {formatDate(milestone.date)}</span>
          )}
        </div>
        <p className="text-[11px] text-gray-500 leading-tight mt-0.5">{milestone.description}</p>
      </div>
    </div>
  );
}

export default function PhaseProgressTracker({ phaseData, compact, getBookState, onBookClass }: PhaseProgressTrackerProps) {
  const milestones = phaseData.externalMilestones ?? [];
  return (
    <div className="space-y-3">
      <div className="flex gap-4 overflow-x-auto pb-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {phaseData.phases.map((phase) => (
          <PhaseCard
            key={phase.phase}
            phase={phase}
            compact={compact}
            getBookState={getBookState}
            onBookClass={onBookClass}
          />
        ))}
      </div>
      {milestones.length > 0 && (
        <Card className="border-gray-200" data-testid="card-external-milestones">
          <CardHeader className={compact ? 'p-3 pb-1' : 'p-4 pb-2'}>
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Landmark className="h-4 w-4 text-[#ECC462]" />
              SAAQ Steps (outside the school)
            </CardTitle>
          </CardHeader>
          <CardContent className={`${compact ? 'px-3 pb-3' : 'px-4 pb-4'} pt-0`}>
            <div className="grid gap-1 sm:grid-cols-2">
              {milestones.map((m) => (
                <ExternalMilestoneRow key={m.id} milestone={m} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Bookability of a single class row, computed by the parent page. */
export interface ClassBookState {
  status: "available" | "completed" | "booked" | "locked" | "blocked" | "none";
  /** Human-readable reason when the class isn't bookable. */
  reason?: string;
}
