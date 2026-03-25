import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { FileText } from "lucide-react";
import type { Student } from "@shared/schema";

interface AddLessonNoteModalProps {
  classData?: {
    id: number;
    studentId: number;
    date: string;
    courseType: string;
  };
  studentId?: number;
  onSuccess?: () => void;
  trigger?: React.ReactNode;
}

export default function AddLessonNoteModal({
  classData,
  studentId: directStudentId,
  onSuccess,
  trigger,
}: AddLessonNoteModalProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState({
    studentId: classData?.studentId || directStudentId || 0,
    classId: classData?.id || null,
    lessonDate: classData?.date || new Date().toISOString().split('T')[0],
    lessonType: classData?.courseType || 'auto',
    duration: 60,
    notes: '',
    instructorFeedback: '',
    status: 'completed',
  });

  const { data: students = [], isLoading: loadingStudents } = useQuery<Student[]>({
    queryKey: ["/api/instructor/students"],
    enabled: open && !directStudentId && !classData?.studentId,
  });

  const createNoteMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return await apiRequest("POST", "/api/instructor/lesson-notes", data);
    },
    onSuccess: () => {
      const noteStudentId = formData.studentId || directStudentId || classData?.studentId;
      toast({
        title: "Lesson Note Created",
        description: "Your lesson note has been saved successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/lesson-notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/dashboard"] });
      if (noteStudentId) {
        queryClient.invalidateQueries({ queryKey: ["/api/students", noteStudentId, "lesson-notes"] });
        queryClient.invalidateQueries({ queryKey: ["/api/students", String(noteStudentId), "lesson-notes"] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/student-notes"] });
      setOpen(false);
      setFormData(prev => ({ ...prev, notes: '', instructorFeedback: '' }));
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create lesson note",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.studentId || !formData.notes) {
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    createNoteMutation.mutate(formData);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button
            size="sm"
            className="bg-[#ECC462] text-[#111111] hover:bg-[#ECC462]/90"
            data-testid="button-add-lesson-note"
          >
            <FileText className="h-4 w-4 mr-1" />
            Add Note
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Lesson Note</DialogTitle>
          <DialogDescription>
            Record internal notes about this lesson for tracking student progress.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!directStudentId && !classData?.studentId && (
            <div>
              <Label htmlFor="student">Student</Label>
              <Select
                value={formData.studentId.toString()}
                onValueChange={(value) =>
                  setFormData({ ...formData, studentId: parseInt(value) })
                }
              >
                <SelectTrigger data-testid="select-student">
                  <SelectValue placeholder={loadingStudents ? "Loading students..." : "Select a student"} />
                </SelectTrigger>
                <SelectContent>
                  {students.map((student) => (
                    <SelectItem key={student.id} value={student.id.toString()}>
                      {student.firstName} {student.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="lessonDate">Lesson Date</Label>
              <Input
                id="lessonDate"
                type="date"
                value={formData.lessonDate}
                onChange={(e) =>
                  setFormData({ ...formData, lessonDate: e.target.value })
                }
                data-testid="input-lesson-date"
                required
              />
            </div>

            <div>
              <Label htmlFor="lessonType">Lesson Type</Label>
              <Select
                value={formData.lessonType}
                onValueChange={(value) =>
                  setFormData({ ...formData, lessonType: value })
                }
              >
                <SelectTrigger data-testid="select-lesson-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">In-Car (Auto)</SelectItem>
                  <SelectItem value="moto">In-Car (Moto)</SelectItem>
                  <SelectItem value="theory">Theory Class</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="duration">Duration (minutes)</Label>
            <Input
              id="duration"
              type="number"
              min="15"
              max="240"
              value={formData.duration}
              onChange={(e) =>
                setFormData({ ...formData, duration: parseInt(e.target.value) })
              }
              data-testid="input-duration"
              required
            />
          </div>

          <div>
            <Label htmlFor="notes">Lesson Notes</Label>
            <Textarea
              id="notes"
              placeholder="Record what was covered in this lesson, student progress, areas of improvement..."
              value={formData.notes}
              onChange={(e) =>
                setFormData({ ...formData, notes: e.target.value })
              }
              rows={6}
              className="resize-none"
              data-testid="input-notes"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              Internal notes - not visible to students
            </p>
          </div>

          <div>
            <Label htmlFor="instructorFeedback">Instructor Feedback (Optional)</Label>
            <Textarea
              id="instructorFeedback"
              placeholder="Additional feedback or observations about the student's performance..."
              value={formData.instructorFeedback}
              onChange={(e) =>
                setFormData({ ...formData, instructorFeedback: e.target.value })
              }
              rows={4}
              className="resize-none"
              data-testid="input-instructor-feedback"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-[#ECC462] text-[#111111] hover:bg-[#ECC462]/90"
              disabled={createNoteMutation.isPending}
              data-testid="button-submit-note"
            >
              {createNoteMutation.isPending ? "Saving..." : "Save Lesson Note"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
