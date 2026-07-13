import { useState } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { CalendarPlus, Loader2, Pencil, Trash2, CalendarDays, UserPlus, X } from "lucide-react";

type CourseStartDate = {
  id: number;
  courseType: string;
  module: number;
  startDate: string;
  startTime?: string | null;
  capacity?: number | null;
  status: string;
  notes?: string | null;
};

const formSchema = z.object({
  courseType: z.string().min(1, "Course type is required"),
  startDate: z.string().min(1, "Start date is required"),
  startTime: z.string().optional(),
  capacity: z.string().optional(),
  status: z.string().default("active"),
  notes: z.string().optional(),
});

const COURSE_LABELS: Record<string, string> = {
  auto: "Automobile (Class 5)",
  moto: "Motorcycle (Class 6)",
  scooter: "Scooter (Class 6D)",
};

type BackfillReport = {
  scanned: number;
  enrolled: { studentId: number; studentName: string; classId: number }[];
  failed: { studentId: number; studentName: string; reason: string }[];
  skipped: { studentId: number; studentName: string; reason: string }[];
};

type EnrollmentReport = {
  action: "none" | "rescheduled" | "cancelled";
  affected: number;
  moved: { studentId: number; studentName: string }[];
  needsAttention: { studentId: number; studentName: string; note?: string }[];
  officeNotified: boolean;
};

const BACKFILL_REPORT_KEY = "start-dates:backfill-report";
const CHANGE_REPORT_KEY = "start-dates:change-report";

