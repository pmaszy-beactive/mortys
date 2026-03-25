import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle, Lock, BookOpen, Car, Info } from "lucide-react";
import { formatDate, formatTime } from "@/lib/utils";
import type { PhaseProgressData, PhaseProgress, PhaseClassProgress } from "@shared/phaseConfig";

interface PhaseProgressTrackerProps {
  phaseData: PhaseProgressData;
  compact?: boolean;
}

function PhaseClassRow({ classItem, compact }: { classItem: PhaseClassProgress; compact?: boolean }) {
  const isTheory = classItem.classType === 'theory';

  return (
    <div
      className={`flex items-start gap-2 py-1.5 px-2 rounded-md transition-colors ${
        classItem.isCompleted
          ? 'bg-green-50/80'
          : 'opacity-50'
      }`}
    >
      <div className="flex-shrink-0 mt-0.5">
        {classItem.isCompleted ? (
          <CheckCircle className="h-4 w-4 text-green-600" />
        ) : (
          <div className="h-4 w-4 rounded-full border-2 border-gray-300" />
        )}
      </div>
      <div className="flex-1 min-w-0">
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
      </div>
    </div>
  );
}

function PhaseCard({ phase, compact }: { phase: PhaseProgress; compact?: boolean }) {
  const borderColor = phase.isCurrent
    ? 'border-[#ECC462] border-2 shadow-lg shadow-[#ECC462]/20'
    : phase.isComplete
    ? 'border-green-300'
    : phase.isLocked
    ? 'border-gray-200 opacity-60'
    : 'border-gray-200';

  return (
    <Card className={`${borderColor} transition-all duration-300 flex-shrink-0 ${compact ? 'w-[260px]' : 'w-[300px]'}`}>
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
        <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
          <div
            className={`h-1.5 rounded-full transition-all duration-500 ${
              phase.isComplete ? 'bg-green-500' : 'bg-[#ECC462]'
            }`}
            style={{ width: `${(phase.completedCount / phase.totalCount) * 100}%` }}
          />
        </div>
      </CardHeader>
      <CardContent className={`${compact ? 'px-3 pb-3' : 'px-4 pb-4'} pt-0`}>
        <div className="space-y-0.5">
          {phase.classes.map((classItem) => (
            <PhaseClassRow key={classItem.id} classItem={classItem} compact={compact} />
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

export default function PhaseProgressTracker({ phaseData, compact }: PhaseProgressTrackerProps) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
      {phaseData.phases.map((phase) => (
        <PhaseCard key={phase.phase} phase={phase} compact={compact} />
      ))}
    </div>
  );
}
