import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Scissors, Loader2, Users } from "lucide-react";
import type { Class, Instructor } from "@shared/schema";
import { splitVirtualEnrollment } from "@shared/curriculumPlanner";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type SplitClass = Class & { enrolledCount?: number };
type PartInput = { instructorId: string; zoomLink: string };
type EnrolledStudent = {
  enrollmentId: number;
  studentId: number;
  firstName: string;
  lastName: string;
  attendanceStatus: string | null;
};

export default function VirtualClassSplitDialog({
  classData,
  instructors,
  onClose,
}: {
  classData: SplitClass;
  instructors: Instructor[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const distribution = splitVirtualEnrollment(classData.enrolledCount ?? 0);
  const [parts, setParts] = useState<PartInput[]>(() =>
    distribution.studentCounts.map((_, index) => ({
      instructorId: index === 0 && classData.instructorId ? String(classData.instructorId) : "",
      zoomLink: index === 0 ? classData.zoomLink ?? "" : "",
    }))
  );
  const { data: students = [], isLoading: studentsLoading } = useQuery<EnrolledStudent[]>({
    queryKey: ["/api/classes", classData.id, "enrolled-students"],
    queryFn: () => apiRequest("GET", `/api/classes/${classData.id}/enrolled-students`),
    staleTime: 0,
  });

  const studentGroups = useMemo(() => {
    const orderedStudents = [...students].sort((a, b) => a.enrollmentId - b.enrollmentId);
    let cursor = 0;
    return distribution.studentCounts.map(count => {
      const group = orderedStudents.slice(cursor, cursor + count);
      cursor += count;
      return group;
    });
  }, [distribution.studentCounts, students]);
  const instructorIds = parts.map(part => part.instructorId).filter(Boolean);
  const zoomLinks = parts.map(part => part.zoomLink.trim().toLowerCase()).filter(Boolean);
  const hasDuplicateInstructors = new Set(instructorIds).size !== instructorIds.length;
  const hasDuplicateLinks = new Set(zoomLinks).size !== zoomLinks.length;
  const isComplete = parts.every(part => part.instructorId && part.zoomLink.trim());

  const splitMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/classes/${classData.id}/split-virtual`, {
      parts: parts.map(part => ({
        instructorId: Number(part.instructorId),
        zoomLink: part.zoomLink.trim(),
      })),
    }),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/classes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/class-enrollments"] });
      toast({
        title: "Virtual class split",
        description: `Students were divided ${result.distribution.join("/")} across ${result.classes.length} linked classes.`,
      });
      onClose();
    },
    onError: (error: any) => {
      const details = error?.data?.availabilityViolations;
      toast({
        title: "Could not split class",
        description: Array.isArray(details) ? details.join(" ") : error?.data?.message || "Please review the instructor and Zoom assignments.",
        variant: "destructive",
      });
    },
  });

  const updatePart = (index: number, update: Partial<PartInput>) => {
    setParts(current => current.map((part, partIndex) => partIndex === index ? { ...part, ...update } : part));
  };

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="dialog-split-virtual-class">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="h-5 w-5 text-[#ECC462]" />
            Split virtual class
          </DialogTitle>
          <DialogDescription>
            {classData.enrolledCount} students require {distribution.classCount} parallel classes.
            They will be divided evenly as {distribution.studentCounts.join(" / ")}.
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <Users className="h-4 w-4" />
          <AlertTitle>Each class needs its own instructor and Zoom meeting</AlertTitle>
          <AlertDescription>
            The date, time, duration, course, and class number remain the same. Instructor availability is checked again when you confirm.
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          {parts.map((part, index) => (
            <section key={index} className="rounded-lg border border-gray-200 p-4" data-testid={`split-part-${index}`}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">Class {index + 1}</h3>
                <Badge variant="secondary">{distribution.studentCounts[index]} students</Badge>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Instructor</Label>
                  <Select value={part.instructorId} onValueChange={value => updatePart(index, { instructorId: value })}>
                    <SelectTrigger data-testid={`select-split-instructor-${index}`}>
                      <SelectValue placeholder="Choose an available instructor" />
                    </SelectTrigger>
                    <SelectContent>
                      {instructors.filter(instructor => instructor.status === "active").map(instructor => (
                        <SelectItem
                          key={instructor.id}
                          value={String(instructor.id)}
                          disabled={parts.some((other, otherIndex) => otherIndex !== index && other.instructorId === String(instructor.id))}
                        >
                          {instructor.firstName} {instructor.lastName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Zoom link</Label>
                  <Input
                    type="url"
                    placeholder="https://zoom.us/j/..."
                    value={part.zoomLink}
                    onChange={event => updatePart(index, { zoomLink: event.target.value })}
                    data-testid={`input-split-zoom-${index}`}
                  />
                </div>
              </div>
              <div className="mt-3 rounded-md bg-gray-50 p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Students assigned</p>
                {studentsLoading ? (
                  <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading roster…</p>
                ) : (
                  <p className="text-sm text-gray-700">
                    {studentGroups[index]?.map(student => `${student.firstName} ${student.lastName}`).join(", ") || "No students"}
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>

        {(hasDuplicateInstructors || hasDuplicateLinks) && (
          <p className="text-sm text-red-600">
            {hasDuplicateInstructors ? "Choose a different instructor for each class. " : ""}
            {hasDuplicateLinks ? "Enter a different Zoom link for each class." : ""}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={splitMutation.isPending}>Cancel</Button>
          <Button
            onClick={() => splitMutation.mutate()}
            disabled={!isComplete || hasDuplicateInstructors || hasDuplicateLinks || studentsLoading || splitMutation.isPending}
            data-testid="button-confirm-virtual-split"
          >
            {splitMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Split into {distribution.classCount} classes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}