function readStoredReport<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStoredReport(key: string, value: unknown | null) {
  try {
    if (value == null) {
      sessionStorage.removeItem(key);
    } else {
      sessionStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    // sessionStorage unavailable — reports just won't survive navigation
  }
}

export default function CourseStartDates() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CourseStartDate | null>(null);
  const [backfillReport, setBackfillReportState] = useState<BackfillReport | null>(() =>
    readStoredReport<BackfillReport>(BACKFILL_REPORT_KEY),
  );
  const [changeReport, setChangeReportState] = useState<EnrollmentReport | null>(() =>
    readStoredReport<EnrollmentReport>(CHANGE_REPORT_KEY),
  );

  const setBackfillReport = (report: BackfillReport | null) => {
    setBackfillReportState(report);
    writeStoredReport(BACKFILL_REPORT_KEY, report);
  };

  const setChangeReport = (report: EnrollmentReport | null) => {
    setChangeReportState(report);
    writeStoredReport(CHANGE_REPORT_KEY, report);
  };

  const { data: dates = [], isLoading } = useQuery<CourseStartDate[]>({
    queryKey: ["/api/admin/course-start-dates"],
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      courseType: "auto",
      startDate: "",
      startTime: "",
      capacity: "",
      status: "active",
      notes: "",
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ courseType: "auto", startDate: "", startTime: "", capacity: "", status: "active", notes: "" });
    setDialogOpen(true);
  };

  const openEdit = (d: CourseStartDate) => {
    setEditing(d);
    form.reset({
      courseType: d.courseType,
      startDate: d.startDate,
      startTime: d.startTime || "",
      capacity: d.capacity != null ? String(d.capacity) : "",
      status: d.status,
      notes: d.notes || "",
    });
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (values: z.infer<typeof formSchema>) => {
      const payload = {
        courseType: values.courseType,
        module: 1,
        startDate: values.startDate,
        startTime: values.startTime || null,
        capacity: values.capacity ? parseInt(values.capacity) : null,
        status: values.status,
        notes: values.notes || null,
      };
      if (editing) {
        try {
          return await apiRequest("PATCH", `/api/admin/course-start-dates/${editing.id}`, payload);
        } catch (e: any) {
          if (e?.status === 409 && e?.data?.conflict === "start_date_merge") {
            const proceed = confirm(
              "Heads up: another active start date for this course type already exists on that day.\n\n" +
                "Saving will merge the two groups into the same Theory 1 class, which may fill up its capacity.\n\n" +
                "Do you want to continue?",
            );
            if (!proceed) {
              const cancelled = new Error("cancelled");
              (cancelled as any).cancelled = true;
              throw cancelled;
            }
            return await apiRequest("PATCH", `/api/admin/course-start-dates/${editing.id}`, {
              ...payload,
              confirmMerge: true,
            });
          }
          throw e;
        }
      }
      try {
        return await apiRequest("POST", "/api/admin/course-start-dates", payload);
      } catch (e: any) {
        if (e?.status === 409 && e?.data?.conflict === "start_date_duplicate") {
          const proceed = confirm(
            "Heads up: an active start date for this course type already exists on that day.\n\n" +
              "Adding another will create two groups that both match the same Theory 1 class.\n\n" +
              "Do you want to add it anyway?",
          );
          if (!proceed) {
            const cancelled = new Error("cancelled");
            (cancelled as any).cancelled = true;
            throw cancelled;
          }
          return await apiRequest("POST", "/api/admin/course-start-dates", {
            ...payload,
            confirmDuplicate: true,
          });
        }
        throw e;
      }
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/course-start-dates"] });
      setDialogOpen(false);
      const report: EnrollmentReport | null | undefined = result?.enrollmentReport;
      if (report && report.action !== "none" && report.affected > 0) {
        setChangeReport(report);
        toast({ title: "Start date updated" });
      } else {
        toast({ title: editing ? "Start date updated" : "Start date added" });
      }
    },
    onError: (e: any) => {
      if (e?.cancelled) return;
      toast({ title: "Something went wrong", description: e.message, variant: "destructive" });
    },
  });

  const backfillMutation = useMutation({
    mutationFn: async (): Promise<BackfillReport> =>
      apiRequest("POST", "/api/admin/backfill-start-date-enrollments"),
    onSuccess: (report) => {
      setBackfillReport(report);
      toast({
        title: "Backfill finished",
        description: `${report.enrolled.length} student(s) enrolled, ${report.failed.length} could not be matched, ${report.skipped.length} skipped.`,
      });
    },
    onError: (e: any) => {
      toast({ title: "Backfill failed", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/admin/course-start-dates/${id}`),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/course-start-dates"] });
      const report: EnrollmentReport | null | undefined = result?.enrollmentReport;
      if (report && report.action !== "none" && report.affected > 0) {
        setChangeReport(report);
      }
      toast({ title: "Start date deleted" });
    },
    onError: (e: any) => {
      toast({ title: "Could not delete", description: e.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#111111] flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-[#ECC462]" />
            Module 1 Start Dates
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            These are the course start dates students can choose from when they register.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => backfillMutation.mutate()}
            disabled={backfillMutation.isPending}
            data-testid="button-backfill-enrollments"
          >
            {backfillMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="mr-2 h-4 w-4" />
            )}
            Backfill Enrollments
          </Button>
          <Button onClick={openCreate} className="bg-[#ECC462] hover:bg-[#d4b058] text-[#111111]" data-testid="button-add-start-date">
            <CalendarPlus className="mr-2 h-4 w-4" /> Add Start Date
          </Button>
        </div>
      </div>

      {backfillReport && (
        <Card data-testid="card-backfill-report">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Backfill Results</CardTitle>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setBackfillReport(null)}
              aria-label="Dismiss backfill results"
              data-testid="button-dismiss-backfill-report"
            >
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-gray-600" data-testid="text-backfill-summary">
              Checked {backfillReport.scanned} student(s) with a selected start date:{" "}
              <span className="font-semibold text-green-700">{backfillReport.enrolled.length} enrolled</span>,{" "}
              <span className="font-semibold text-red-600">{backfillReport.failed.length} could not be matched</span>,{" "}
              <span className="font-semibold text-gray-500">{backfillReport.skipped.length} already had bookings</span>.
            </p>
            {backfillReport.enrolled.length > 0 && (
              <div>
                <p className="font-medium text-green-700 mb-1">Enrolled</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  {backfillReport.enrolled.map((s) => (
                    <li key={s.studentId} data-testid={`text-backfill-enrolled-${s.studentId}`}>
                      <Link
                        href={`/students/${s.studentId}`}
                        className="text-[#111111] underline underline-offset-2 hover:text-[#d4b058]"
                        data-testid={`link-backfill-enrolled-${s.studentId}`}
                      >
                        {s.studentName}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {backfillReport.failed.length > 0 && (
              <div>
                <p className="font-medium text-red-600 mb-1">Needs manual enrollment</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  {backfillReport.failed.map((s) => (
                    <li key={s.studentId} data-testid={`text-backfill-failed-${s.studentId}`}>
                      <Link
                        href={`/students/${s.studentId}`}
                        className="text-[#111111] underline underline-offset-2 hover:text-[#d4b058]"
                        data-testid={`link-backfill-failed-${s.studentId}`}
                      >
                        {s.studentName}
                      </Link>{" "}
                      — {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Scheduled Start Dates</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-[#ECC462]" />
            </div>
          ) : dates.length === 0 ? (
            <p className="text-center text-gray-500 py-8" data-testid="text-no-start-dates">
              No start dates yet. Add one so students can pick it during registration.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Course</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dates.map((d) => (
                  <TableRow key={d.id} data-testid={`row-start-date-${d.id}`}>
                    <TableCell>{COURSE_LABELS[d.courseType] || d.courseType}</TableCell>
                    <TableCell>
                      {new Date(`${d.startDate}T00:00:00`).toLocaleDateString(undefined, {
                        weekday: "short", year: "numeric", month: "short", day: "numeric",
                      })}
                    </TableCell>
                    <TableCell>{d.startTime || "—"}</TableCell>
                    <TableCell>{d.capacity != null ? d.capacity : "—"}</TableCell>
                    <TableCell>
                      <Badge variant={d.status === "active" ? "default" : "secondary"}>
                        {d.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(d)} data-testid={`button-edit-${d.id}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (confirm("Delete this start date?")) deleteMutation.mutate(d.id);
                        }}
                        data-testid={`button-delete-${d.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Start Date" : "Add Start Date"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-4">
              <FormField
                control={form.control}
                name="courseType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Course Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-course-type">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="auto">Automobile (Class 5)</SelectItem>
                        <SelectItem value="moto">Motorcycle (Class 6)</SelectItem>
                        <SelectItem value="scooter">Scooter (Class 6D)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="startDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Date</FormLabel>
                      <FormControl>
                        <Input {...field} type="date" data-testid="input-start-date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="startTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Time (optional)</FormLabel>
                      <FormControl>
                        <Input {...field} type="time" data-testid="input-start-time" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="capacity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Capacity (optional)</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" min="0" placeholder="e.g. 15" data-testid="input-capacity" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-status">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (optional)</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Internal notes" data-testid="input-notes" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="submit"
                  disabled={saveMutation.isPending}
                  className="bg-[#ECC462] hover:bg-[#d4b058] text-[#111111]"
                  data-testid="button-save-start-date"
                >
                  {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editing ? "Save Changes" : "Add Start Date"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!changeReport} onOpenChange={(open) => { if (!open) setChangeReport(null); }}>
        <DialogContent data-testid="dialog-enrollment-report">
          <DialogHeader>
            <DialogTitle>
              {changeReport?.action === "rescheduled" ? "Students Moved" : "Enrolled Students Affected"}
            </DialogTitle>
          </DialogHeader>
          {changeReport && (
            <div className="space-y-3 text-sm">
              <p className="text-gray-600" data-testid="text-enrollment-report-summary">
                {changeReport.action === "rescheduled" ? (
                  <>
                    This change affected {changeReport.affected} enrolled student(s):{" "}
                    <span className="font-semibold text-green-700">{changeReport.moved.length} moved to the new class</span>
                    {changeReport.needsAttention.length > 0 && (
                      <>
                        ,{" "}
                        <span className="font-semibold text-red-600">
                          {changeReport.needsAttention.length} need manual attention
                        </span>
                      </>
                    )}
                    .
                  </>
                ) : (
                  <>
                    This start date had {changeReport.affected} enrolled student(s). They have been notified of the
                    cancellation{changeReport.officeNotified ? " and the office has been alerted to follow up with them" : ""}.
                  </>
                )}
              </p>
              {changeReport.moved.length > 0 && (
                <div>
                  <p className="font-medium text-green-700 mb-1">Moved to the new class</p>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {changeReport.moved.map((s) => (
                      <li key={s.studentId} data-testid={`text-report-moved-${s.studentId}`}>
                        <Link
                          href={`/students/${s.studentId}`}
                          className="text-[#111111] underline underline-offset-2 hover:text-[#d4b058]"
                          data-testid={`link-report-moved-${s.studentId}`}
                        >
                          {s.studentName}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {changeReport.needsAttention.length > 0 && (
                <div>
                  <p className="font-medium text-red-600 mb-1">Needs manual attention</p>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {changeReport.needsAttention.map((s) => (
                      <li key={s.studentId} data-testid={`text-report-attention-${s.studentId}`}>
                        <Link
                          href={`/students/${s.studentId}`}
                          className="text-[#111111] underline underline-offset-2 hover:text-[#d4b058]"
                          data-testid={`link-report-attention-${s.studentId}`}
                        >
                          {s.studentName}
                        </Link>
                        {s.note ? ` — ${s.note}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {changeReport.action === "rescheduled" && changeReport.needsAttention.length > 0 && changeReport.officeNotified && (
                <p className="text-gray-500">The office has been notified about the students needing attention.</p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={() => setChangeReport(null)}
              className="bg-[#ECC462] hover:bg-[#d4b058] text-[#111111]"
              data-testid="button-close-enrollment-report"
            >
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
