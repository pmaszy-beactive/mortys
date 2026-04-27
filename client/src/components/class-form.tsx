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
    onError: () => {
      toast({ title: "Error", description: "Failed to update class", variant: "destructive" });
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
                    max="15"
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
                    max="50"
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
