import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertClassSchema, type Class, type Instructor, type Student, type ClassEnrollment } from "@shared/schema";
import { z } from "zod";
import { Loader2, Users, AlertTriangle } from "lucide-react";

const classFormSchema = insertClassSchema.extend({
  date: z.string().min(1, "Date is required"),
  time: z.string().min(1, "Time is required"),
}).omit({ room: true });

type ClassFormData = z.infer<typeof classFormSchema>;

interface ClassFormProps {
  classData?: Class;
  onSuccess: () => void;
}

interface PolicyViolationState {
  show: boolean;
  policyType: string;
  message: string;
  studentId: number;
  classId: number;
  canOverride: boolean;
}

export default function ClassForm({ classData, onSuccess }: ClassFormProps) {
  const { toast } = useToast();
  const isEditing = !!classData;
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [policyViolation, setPolicyViolation] = useState<PolicyViolationState | null>(null);
  const [pendingEnrollments, setPendingEnrollments] = useState<Array<{classId: number; studentId: number}>>([]);

  const { data: instructors = [] } = useQuery<Instructor[]>({
    queryKey: ["/api/instructors"],
  });

  const { data: studentsResponse, isLoading: studentsLoading } = useQuery<{students: Student[]}>({
    queryKey: ["/api/students"],
  });

  const students = studentsResponse?.students || [];

  const { data: existingEnrollments = [], isLoading: enrollmentsLoading } = useQuery<ClassEnrollment[]>({
    queryKey: [`/api/class-enrollments/class/${classData?.id}`],
    enabled: isEditing && !!classData?.id,
  });

  const form = useForm<ClassFormData>({
    resolver: zodResolver(classFormSchema),
    defaultValues: {
      courseType: classData?.courseType || "auto",
      classType: classData?.classType || "theory",
      classNumber: classData?.classNumber || 1,
      date: classData?.date || "",
      time: classData?.time || "",
      duration: classData?.duration || 120,
      instructorId: classData?.instructorId || null,
      maxStudents: classData?.maxStudents || 15,
      status: classData?.status || "scheduled",
      lessonType: classData?.lessonType || "regular",
      zoomLink: classData?.zoomLink || "",
      hasTest: classData?.hasTest || false,
    },
  });

  const courseType = form.watch("courseType");

  // Filter students by selected course type
  const filteredStudents = students.filter(student => student.courseType === courseType);

  // Pre-populate selected students when editing
  useEffect(() => {
    if (isEditing && existingEnrollments.length > 0) {
      setSelectedStudentIds(existingEnrollments.map(e => e.studentId!));
    }
  }, [isEditing, existingEnrollments]);

  // Reset selected students when course type changes
  useEffect(() => {
    setSelectedStudentIds([]);
  }, [courseType]);

  // Repopulate form fields when editing and classData changes
  useEffect(() => {
    if (classData) {
      form.reset({
        courseType: classData.courseType,
        classType: classData.classType || "theory",
        classNumber: classData.classNumber,
        date: classData.date,
        time: classData.time,
        duration: classData.duration,
        instructorId: classData.instructorId,
        maxStudents: classData.maxStudents,
        status: classData.status,
        lessonType: classData.lessonType || "regular",
        zoomLink: classData.zoomLink || "",
        hasTest: classData.hasTest,
      });
    }
  }, [classData, form]);

  const createEnrollmentMutation = useMutation({
    mutationFn: ({ classId, studentId, overridePolicy, overrideReason }: { 
      classId: number; 
      studentId: number; 
      overridePolicy?: boolean;
      overrideReason?: string;
    }) =>
      apiRequest("POST", "/api/class-enrollments", {
        classId,
        studentId,
        attendanceStatus: "registered",
        ...(overridePolicy && { overridePolicy, overrideReason }),
      }),
  });

  const handleEnrollmentWithOverride = async (classId: number, studentId: number) => {
    try {
      await createEnrollmentMutation.mutateAsync({ classId, studentId });
      return { success: true };
    } catch (error: any) {
      const errorData = error?.data || error;
      if (errorData?.policyViolation && errorData?.canOverride) {
        setPolicyViolation({
          show: true,
          policyType: errorData.policyViolation,
          message: errorData.message,
          studentId,
          classId,
          canOverride: errorData.canOverride
        });
        setOverrideDialogOpen(true);
        return { success: false, needsOverride: true };
      } else if (errorData?.policyViolation) {
        toast({
          title: "Policy Violation",
          description: errorData.message,
          variant: "destructive",
        });
        return { success: false, needsOverride: false };
      }
      throw error;
    }
  };

  const handleConfirmOverride = async () => {
    if (!policyViolation || !overrideReason.trim()) {
      toast({
        title: "Reason Required",
        description: "Please provide a reason for overriding the booking policy.",
        variant: "destructive",
      });
      return;
    }

    try {
      await createEnrollmentMutation.mutateAsync({
        classId: policyViolation.classId,
        studentId: policyViolation.studentId,
        overridePolicy: true,
        overrideReason: overrideReason.trim()
      });
      
      toast({
        title: "Override Successful",
        description: "Enrollment created with policy override. Notifications have been sent.",
      });

      // Continue with remaining enrollments if any
      if (pendingEnrollments.length > 0) {
        const remaining = [...pendingEnrollments];
        setPendingEnrollments([]);
        await processEnrollments(remaining);
      }

      queryClient.invalidateQueries({ queryKey: ["/api/classes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/class-enrollments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/policy-override-logs"] });
    } catch (error: any) {
      toast({
        title: "Override Failed",
        description: error?.data?.message || "Failed to complete the override.",
        variant: "destructive",
      });
    } finally {
      setOverrideDialogOpen(false);
      setPolicyViolation(null);
      setOverrideReason("");
    }
  };

  const processEnrollments = async (enrollments: Array<{classId: number; studentId: number}>) => {
    for (const enrollment of enrollments) {
      const result = await handleEnrollmentWithOverride(enrollment.classId, enrollment.studentId);
      if (result.needsOverride) {
        setPendingEnrollments(enrollments.filter(e => e.studentId !== enrollment.studentId));
        return false;
      }
    }
    return true;
  };

  const deleteEnrollmentMutation = useMutation({
    mutationFn: (enrollmentId: number) =>
      apiRequest("DELETE", `/api/class-enrollments/${enrollmentId}`),
  });

  const createMutation = useMutation({
    mutationFn: async (data: ClassFormData) => {
      const newClass = await apiRequest("POST", "/api/classes", { ...data, room: null });
      return newClass as Class;
    },
    onSuccess: async (newClass) => {
      // Create enrollments for selected students
      if (selectedStudentIds.length > 0) {
        const enrollments = selectedStudentIds.map(studentId => ({ classId: newClass.id, studentId }));
        const completed = await processEnrollments(enrollments);
        
        if (completed) {
          toast({
            title: "Success",
            description: `Class scheduled with ${selectedStudentIds.length} student(s) enrolled`,
          });
          queryClient.invalidateQueries({ queryKey: ["/api/classes"] });
          queryClient.invalidateQueries({ queryKey: ["/api/class-enrollments"] });
          onSuccess();
        }
        // If not completed, the override dialog is open - wait for user action
      } else {
        toast({
          title: "Success",
          description: "Class scheduled successfully",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/classes"] });
        queryClient.invalidateQueries({ queryKey: ["/api/class-enrollments"] });
        onSuccess();
      }
    },
    onError: (error: any) => {
      console.error("Class creation error:", error);
      toast({
        title: "Error",
        description: error?.data?.error || error?.data?.message || "Failed to schedule class",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: ClassFormData) => apiRequest("PUT", `/api/classes/${classData!.id}`, { ...data, room: null }),
    onSuccess: async () => {
      // Update enrollments: remove old ones not in selectedStudentIds, add new ones
      const existingStudentIds = existingEnrollments.map(e => e.studentId!);
      const toRemove = existingEnrollments.filter(e => !selectedStudentIds.includes(e.studentId!));
      const toAdd = selectedStudentIds.filter(id => !existingStudentIds.includes(id));

      try {
        // Remove enrollments
        await Promise.all(toRemove.map(e => deleteEnrollmentMutation.mutateAsync(e.id)));
        
        // Add new enrollments with policy check
        if (toAdd.length > 0) {
          const enrollments = toAdd.map(studentId => ({ classId: classData!.id, studentId }));
          const completed = await processEnrollments(enrollments);
          
          if (completed) {
            toast({
              title: "Success",
              description: "Class and enrollments updated successfully",
            });
            queryClient.invalidateQueries({ queryKey: ["/api/classes"] });
            queryClient.invalidateQueries({ queryKey: ["/api/class-enrollments"] });
            onSuccess();
          }
          // If not completed, override dialog is open - wait for user action
        } else {
          toast({
            title: "Success",
            description: "Class and enrollments updated successfully",
          });
          queryClient.invalidateQueries({ queryKey: ["/api/classes"] });
          queryClient.invalidateQueries({ queryKey: ["/api/class-enrollments"] });
          onSuccess();
        }
      } catch (error) {
        console.error("Error updating enrollments:", error);
        toast({
          title: "Warning",
          description: "Class updated but some enrollment changes may have failed",
          variant: "destructive",
        });
      }
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update class",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ClassFormData) => {
    if (isEditing) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const toggleStudentSelection = (studentId: number) => {
    setSelectedStudentIds(prev =>
      prev.includes(studentId)
        ? prev.filter(id => id !== studentId)
        : [...prev, studentId]
    );
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="courseType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Course Type</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-course-type">
                      <SelectValue placeholder="Select course type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="auto" data-testid="option-course-type-auto">Auto</SelectItem>
                    <SelectItem value="moto" data-testid="option-course-type-moto">Moto</SelectItem>
                    <SelectItem value="scooter" data-testid="option-course-type-scooter">Scooter</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="classType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Class Type</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-class-type">
                      <SelectValue placeholder="Select class type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="theory" data-testid="option-class-type-theory">Theory Class</SelectItem>
                    <SelectItem value="driving" data-testid="option-class-type-driving">Driving Class</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="classNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Class Number</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min="1"
                    max="5"
                    {...field}
                    onChange={e => field.onChange(parseInt(e.target.value) || 1)}
                    data-testid="input-class-number"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Lesson Type - Regular vs One-Off (Only for Driving Classes) */}
        {form.watch("classNumber") > 5 && (
          <FormField
            control={form.control}
            name="lessonType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Lesson Type</FormLabel>
                <Select onValueChange={field.onChange} value={field.value || "regular"}>
                  <FormControl>
                    <SelectTrigger data-testid="select-lesson-type">
                      <SelectValue placeholder="Select lesson type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="regular" data-testid="option-lesson-type-regular">
                      Regular (Course Registered)
                    </SelectItem>
                    <SelectItem value="one_off" data-testid="option-lesson-type-one-off">
                      One-Off / Refresher
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500 mt-1">
                  {field.value === "one_off" 
                    ? "Extra driving lesson not part of regular course progression" 
                    : "Part of regular driving course curriculum"}
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} data-testid="input-class-date" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="time"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Time</FormLabel>
                <FormControl>
                  <Input type="time" {...field} data-testid="input-class-time" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="duration"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Duration (minutes)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min="60"
                    max="240"
                    step="30"
                    {...field}
                    onChange={e => field.onChange(parseInt(e.target.value) || 120)}
                    data-testid="input-class-duration"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="maxStudents"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Max Students</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min="1"
                    max="20"
                    {...field}
                    onChange={e => field.onChange(parseInt(e.target.value) || 15)}
                    data-testid="input-max-students"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="instructorId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Instructor</FormLabel>
              <Select
                onValueChange={(value) => field.onChange(value === "none" ? null : parseInt(value))}
                defaultValue={field.value?.toString() || "none"}
              >
                <FormControl>
                  <SelectTrigger data-testid="select-instructor">
                    <SelectValue placeholder="Select instructor" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none" data-testid="option-instructor-none">No Instructor</SelectItem>
                  {instructors.map((instructor) => (
                    <SelectItem
                      key={instructor.id}
                      value={instructor.id.toString()}
                      data-testid={`option-instructor-${instructor.id}`}
                    >
                      {instructor.firstName} {instructor.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="zoomLink"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Zoom Link (Optional)</FormLabel>
              <FormControl>
                <Input placeholder="https://zoom.us/j/..." {...field} data-testid="input-zoom-link" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Student Selection Section with Golden-Yellow Branding */}
        <div className="rounded-lg border-2 border-[#ECC462] bg-[#ECC462]/5 p-6 space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-5 w-5 text-[#ECC462]" />
            <h3 className="text-lg font-semibold text-[#ECC462]">Enroll Students</h3>
            <span className="ml-auto text-sm text-muted-foreground" data-testid="text-selected-count">
              {selectedStudentIds.length} selected
            </span>
          </div>

          {studentsLoading || enrollmentsLoading ? (
            <div className="flex items-center justify-center py-8" data-testid="loading-students">
              <Loader2 className="h-6 w-6 animate-spin text-[#ECC462]" />
              <span className="ml-2 text-muted-foreground">Loading students...</span>
            </div>
          ) : filteredStudents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-students">
              No {courseType} students available
            </div>
          ) : (
            <ScrollArea className="h-[300px] rounded-md border p-4" data-testid="scroll-student-list">
              <div className="space-y-3">
                {filteredStudents.map((student) => (
                  <div
                    key={student.id}
                    className="flex items-start space-x-3 rounded-lg border p-3 hover:bg-accent transition-colors"
                    data-testid={`student-item-${student.id}`}
                  >
                    <Checkbox
                      checked={selectedStudentIds.includes(student.id)}
                      onCheckedChange={() => toggleStudentSelection(student.id)}
                      data-testid={`checkbox-student-${student.id}`}
                      className="mt-1"
                    />
                    <div className="flex-1 space-y-1">
                      <div className="font-medium" data-testid={`text-student-name-${student.id}`}>
                        {student.firstName} {student.lastName}
                      </div>
                      <div className="text-sm text-muted-foreground space-y-0.5">
                        <div data-testid={`text-student-email-${student.id}`}>{student.email}</div>
                        <div className="flex gap-4">
                          <span data-testid={`text-student-id-${student.id}`}>ID: {student.id}</span>
                          {student.phone && (
                            <span data-testid={`text-student-phone-${student.id}`}>{student.phone}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="text-[#ECC462]">●</span>
            <p>Students shown match the selected course type ({courseType})</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-status">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="scheduled" data-testid="option-status-scheduled">Scheduled</SelectItem>
                    <SelectItem value="completed" data-testid="option-status-completed">Completed</SelectItem>
                    <SelectItem value="cancelled" data-testid="option-status-cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="hasTest"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    data-testid="checkbox-has-test"
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel>
                    Has Test
                  </FormLabel>
                  <p className="text-sm text-muted-foreground">
                    This class includes an online test (typically class #5)
                  </p>
                </div>
              </FormItem>
            )}
          />
        </div>

        <div className="flex gap-4 pt-4">
          <Button
            type="submit"
            disabled={isLoading}
            data-testid="button-submit-class"
            className="bg-[#ECC462] hover:bg-[#ECC462]/90 text-black"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : isEditing ? (
              "Update Class"
            ) : (
              "Schedule Class"
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onSuccess}
            disabled={isLoading}
            data-testid="button-cancel-class"
          >
            Cancel
          </Button>
        </div>
      </form>

      <Dialog open={overrideDialogOpen} onOpenChange={setOverrideDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#ECC462]">
              <AlertTriangle className="h-5 w-5" />
              Policy Override Required
            </DialogTitle>
            <DialogDescription className="text-left">
              {policyViolation?.message}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
              <p className="text-sm text-amber-800">
                <strong>Important:</strong> This override will be logged for audit purposes.
                Email notifications will be sent to administrators and the affected student.
              </p>
            </div>
            
            <div className="space-y-2">
              <label htmlFor="override-reason" className="text-sm font-medium">
                Reason for Override <span className="text-red-500">*</span>
              </label>
              <Textarea
                id="override-reason"
                placeholder="Enter a detailed reason for overriding this booking policy..."
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                className="min-h-[100px]"
                data-testid="textarea-override-reason"
              />
              <p className="text-xs text-muted-foreground">
                This reason will be included in the audit log and notification emails.
              </p>
            </div>
          </div>
          
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOverrideDialogOpen(false);
                setPolicyViolation(null);
                setOverrideReason("");
                setPendingEnrollments([]);
              }}
              data-testid="button-cancel-override"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleConfirmOverride}
              disabled={!overrideReason.trim() || createEnrollmentMutation.isPending}
              className="bg-[#ECC462] hover:bg-[#ECC462]/90 text-black"
              data-testid="button-confirm-override"
            >
              {createEnrollmentMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                "Confirm Override"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Form>
  );
}
