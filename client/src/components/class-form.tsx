import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertClassSchema, type Class, type Instructor } from "@shared/schema";
import { MOTO_SCOOTER_PRACTICAL_MAX_STUDENTS } from "@shared/curriculumPlanner";
import { z } from "zod";
import { Loader2 } from "lucide-react";

const classFormSchema = insertClassSchema.extend({
  date: z.string().min(1, "Date is required"),
  time: z.string().min(1, "Time is required"),
}).omit({ room: true });

type ClassFormData = z.infer<typeof classFormSchema>;

interface ClassFormProps {
  classData?: Class;
  onSuccess: () => void;
}

export default function ClassForm({ classData, onSuccess }: ClassFormProps) {
  const { toast } = useToast();
  const isEditing = !!classData;

  const { data: instructors = [] } = useQuery<Instructor[]>({
    queryKey: ["/api/instructors"],
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

  const createMutation = useMutation({
    mutationFn: (data: ClassFormData) =>
      apiRequest("POST", "/api/classes", { ...data, room: null }),
    onSuccess: () => {
      toast({ title: "Success", description: "Class scheduled successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/classes"] });
      onSuccess();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.data?.error || error?.data?.message || "Failed to schedule class",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: ClassFormData) =>
      apiRequest("PUT", `/api/classes/${classData!.id}`, { ...data, room: null }),
    onSuccess: () => {
      toast({ title: "Success", description: "Class updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/classes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/class-enrollments"] });
      onSuccess();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.data?.message || error?.data?.error || "Failed to update class",
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

  const isLoading = createMutation.isPending || updateMutation.isPending;
  const isVirtual = !!form.watch("zoomLink")?.trim();
  const selectedCourseType = form.watch("courseType");
  const selectedClassType = form.watch("classType");
  const selectedClassNumber = form.watch("classNumber") ?? 1;
  const isMotoPractical = selectedCourseType === "moto" && selectedClassType === "driving";
  const hasPracticalCapacityLimit =
    selectedClassType === "driving" &&
    (selectedCourseType === "moto" || selectedCourseType === "scooter");
  const motoPracticalStage = selectedClassNumber >= 5 ? "road" : "closed-circuit";

  // Moto sessions have contract-defined durations. Keep manual
  // scheduling aligned with the curriculum planner so the class will be
  // bookable after it is created.
  useEffect(() => {
    if (selectedCourseType !== "moto") return;
    const expectedDuration =
      selectedClassType === "theory"
        ? 180
        : selectedClassNumber === 5
          ? 120
          : 240;
    if (form.getValues("duration") !== expectedDuration) {
      form.setValue("duration", expectedDuration);
    }
  }, [form, selectedCourseType, selectedClassType, selectedClassNumber]);

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
                <Select
                  onValueChange={(value) => {
                    field.onChange(value);
                    if (value === "moto" || value === "scooter") {
                      form.setValue("classNumber", 1);
                      form.setValue("duration", value === "moto" && selectedClassType === "driving" ? 240 : 180);
                      if (selectedClassType === "driving") {
                        form.setValue("maxStudents", MOTO_SCOOTER_PRACTICAL_MAX_STUDENTS);
                      }
                    }
                  }}
                  value={field.value}
                >
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
                <Select
                  onValueChange={(value) => {
                    field.onChange(value);
                    if (selectedCourseType === "moto" || selectedCourseType === "scooter") {
                      form.setValue("classNumber", 1);
                      form.setValue("duration", selectedCourseType === "moto" && value === "driving" ? 240 : 180);
                      if (value === "driving") {
                        form.setValue("maxStudents", MOTO_SCOOTER_PRACTICAL_MAX_STUDENTS);
                      }
                    }
                  }}
                  value={field.value || "theory"}
                >
                  <FormControl>
                    <SelectTrigger data-testid="select-class-type">
                      <SelectValue placeholder="Select class type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="theory" data-testid="option-class-type-theory">
                      {selectedCourseType === "moto" ? "Motorcycle Theory / Preparation" : "Theory Class"}
                    </SelectItem>
                    <SelectItem value="driving" data-testid="option-class-type-driving">
                      {selectedCourseType === "moto"
                        ? "Motorcycle Practical Training"
                        : selectedCourseType === "scooter"
                          ? "Scooter Practical"
                          : "Driving Class"}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          {isMotoPractical && (
            <FormItem>
              <FormLabel>Training Stage</FormLabel>
              <Select
                value={motoPracticalStage}
                onValueChange={(value) => {
                  const firstSession = value === "road" ? 5 : 1;
                  form.setValue("classNumber", firstSession);
                  form.setValue("duration", firstSession === 5 ? 120 : 240);
                  form.setValue("maxStudents", MOTO_SCOOTER_PRACTICAL_MAX_STUDENTS);
                }}
              >
                <FormControl>
                  <SelectTrigger data-testid="select-moto-training-stage">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="closed-circuit">Closed-Circuit Training (Sessions 1–4)</SelectItem>
                  <SelectItem value="road">Road Training (Sessions 1–3)</SelectItem>
                </SelectContent>
              </Select>
            </FormItem>
          )}
          <FormField
            control={form.control}
            name="classNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {isMotoPractical
                    ? motoPracticalStage === "road"
                      ? "Road Session"
                      : "Closed-Circuit Session"
                    : "Class Number"}
                </FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={isMotoPractical && motoPracticalStage === "road" ? "5" : "1"}
                    max={isMotoPractical ? (motoPracticalStage === "road" ? "7" : "4") : "15"}
                    {...field}
                    onChange={e => {
                      const nextNumber = parseInt(e.target.value) || 1;
                      field.onChange(nextNumber);
                      if (isMotoPractical) {
                        form.setValue("duration", nextNumber === 5 ? 120 : 240);
                        form.setValue("maxStudents", MOTO_SCOOTER_PRACTICAL_MAX_STUDENTS);
                      }
                    }}
                    data-testid="input-class-number"
                  />
                </FormControl>
                {isMotoPractical && (
                  <p className="text-xs text-muted-foreground">
                    {motoPracticalStage === "road"
                      ? `Class #${selectedClassNumber} is Road Session #${selectedClassNumber - 4} (${selectedClassNumber === 5 ? "2 hours" : "4 hours"}).`
                      : `Class #${selectedClassNumber} is Closed-Circuit Session #${selectedClassNumber} (4 hours).`}
                  </p>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Lesson Type - Only for Driving Classes */}
        {form.watch("classType") === "driving" && (
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
                    disabled={selectedCourseType === "moto"}
                    {...field}
                    onChange={e => field.onChange(parseInt(e.target.value) || 120)}
                    data-testid="input-class-duration"
                  />
                </FormControl>
                {selectedCourseType === "moto" && (
                  <p className="text-xs text-muted-foreground">
                    Set automatically from the official motorcycle program.
                  </p>
                )}
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
                    max={
                      hasPracticalCapacityLimit
                        ? String(MOTO_SCOOTER_PRACTICAL_MAX_STUDENTS)
                        : isVirtual
                          ? "30"
                          : "50"
                    }
                    {...field}
                    onChange={e => field.onChange(
                      parseInt(e.target.value) ||
                      (hasPracticalCapacityLimit ? MOTO_SCOOTER_PRACTICAL_MAX_STUDENTS : 15),
                    )}
                    data-testid="input-max-students"
                  />
                </FormControl>
                {hasPracticalCapacityLimit && (
                  <p className="text-xs text-muted-foreground">
                    Motorcycle and Scooter practical sessions allow up to 5 students per instructor.
                  </p>
                )}
                <FormMessage />
                {isVirtual && <p className="mt-1 text-xs text-muted-foreground">Virtual classes are limited to 30 students.</p>}
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
              <FormLabel>Zoom Link (Optional — makes this a virtual class)</FormLabel>
              <FormControl>
                <Input placeholder="https://zoom.us/j/..." {...field} value={field.value ?? ""} data-testid="input-zoom-link" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

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
                  <FormLabel>Has Test</FormLabel>
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
    </Form>
  );
}
