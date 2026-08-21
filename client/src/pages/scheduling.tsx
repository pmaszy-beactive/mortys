import { useState, DragEvent, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { getCourseClassCounts } from "@shared/bookingRules";
import { Plus, Calendar, ChevronLeft, ChevronRight, Car, Bike, Users, Edit, Eye, X, Sparkles, CalendarClock, BookOpen, MapPin, AlertTriangle, Clock, GripVertical, Wand2, Loader2, Scissors, Link2 } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import ClassForm from "@/components/class-form";
import SeriesManager from "@/components/series-manager";
import VirtualClassSplitDialog from "@/components/virtual-class-split-dialog";
import { Repeat } from "lucide-react";
import type { Class, Instructor } from "@shared/schema";
import { startOfWeek, endOfWeek, parse, format, addDays } from "date-fns";

function getSchedulingClassLabel(
  cls: Pick<Class, "courseType" | "classType" | "classNumber">,
): string {
  const courseType = (cls.courseType || "").toLowerCase();
  const classType = cls.classType || "theory";
  const classNumber = cls.classNumber ?? 0;

  if (courseType === "moto") {
    if (classType === "theory") {
      return classNumber === 1
        ? "Moto Yard Preparation (Theory #1)"
        : classNumber === 2
          ? "Moto Road Preparation (Theory #2)"
          : `Moto Theory #${classNumber}`;
    }
    if (classNumber >= 1 && classNumber <= 4) {
      return `Moto Closed-Circuit Session #${classNumber}`;
    }
    if (classNumber >= 5 && classNumber <= 7) {
      return `Moto Road Session #${classNumber - 4}`;
    }
  }

  const courseLabel = courseType.charAt(0).toUpperCase() + courseType.slice(1);
  const sessionLabel =
    classType === "theory"
      ? "Theory"
      : courseType === "auto"
        ? "In-Car"
        : "Riding";
  return `${courseLabel} ${sessionLabel} #${classNumber}`;
}

export default function Scheduling() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<(Class & { enrolledCount?: number; historicalEnrollmentCount?: number }) | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [vehicleFilters, setVehicleFilters] = useState({
    auto: true,
    moto: true,
    scooter: true,
  });
  const [classTypeFilters, setClassTypeFilters] = useState({
    theory: true,
    driving: true,
  });
  const [draggedClass, setDraggedClass] = useState<Class | null>(null);
  const [expandedDay, setExpandedDay] = useState<Date | null>(null);
  const [dragOverDate, setDragOverDate] = useState<Date | null>(null);
  const [seriesAction, setSeriesAction] = useState<{ mode: "edit" | "delete" | "days"; anchorClass: Class } | null>(null);
  const [splitClass, setSplitClass] = useState<(Class & { enrolledCount?: number }) | null>(null);
  const { toast } = useToast();

  // Enrolled students for the class being edited
  interface EnrolledStudentRow {
    enrollmentId: number;
    studentId: number;
    firstName: string;
    lastName: string;
    attendanceStatus: string | null;
  }
  const { data: enrolledStudents = [], isLoading: enrolledStudentsLoading } = useQuery<EnrolledStudentRow[]>({
    queryKey: ["/api/classes", editingClass?.id, "enrolled-students"],
    queryFn: () => apiRequest("GET", `/api/classes/${editingClass!.id}/enrolled-students`),
    enabled: !!editingClass,
    // Enrollments change outside this screen (bookings, cancellations,
    // attendance) — always fetch a fresh roster when the dialog opens.
    staleTime: 0,
    refetchOnMount: "always",
  });

  // Generate Schedule dialog state
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const oneYearLater = format(addDays(new Date(), 365), 'yyyy-MM-dd');
  const [genForm, setGenForm] = useState({
    courseType: 'auto',
    classType: 'theory',
    classNumber: '1',
    daysOfWeek: [] as number[], // 0=Sun, 1=Mon, ...6=Sat
    time: '09:00',
    duration: 120,
    instructorId: '',
    maxStudents: 15,
    lessonType: 'regular',
    startDate: todayStr,
    endDate: oneYearLater,
    hasTest: false,
    zoomLink: '',
    progressive: false,
    fullCurriculum: false,
    motoTrainingStage: 'closed-circuit' as 'closed-circuit' | 'road',
  });

  // Reschedule class mutation
  const rescheduleClassMutation = useMutation({
    mutationFn: async ({ classId, newDate }: { classId: number; newDate: string }) => {
      return apiRequest('PUT', `/api/classes/${classId}`, { date: newDate });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/classes"] });
      toast({
        title: "Class Rescheduled",
        description: "The class has been moved to the new date.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err?.data?.message || "Failed to reschedule class.",
        variant: "destructive",
      });
    },
  });

  // Delete class mutation
  const deleteClassMutation = useMutation({
    mutationFn: async (classId: number) => {
      return apiRequest('DELETE', `/api/classes/${classId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/classes"] });
      toast({
        title: "Class Deleted",
        description: "The class has been removed from the schedule.",
        className: "bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111] border-0",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err?.data?.message || "Failed to delete this class. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Bulk schedule generation mutation
  const generateScheduleMutation = useMutation({
    mutationFn: async (payload: typeof genForm) => {
      return apiRequest('POST', '/api/admin/classes/bulk', {
        ...payload,
        instructorId: payload.instructorId && payload.instructorId !== 'none' ? parseInt(payload.instructorId) : null,
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/classes"] });
      setIsGenerateOpen(false);
      toast({
        title: `Schedule Generated!`,
        description: `Created ${data.created} classes successfully.`,
        className: "bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111] border-0",
      });
    },
    onError: (err: any) => {
      const violations = err?.data?.availabilityViolations;
      const msg = violations?.length
        ? `${err.data.message} ${violations.slice(0, 3).join("; ")}${violations.length > 3 ? "…" : ""}`
        : err?.data?.message || err?.message || "Failed to generate schedule.";
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  // Class number must be a whole number >= 1 (digit-only string; no
  // decimals/suffixes — matches the server's strict validation).
  const classNumberValid = /^\d+$/.test(genForm.classNumber.trim()) && parseInt(genForm.classNumber, 10) >= 1;
  const classNumberInt = classNumberValid ? parseInt(genForm.classNumber, 10) : 1;
  const isMotoPracticalSeries =
    genForm.courseType === "moto" &&
    genForm.classType === "driving" &&
    !genForm.fullCurriculum;
  const motoPracticalStage = genForm.motoTrainingStage;

  const selectMotoPracticalStage = (stage: "closed-circuit" | "road") => {
    const firstClassNumber = stage === "road" ? 5 : 1;
    setGenForm((previous) => ({
      ...previous,
      classType: "driving",
      classNumber: String(firstClassNumber),
      duration: firstClassNumber === 5 ? 120 : 240,
      maxStudents: 1,
      progressive: false,
      motoTrainingStage: stage,
    }));
  };

  // Preview: count how many dates will be created
  const previewCount = useMemo(() => {
    if (genForm.fullCurriculum) return genForm.daysOfWeek.length > 0 && genForm.startDate ? (genForm.courseType === 'moto' ? 9 : 27) : 0;
    if (!classNumberValid) return 0;
    if (!genForm.startDate || !genForm.endDate || genForm.daysOfWeek.length === 0) return 0;
    const start = new Date(genForm.startDate + "T00:00:00");
    const end = new Date(genForm.endDate + "T00:00:00");
    if (end < start) return 0;
    let count = 0;
    const cur = new Date(start);
    while (cur <= end) {
      if (genForm.daysOfWeek.includes(cur.getDay())) count++;
      cur.setDate(cur.getDate() + 1);
    }
    if (genForm.progressive) {
      const counts = getCourseClassCounts(genForm.courseType);
      const maxNumber =
        genForm.courseType === "moto" && genForm.classType === "driving"
          ? genForm.motoTrainingStage === "closed-circuit" ? 4 : 7
          : genForm.classType === 'driving' ? counts.drivingCount : counts.theoryCount;
      count = Math.max(0, Math.min(count, maxNumber - classNumberInt + 1));
    }
    return count;
  }, [genForm.startDate, genForm.endDate, genForm.daysOfWeek, genForm.progressive, genForm.fullCurriculum, genForm.courseType, genForm.classType, genForm.motoTrainingStage, classNumberValid, classNumberInt]);

  const toggleGenDay = (day: number) => {
    setGenForm(prev => ({
      ...prev,
      daysOfWeek: prev.daysOfWeek.includes(day)
        ? prev.daysOfWeek.filter(d => d !== day)
        : [...prev.daysOfWeek, day],
    }));
  };

  // Drag and drop handlers
  const handleDragStart = (e: DragEvent<HTMLDivElement>, cls: Class) => {
    setDraggedClass(cls);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', cls.id.toString());
  };

  const handleDragEnd = () => {
    setDraggedClass(null);
    setDragOverDate(null);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>, date: Date) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDate(date);
  };

  const handleDragLeave = () => {
    setDragOverDate(null);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, date: Date) => {
    e.preventDefault();
    if (draggedClass) {
      const newDate = format(date, 'yyyy-MM-dd');
      if (newDate !== draggedClass.date) {
        rescheduleClassMutation.mutate({ classId: draggedClass.id, newDate });
      }
    }
    setDraggedClass(null);
    setDragOverDate(null);
  };

  // Generate calendar days for the current month
  const generateCalendarDays = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    
    // First day of the month and last day of the month
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    // First day of the week (Monday = 1, Tuesday = 2, etc. Sunday = 0)
    const startingDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    
    // Previous month's last few days to fill the beginning (Monday-based week)
    const prevMonth = new Date(year, month - 1, 0);
    const daysInPrevMonth = prevMonth.getDate();
    
    const calendarDays = [];
    
    // Calculate days to add from previous month (Monday-start week)
    const daysFromPrevMonth = startingDayOfWeek === 0 ? 6 : startingDayOfWeek - 1;
    
    // Add previous month's trailing days
    for (let i = daysFromPrevMonth - 1; i >= 0; i--) {
      calendarDays.push({
        day: daysInPrevMonth - i,
        isCurrentMonth: false,
        isPrevMonth: true,
        date: new Date(year, month - 1, daysInPrevMonth - i)
      });
    }
    
    // Add current month's days
    for (let day = 1; day <= daysInMonth; day++) {
      calendarDays.push({
        day,
        isCurrentMonth: true,
        isPrevMonth: false,
        date: new Date(year, month, day)
      });
    }
    
    // Add next month's leading days to complete the grid (42 days = 6 weeks)
    const remainingDays = 42 - calendarDays.length;
    for (let day = 1; day <= remainingDays; day++) {
      calendarDays.push({
        day,
        isCurrentMonth: false,
        isPrevMonth: false,
        date: new Date(year, month + 1, day)
      });
    }
    
    return calendarDays;
  };

  const calendarDays = generateCalendarDays(currentMonth);

  const { data: classes = [], isLoading: classesLoading } = useQuery<(Class & { enrolledCount?: number; historicalEnrollmentCount?: number })[]>({
    queryKey: ["/api/classes"],
  });

  const { data: instructors = [] } = useQuery<Instructor[]>({
    queryKey: ["/api/instructors"],
  });

  const getInstructorName = (instructorId: number | null) => {
    if (!instructorId) return "Unassigned";
    const instructor = instructors.find(i => i.id === instructorId);
    return instructor ? `${instructor.firstName} ${instructor.lastName}` : "Unknown Instructor";
  };

  // ─── In-Car #12/13 Pairing Queue (Task 272) ──────────────────────────────
  interface PairingQueueEntry {
    id: number;
    studentId: number;
    sessionNumber: number;
    status: string;
    priority: number;
    queuedAt: string;
    bookedClassId: number | null;
    enrollmentId: number | null;
    updatedAt: string;
    studentName: string | null;
    classDate: string | null;
    classTime: string | null;
  }
  interface PairedSession {
    id: number;
    queueEntryIdA: number;
    queueEntryIdB: number;
    studentIdA: number;
    studentIdB: number;
    classId: number;
    enrollmentIdA: number | null;
    enrollmentIdB: number | null;
    status: string;
    pairedAt: string;
    studentNameA: string | null;
    studentNameB: string | null;
    classDate: string | null;
    classTime: string | null;
  }
  interface SessionConfirmation {
    id: number;
    pairedSessionId: number;
    studentId: number;
    queueEntryId: number;
    status: string;
  }
  interface PairingOverview {
    waiting: PairingQueueEntry[];
    bookedFirst: PairingQueueEntry[];
    offered: PairingQueueEntry[];
    paired: PairingQueueEntry[];
    activeSessions: PairedSession[];
    pendingConfirmations: SessionConfirmation[];
    stats: { waiting: number; bookedFirst: number; offered: number; activeSessionsTotal: number };
  }

  const { data: pairingOverview, isLoading: pairingLoading } = useQuery<PairingOverview>({
    queryKey: ["/api/lesson-pairing/admin"],
  });

  // Student names and class date/time now arrive inline on the overview
  // payload — build lookup maps from it instead of per-id fetches.
  const pairingNameById = useMemo(() => {
    const map = new Map<number, string>();
    if (!pairingOverview) return map;
    for (const e of [...pairingOverview.waiting, ...pairingOverview.bookedFirst, ...pairingOverview.offered, ...pairingOverview.paired]) {
      if (e.studentName) map.set(e.studentId, e.studentName);
    }
    for (const s of pairingOverview.activeSessions) {
      if (s.studentNameA) map.set(s.studentIdA, s.studentNameA);
      if (s.studentNameB) map.set(s.studentIdB, s.studentNameB);
    }
    return map;
  }, [pairingOverview]);

  const pairingClassTimeById = useMemo(() => {
    const map = new Map<number, { date: string | null; time: string | null }>();
    if (!pairingOverview) return map;
    for (const e of [...pairingOverview.bookedFirst, ...pairingOverview.offered, ...pairingOverview.paired]) {
      if (e.bookedClassId != null && (e.classDate || e.classTime)) {
        map.set(e.bookedClassId, { date: e.classDate, time: e.classTime });
      }
    }
    for (const s of pairingOverview.activeSessions) {
      if (s.classDate || s.classTime) {
        map.set(s.classId, { date: s.classDate, time: s.classTime });
      }
    }
    return map;
  }, [pairingOverview]);

  const pairingStudentName = (studentId: number) => {
    return pairingNameById.get(studentId) ?? `Student #${studentId}`;
  };

  const pairingClassLabel = (classId: number | null) => {
    if (!classId) return "—";
    const cls = pairingClassTimeById.get(classId);
    if (!cls) return `Class #${classId}`;
    return `${cls.date ?? "TBD"}${cls.time ? ` @ ${cls.time}` : ""}`;
  };

  // Canonical combined 12/13 slots that currently have a booked-first owner
  // awaiting a partner. Only these may be offered in the Manual Pair dialog.
  const manualPairSlots = useMemo(() => {
    if (!pairingOverview) return [] as { classId: number; bookedFirstStudentId: number }[];
    const slots: { classId: number; bookedFirstStudentId: number }[] = [];
    for (const entry of pairingOverview.bookedFirst) {
      if (entry.bookedClassId == null) continue;
      const cls = classes.find((c) => c.id === entry.bookedClassId);
      if (!cls) continue;
      const isCanonical =
        cls.classType === "driving" &&
        cls.classNumber === 12 &&
        cls.duration === 120 &&
        cls.maxStudents === 2 &&
        cls.status === "scheduled";
      if (!isCanonical) continue;
      slots.push({ classId: entry.bookedClassId, bookedFirstStudentId: entry.studentId });
    }
    return slots;
  }, [pairingOverview, classes]);

  // Confirmation status per paired session (both students).
  const sessionConfirmStatus = (session: PairedSession) => {
    if (!pairingOverview) return { pending: 0, students: [] as { studentId: number; status: string }[] };
    const rows = pairingOverview.pendingConfirmations.filter((c) => c.pairedSessionId === session.id);
    return { pending: rows.length, students: rows.map((r) => ({ studentId: r.studentId, status: r.status })) };
  };

  // Pairing history dialog state (Task 276)
  interface PairingAuditEvent {
    id: number;
    eventType: string;
    queueEntryId: number | null;
    pairedSessionId: number | null;
    offerId: number | null;
    confirmationId: number | null;
    studentId: number | null;
    studentName: string | null;
    classId: number | null;
    actorId: string | null;
    actorRole: string | null;
    previousStatus: string | null;
    newStatus: string | null;
    details: Record<string, unknown> | null;
    createdAt: string;
  }
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyStudentId, setHistoryStudentId] = useState<string>("");
  const [historyClassId, setHistoryClassId] = useState<string>("");

  const historyParams = new URLSearchParams();
  if (historyStudentId.trim() !== "" && Number.isInteger(Number(historyStudentId)) && Number(historyStudentId) > 0) {
    historyParams.set("studentId", historyStudentId.trim());
  }
  if (historyClassId !== "" && historyClassId !== "all") {
    historyParams.set("classId", historyClassId);
  }
  const historyQueryString = historyParams.toString();

  const { data: pairingHistory, isLoading: historyLoading } = useQuery<{ events: PairingAuditEvent[] }>({
    queryKey: ["/api/lesson-pairing/admin/history", historyQueryString],
    queryFn: async () =>
      apiRequest("GET", `/api/lesson-pairing/admin/history${historyQueryString ? `?${historyQueryString}` : ""}`),
    enabled: historyOpen,
  });

  const formatEventType = (t: string) => t.replace(/_/g, " ");
  const historyReason = (e: PairingAuditEvent): string | null => {
    const r = e.details?.reason;
    return typeof r === "string" && r.length > 0 ? r : null;
  };

  // Manual pair dialog state
  const [manualPairEntry, setManualPairEntry] = useState<PairingQueueEntry | null>(null);
  const [manualPairClassId, setManualPairClassId] = useState<string>("");

  // Convert-to-solo dialog state
  const [convertSession, setConvertSession] = useState<PairedSession | null>(null);
  const [convertEnrollmentId, setConvertEnrollmentId] = useState<string>("");
  const [convertLessonNumber, setConvertLessonNumber] = useState<string>("11");

  const invalidatePairing = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/lesson-pairing/admin"] });
  };

  const manualPairMutation = useMutation({
    mutationFn: async ({ classId, waitingStudentId }: { classId: number; waitingStudentId: number }) =>
      apiRequest("POST", "/api/lesson-pairing/admin/manual-pair", { classId, waitingStudentId }),
    onSuccess: () => {
      invalidatePairing();
      setManualPairEntry(null);
      setManualPairClassId("");
      toast({ title: "Students Paired", description: "The waiting student was paired into the selected class." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.data?.message || err?.message || "Failed to pair students.", variant: "destructive" });
    },
  });

  const requeueMutation = useMutation({
    mutationFn: async (queueEntryId: number) =>
      apiRequest("POST", "/api/lesson-pairing/admin/requeue", { queueEntryId }),
    onSuccess: () => {
      invalidatePairing();
      toast({ title: "Requeued", description: "The student was returned to the waiting queue." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.data?.message || err?.message || "Failed to requeue student.", variant: "destructive" });
    },
  });

  const convertMutation = useMutation({
    mutationFn: async ({ pairedSessionId, presentEnrollmentId, targetLessonNumber }: { pairedSessionId: number; presentEnrollmentId: number; targetLessonNumber: 11 | 14 }) =>
      apiRequest("POST", `/api/lesson-pairing/sessions/${pairedSessionId}/convert`, { presentEnrollmentId, targetLessonNumber }),
    onSuccess: () => {
      invalidatePairing();
      setConvertSession(null);
      setConvertEnrollmentId("");
      setConvertLessonNumber("11");
      toast({ title: "Converted to Solo", description: "The present student was converted to a solo lesson." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.data?.message || err?.message || "Failed to convert session.", variant: "destructive" });
    },
  });

  const now = new Date();
  const upcomingWindowEnd = addDays(now, 7);
  const upcomingClasses = classes
    .filter(c => {
      if (c.status !== "scheduled") return false;
      const classDateTime = new Date(`${c.date}T${c.time || "00:00"}`);
      if (isNaN(classDateTime.getTime())) return false;
      return classDateTime >= now && classDateTime <= upcomingWindowEnd;
    })
    .sort((a, b) =>
      new Date(`${a.date}T${a.time || "00:00"}`).getTime() -
      new Date(`${b.date}T${b.time || "00:00"}`).getTime()
    )
    .slice(0, 5);

  const getCourseIcon = (courseType: string) => {
    switch (courseType) {
      case "auto": return <Car className="h-6 w-6 text-white" />;
      case "moto": return <Bike className="h-6 w-6 text-white" />;
      case "scooter": return <Bike className="h-6 w-6 text-white" />;
      default: return <Calendar className="h-6 w-6 text-white" />;
    }
  };

  const getCourseColor = (courseType: string) => {
    switch (courseType) {
      case "auto": return "bg-[#ECC462] text-[#111111]";
      case "moto": return "bg-gray-700 text-white";
      case "scooter": return "bg-gray-900 text-white";
      default: return "bg-gray-100 text-gray-800 shadow-md";
    }
  };

  const getCourseGradient = (courseType: string) => {
    switch (courseType) {
      case "auto": return "from-[#ECC462] to-amber-500";
      case "moto": return "from-amber-600 to-yellow-700";
      case "scooter": return "from-[#111111] to-gray-800";
      default: return "from-gray-400 to-gray-500";
    }
  };

  const handleVehicleFilterToggle = (courseType: keyof typeof vehicleFilters) => {
    setVehicleFilters(prev => ({ ...prev, [courseType]: !prev[courseType] }));
  };

  const handleClassTypeFilterToggle = (classType: keyof typeof classTypeFilters) => {
    setClassTypeFilters(prev => ({ ...prev, [classType]: !prev[classType] }));
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentMonth(prev => {
      const newDate = new Date(prev);
      if (direction === 'prev') {
        newDate.setMonth(prev.getMonth() - 1);
      } else {
        newDate.setMonth(prev.getMonth() + 1);
      }
      return newDate;
    });
  };

  const monthName = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const today = new Date();
  const isToday = (date: Date) => {
    return date.toDateString() === today.toDateString();
  };

  // Calculate class statistics
  const classStats = {
    total: classes.length,
    thisWeek: classes.filter(c => {
      const classDate = parse(c.date, 'yyyy-MM-dd', new Date()); // Parse as local date, not UTC
      const weekStart = startOfWeek(today, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
      return classDate >= weekStart && classDate <= weekEnd;
    }).length,
    auto: classes.filter(c => c.courseType === 'auto').length,
    moto: classes.filter(c => c.courseType === 'moto').length,
    scooter: classes.filter(c => c.courseType === 'scooter').length,
  };

  // Conflict Detection - check for instructor and room double-bookings
  type Conflict = {
    type: 'instructor' | 'room';
    class1: Class;
    class2: Class;
    description: string;
  };

  // Helper function to convert time string to minutes since midnight.
  // Returns null for missing or malformed time values so callers can skip them.
  const timeToMinutes = (timeStr: unknown): number | null => {
    if (typeof timeStr !== 'string') return null;
    const parts = timeStr.split(':');
    if (parts.length < 2) return null;
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    return hours * 60 + minutes;
  };

  const detectConflicts = (): Conflict[] => {
    const conflicts: Conflict[] = [];
    const scheduledClasses = classes.filter(c => c.status === 'scheduled');

    // Check each pair of classes for conflicts
    for (let i = 0; i < scheduledClasses.length; i++) {
      for (let j = i + 1; j < scheduledClasses.length; j++) {
        const class1 = scheduledClasses[i];
        const class2 = scheduledClasses[j];

        // Same date check - skip classes missing a date
        if (!class1.date || !class2.date) continue;
        if (class1.date !== class2.date) continue;

        // Time overlap check - using minutes since midnight for correct calculation.
        // Skip classes that don't have a valid time so a bad record can't crash the page.
        const time1Start = timeToMinutes(class1.time);
        const time2Start = timeToMinutes(class2.time);
        if (time1Start === null || time2Start === null) continue;
        const time1End = time1Start + (class1.duration || 120); // Default 2 hours if not specified
        const time2End = time2Start + (class2.duration || 120);

        const hasTimeOverlap = !(time1End <= time2Start || time2End <= time1Start);

        if (!hasTimeOverlap) continue;

        // Instructor conflict
        if (class1.instructorId && class2.instructorId && class1.instructorId === class2.instructorId) {
          const instructor = instructors.find(i => i.id === class1.instructorId);
          conflicts.push({
            type: 'instructor',
            class1,
            class2,
            description: `${instructor?.firstName || 'Instructor'} is double-booked on ${class1.date} at ${class1.time} and ${class2.time}`
          });
        }

        // Room conflict
        if (class1.room && class2.room && class1.room === class2.room) {
          conflicts.push({
            type: 'room',
            class1,
            class2,
            description: `Room "${class1.room}" is double-booked on ${class1.date} at ${class1.time} and ${class2.time}`
          });
        }
      }
    }

    return conflicts;
  };

  const conflicts = detectConflicts();

  // Check if a class has conflicts
  const getClassConflicts = (classId: number) => {
    return conflicts.filter(c => c.class1.id === classId || c.class2.id === classId);
  };

  if (classesLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="p-4 sm:p-6 lg:p-8">
          <div className="animate-pulse space-y-8">
            <div className="h-12 bg-gray-200 rounded-md w-1/3"></div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-40 bg-white border border-gray-200 rounded-md"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="mb-10">
          <div className="flex justify-between items-center">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <h1 className="text-xl font-semibold text-gray-900">
                  Class Scheduling
                </h1>
                <CalendarClock className="h-6 w-6 text-[#ECC462]" />
              </div>
              <p className="text-gray-600 font-medium">
                Schedule and manage theory classes for Auto, Moto, and Scooter courses.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="border-[#ECC462] text-[#111111] hover:bg-amber-50 font-medium rounded-md"
                onClick={() => setIsGenerateOpen(true)}
              >
                <Wand2 className="mr-2 h-4 w-4 text-[#ECC462]" />
                Generate Schedule
              </Button>
              <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                <DialogTrigger asChild>
                  <Button 
                    data-testid="button-schedule-class"
                    className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] font-medium rounded-md transition-all duration-200"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Schedule Class
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Schedule New Class</DialogTitle>
                    <DialogDescription>
                      Create a new class session with instructor assignment.
                    </DialogDescription>
                  </DialogHeader>
                  <ClassForm onSuccess={() => setIsCreateDialogOpen(false)} />
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>

        {/* Class Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
          {/* This Week Classes Card */}
          <div className="stat-card">
            <div className="flex items-start justify-between mb-4">
              <CalendarClock className="h-5 w-5 text-gray-400" />
              <Badge variant="outline" className="text-gray-600 border-gray-200">
                This Week
              </Badge>
            </div>
            <div>
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide mb-1">Classes This Week</p>
              <p className="text-3xl font-bold text-gray-900 mb-1">{classStats.thisWeek}</p>
              <p className="text-gray-400 text-xs">of {classStats.total} total scheduled</p>
            </div>
          </div>

          {/* Auto Classes Card */}
          <div className="stat-card">
            <div className="flex items-start justify-between mb-4">
              <Car className="h-5 w-5 text-gray-400" />
              <Badge variant="outline" className="text-gray-600 border-gray-200">
                Auto
              </Badge>
            </div>
            <div>
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide mb-1">Auto Classes</p>
              <p className="text-3xl font-bold text-gray-900 mb-1">{classStats.auto}</p>
              <p className="text-gray-400 text-xs">theory sessions scheduled</p>
            </div>
          </div>

          {/* Moto Classes Card */}
          <div className="stat-card">
            <div className="flex items-start justify-between mb-4">
              <Bike className="h-5 w-5 text-gray-400" />
              <Badge variant="outline" className="text-gray-600 border-gray-200">
                Moto
              </Badge>
            </div>
            <div>
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide mb-1">Moto Classes</p>
              <p className="text-3xl font-bold text-gray-900 mb-1">{classStats.moto}</p>
              <p className="text-gray-400 text-xs">theory sessions scheduled</p>
            </div>
          </div>

          {/* Scooter Classes Card */}
          <div className="stat-card">
            <div className="flex items-start justify-between mb-4">
              <Bike className="h-5 w-5 text-gray-400" />
              <Badge variant="outline" className="text-gray-600 border-gray-200">
                Scooter
              </Badge>
            </div>
            <div>
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide mb-1">Scooter Classes</p>
              <p className="text-3xl font-bold text-gray-900 mb-1">{classStats.scooter}</p>
              <p className="text-gray-400 text-xs">theory sessions scheduled</p>
            </div>
          </div>
        </div>

        {/* Conflicts Alert Panel */}
        {conflicts.length > 0 && (
          <Card className="mb-6 border border-red-200 bg-red-50 border-l-4 border-l-red-500 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-bold text-red-800 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Scheduling Conflicts Detected ({conflicts.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {conflicts.map((conflict, idx) => (
                  <div 
                    key={idx} 
                    className="flex items-center justify-between p-3 bg-white rounded-lg shadow-sm border border-red-100"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-full ${conflict.type === 'instructor' ? 'bg-orange-100' : 'bg-red-100'}`}>
                        {conflict.type === 'instructor' ? (
                          <Users className="h-4 w-4 text-orange-600" />
                        ) : (
                          <MapPin className="h-4 w-4 text-red-600" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-800">{conflict.description}</p>
                        <p className="text-xs text-gray-500">
                          {conflict.class1.courseType.toUpperCase()} #{conflict.class1.classNumber} vs {conflict.class2.courseType.toUpperCase()} #{conflict.class2.classNumber}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => setEditingClass(conflict.class1)}
                        className="text-xs"
                      >
                        Edit Class 1
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => setEditingClass(conflict.class2)}
                        className="text-xs"
                      >
                        Edit Class 2
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Calendar Section */}
        <Card className="mb-10 border border-gray-200 bg-white shadow-sm">
          <CardHeader className="border-b border-gray-100 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl font-semibold text-gray-900 mb-2">
                  {monthName}
                </CardTitle>
                <p className="text-sm text-gray-600 flex items-center gap-2">
                  View and manage your class schedule
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <GripVertical className="h-3 w-3" />
                    Drag classes to reschedule
                  </span>
                </p>
              </div>
              <div className="flex space-x-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => navigateMonth('prev')}
                  className="shadow-md hover:shadow-lg transition-all duration-200"
                  data-testid="button-prev-month"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => navigateMonth('next')}
                  className="shadow-md hover:shadow-lg transition-all duration-200"
                  data-testid="button-next-month"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Course Type Filter */}
            <div className="flex flex-wrap gap-4 mt-6">
              <label className="flex items-center cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={vehicleFilters.auto}
                  onChange={() => handleVehicleFilterToggle('auto')}
                  className="rounded border-gray-300 text-[#ECC462] focus:ring-[#ECC462] mr-2 cursor-pointer" 
                  data-testid="filter-auto"
                />
                <span className="text-sm font-medium text-gray-700 group-hover:text-[#ECC462] transition-colors">Auto</span>
                <Badge className="ml-2 bg-[#ECC462] text-[#111111]">
                  {classStats.auto}
                </Badge>
              </label>
              <label className="flex items-center cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={vehicleFilters.moto}
                  onChange={() => handleVehicleFilterToggle('moto')}
                  className="rounded border-gray-300 text-amber-600 focus:ring-amber-600 mr-2 cursor-pointer" 
                  data-testid="filter-moto"
                />
                <span className="text-sm font-medium text-gray-700 group-hover:text-amber-600 transition-colors">Moto</span>
                <Badge className="ml-2 bg-gray-700 text-white">
                  {classStats.moto}
                </Badge>
              </label>
              <label className="flex items-center cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={vehicleFilters.scooter}
                  onChange={() => handleVehicleFilterToggle('scooter')}
                  className="rounded border-gray-300 text-[#111111] focus:ring-[#111111] mr-2 cursor-pointer" 
                  data-testid="filter-scooter"
                />
                <span className="text-sm font-medium text-gray-700 group-hover:text-[#111111] transition-colors">Scooter</span>
                <Badge className="ml-2 bg-gray-900 text-white">
                  {classStats.scooter}
                </Badge>
              </label>
              
              <div className="border-l border-gray-300 h-6 mx-2"></div>
              
              <label className="flex items-center cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={classTypeFilters.theory}
                  onChange={() => handleClassTypeFilterToggle('theory')}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-600 mr-2 cursor-pointer" 
                  data-testid="filter-theory"
                />
                <span className="text-sm font-medium text-gray-700 group-hover:text-blue-600 transition-colors">Theory</span>
              </label>
              <label className="flex items-center cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={classTypeFilters.driving}
                  onChange={() => handleClassTypeFilterToggle('driving')}
                  className="rounded border-gray-300 text-green-600 focus:ring-green-600 mr-2 cursor-pointer" 
                  data-testid="filter-driving"
                />
                <span className="text-sm font-medium text-gray-700 group-hover:text-green-600 transition-colors">Driving</span>
              </label>
            </div>
          </CardHeader>

          <CardContent className="pt-6">
            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-md overflow-hidden border border-gray-200">
              {/* Calendar Header */}
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                <div key={day} className="bg-gray-50 p-3 text-center text-sm font-semibold text-gray-700 uppercase tracking-wide">
                  {day}
                </div>
              ))}
              
              {/* Calendar Days */}
              {calendarDays.map((calendarDay, i) => {
                const dayClasses = classes.filter(cls => {
                  if (!cls.date || typeof cls.date !== 'string') return false;
                  const [year, month, day] = cls.date.split('-').map(Number);
                  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false;
                  return year === calendarDay.date.getFullYear() && 
                         (month - 1) === calendarDay.date.getMonth() && 
                         day === calendarDay.date.getDate();
                });

                const filteredClasses = dayClasses.filter(cls => 
                  vehicleFilters[cls.courseType as keyof typeof vehicleFilters] &&
                  classTypeFilters[(cls.classType || 'theory') as keyof typeof classTypeFilters]
                );

                const isTodayDate = isToday(calendarDay.date);

                const isDragOver = dragOverDate?.toDateString() === calendarDay.date.toDateString();

                return (
                  <div 
                    key={i} 
                    className={`p-2 min-h-28 relative transition-all duration-200 ${
                      calendarDay.isCurrentMonth 
                        ? isTodayDate
                          ? 'bg-amber-50 ring-2 ring-[#ECC462] ring-inset'
                          : isDragOver
                            ? 'bg-blue-50 ring-2 ring-blue-400 ring-inset'
                            : 'bg-white hover:bg-gray-50' 
                        : 'bg-gray-50/50'
                    }`}
                    onDragOver={(e) => handleDragOver(e, calendarDay.date)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, calendarDay.date)}
                  >
                    <span className={`text-sm font-semibold ${
                      calendarDay.isCurrentMonth 
                        ? isTodayDate
                          ? 'text-[#ECC462]'
                          : 'text-gray-900' 
                        : 'text-gray-400'
                    }`}>
                      {calendarDay.day}
                    </span>
                    
                    {/* Show classes for this day */}
                    <div className="mt-1.5 space-y-1">
                      {filteredClasses.slice(0, 2).map((cls) => {
                        const classConflicts = getClassConflicts(cls.id);
                        const hasConflict = classConflicts.length > 0;
                        const isDragging = draggedClass?.id === cls.id;
                        
                        return (
                          <div 
                            key={cls.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, cls)}
                            onDragEnd={handleDragEnd}
                            onClick={() => setEditingClass(cls)}
                            className={`text-xs px-2 py-1 rounded-md truncate font-medium cursor-grab active:cursor-grabbing relative ${getCourseColor(cls.courseType)} ${hasConflict ? 'ring-2 ring-red-500 ring-offset-1' : ''} ${isDragging ? 'opacity-50 scale-95' : ''}`}
                            title={`${getSchedulingClassLabel(cls)} - ${cls.time} - ${cls.enrolledCount ?? 0}/${cls.maxStudents} enrolled${hasConflict ? ' (CONFLICT!)' : ''} - Drag to reschedule`}
                          >
                            <div className="flex items-center gap-1">
                              {hasConflict && <AlertTriangle className="h-3 w-3 text-red-500 flex-shrink-0" />}
                              <span className="truncate">{getSchedulingClassLabel(cls)}</span>
                              <span className="ml-auto flex-shrink-0 text-[10px] font-semibold opacity-80" data-testid={`text-cell-enrolled-${cls.id}`}>
                                {cls.enrolledCount ?? 0}/{cls.maxStudents}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      {filteredClasses.length > 2 && (
                        <button
                          type="button"
                          onClick={() => setExpandedDay(calendarDay.date)}
                          className="w-full text-left text-xs text-gray-700 font-medium bg-gray-100 hover:bg-gray-200 rounded-md px-2 py-1 cursor-pointer transition-colors"
                          data-testid={`button-more-classes-${format(calendarDay.date, 'yyyy-MM-dd')}`}
                        >
                          +{filteredClasses.length - 2} more
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Upcoming Classes List */}
        <Card className="border border-gray-200 bg-white shadow-sm">
          <CardHeader className="border-b border-gray-100 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl font-semibold text-gray-900">
                  Upcoming Classes This Week
                </CardTitle>
                <p className="text-sm text-gray-600 mt-1">Scheduled sessions in the next 7 days</p>
              </div>
              <div className="bg-amber-100 rounded-xl p-2.5">
                <BookOpen className="h-5 w-5 text-[#ECC462]" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-4">
              {upcomingClasses.map((classItem) => (
                <div 
                  key={classItem.id} 
                  className="group relative rounded-md border border-gray-200 hover:border-[#ECC462] transition-colors bg-white"
                >
                  {/* Course accent border on the left */}
                  <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-md ${classItem.courseType === 'auto' ? 'bg-[#ECC462]' : classItem.courseType === 'moto' ? 'bg-gray-600' : 'bg-gray-900'}`}></div>
                  
                  <div className="flex items-center justify-between p-5 pl-6">
                    <div className="flex items-center space-x-5">
                      <div className="flex-shrink-0">
                        <div className={`w-10 h-10 rounded-md flex items-center justify-center bg-gray-100`}>
                          {getCourseIcon(classItem.courseType)}
                        </div>
                      </div>
                      <div>
                        <h4 className="text-base font-bold text-gray-900 mb-1">
                          {getSchedulingClassLabel(classItem)}
                        </h4>
                        {classItem.sessionGroupId && (
                          <Badge variant="outline" className="mb-1 border-blue-200 bg-blue-50 text-blue-700" data-testid={`badge-session-group-${classItem.id}`}>
                            <Link2 className="mr-1 h-3 w-3" />
                            Virtual session group ({classes.filter(cls => cls.sessionGroupId === classItem.sessionGroupId).length} parts)
                          </Badge>
                        )}
                        <div className="flex items-center space-x-3 text-sm text-gray-600">
                          <div className="flex items-center">
                            <Calendar className="h-4 w-4 mr-1.5 text-[#ECC462]" />
                            <span className="font-medium">{classItem.date} at {classItem.time}</span>
                          </div>
                        </div>
                        <div className="flex items-center space-x-3 text-xs text-gray-500 mt-1.5">
                          <div className="flex items-center">
                            <Users className="h-3.5 w-3.5 mr-1 text-amber-600" />
                            <span>Instructor: {getInstructorName(classItem.instructorId)}</span>
                          </div>
                          <div className="flex items-center">
                            <MapPin className="h-3.5 w-3.5 mr-1 text-[#ECC462]" />
                            <span>{classItem.room}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-5">
                      <div className="text-right">
                        <p className="text-sm font-bold text-gray-900 mb-0.5" data-testid={`text-enrolled-count-${classItem.id}`}>
                          {classItem.enrolledCount ?? 0} / {classItem.maxStudents}
                        </p>
                        <p className="text-xs text-gray-500">
                          Students
                        </p>
                        <Badge className="mt-2 bg-[#ECC462] text-[#111111]" data-testid={`badge-spots-remaining-${classItem.id}`}>
                          {Math.max(0, classItem.maxStudents - (classItem.enrolledCount ?? 0))} spots
                        </Badge>
                      </div>
                      <div className="flex space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingClass(classItem)}
                          className="hover:bg-amber-50 hover:text-[#ECC462] transition-colors"
                          data-testid={`button-edit-class-${classItem.id}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          className="hover:bg-amber-50 hover:text-amber-600 transition-colors"
                          data-testid={`button-view-class-${classItem.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="hover:bg-red-50 hover:text-red-600 transition-colors"
                          data-testid={`button-delete-class-${classItem.id}`}
                          disabled={deleteClassMutation.isPending}
                          onClick={() => {
                            if (window.confirm(`Delete ${getSchedulingClassLabel(classItem)} on ${classItem.date} at ${classItem.time}? This cannot be undone.`)) {
                              deleteClassMutation.mutate(classItem.id);
                            }
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {upcomingClasses.length === 0 && (
                <div className="text-center py-16">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
                    <CalendarClock className="h-10 w-10 text-[#ECC462]" />
                  </div>
                  <p className="text-lg font-semibold text-gray-700 mb-2">No Upcoming Classes</p>
                  <p className="text-sm text-gray-500 mb-6">Get started by scheduling your first class session.</p>
                  <Button 
                    onClick={() => setIsCreateDialogOpen(true)}
                    className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] font-medium"
                    data-testid="button-create-first-class"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Schedule First Class
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* In-Car #12/13 Pairing Queue (Task 272) */}
        <Card className="mt-6" data-testid="card-pairing-queue">
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5 text-[#ECC462]" />
                In-Car #12/13 Pairing Queue
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setHistoryOpen(true)}
                data-testid="button-pairing-history"
              >
                <Clock className="mr-1.5 h-3.5 w-3.5" />
                Pairing History
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {pairingLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading pairing queue…
              </div>
            ) : !pairingOverview ? (
              <p className="text-sm text-gray-500 py-4">Unable to load pairing queue.</p>
            ) : (
              <div className="space-y-6">
                {/* Stats */}
                <div className="flex flex-wrap gap-2 text-xs" data-testid="pairing-stats">
                  <Badge variant="outline">Waiting: {pairingOverview.stats.waiting}</Badge>
                  <Badge variant="outline">Booked First: {pairingOverview.stats.bookedFirst}</Badge>
                  <Badge variant="outline">Offered: {pairingOverview.stats.offered}</Badge>
                  <Badge variant="outline">Active Sessions: {pairingOverview.stats.activeSessionsTotal}</Badge>
                </div>

                {/* Waiting queue */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 mb-2">Waiting Queue</h3>
                  {pairingOverview.waiting.length === 0 ? (
                    <p className="text-sm text-gray-500">No students waiting.</p>
                  ) : (
                    <ul className="space-y-1.5" data-testid="list-pairing-waiting">
                      {pairingOverview.waiting.map((entry, idx) => (
                        <li
                          key={entry.id}
                          className="flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm"
                          data-testid={`pairing-waiting-${entry.id}`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge className="bg-[#ECC462] text-[#111111]">#{idx + 1}</Badge>
                            <span className="truncate font-medium text-gray-800">{pairingStudentName(entry.studentId)}</span>
                            <span className="text-xs text-gray-500">priority {entry.priority}</span>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setManualPairEntry(entry); setManualPairClassId(""); }}
                            data-testid={`button-manual-pair-${entry.id}`}
                          >
                            Manual Pair
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Booked first (owner awaiting a partner) */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 mb-2">Booked First (awaiting partner)</h3>
                  {pairingOverview.bookedFirst.length === 0 ? (
                    <p className="text-sm text-gray-500">No students awaiting a partner.</p>
                  ) : (
                    <ul className="space-y-1.5" data-testid="list-pairing-booked-first">
                      {pairingOverview.bookedFirst.map((entry) => (
                        <li
                          key={entry.id}
                          className="flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm"
                          data-testid={`pairing-booked-first-${entry.id}`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="truncate font-medium text-gray-800">{pairingStudentName(entry.studentId)}</span>
                            <span className="text-xs text-gray-500">{pairingClassLabel(entry.bookedClassId)}</span>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={requeueMutation.isPending}
                            onClick={() => requeueMutation.mutate(entry.id)}
                            data-testid={`button-requeue-${entry.id}`}
                          >
                            Requeue
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Offered (active offers / deadlines) */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 mb-2">Active Offers</h3>
                  {pairingOverview.offered.length === 0 ? (
                    <p className="text-sm text-gray-500">No active offers.</p>
                  ) : (
                    <ul className="space-y-1.5" data-testid="list-pairing-offered">
                      {pairingOverview.offered.map((entry) => (
                        <li
                          key={entry.id}
                          className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm"
                          data-testid={`pairing-offered-${entry.id}`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Clock className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                            <span className="truncate font-medium text-gray-800">{pairingStudentName(entry.studentId)}</span>
                            <span className="text-xs text-gray-500">{pairingClassLabel(entry.bookedClassId)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs border-amber-400 text-amber-700">offered</Badge>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={requeueMutation.isPending}
                              onClick={() => requeueMutation.mutate(entry.id)}
                              data-testid={`button-requeue-${entry.id}`}
                            >
                              Requeue
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Paired sessions */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 mb-2">Paired Sessions</h3>
                  {pairingOverview.activeSessions.length === 0 ? (
                    <p className="text-sm text-gray-500">No active paired sessions.</p>
                  ) : (
                    <ul className="space-y-2" data-testid="list-pairing-sessions">
                      {pairingOverview.activeSessions.map((session) => {
                        const confirm = sessionConfirmStatus(session);
                        return (
                          <li
                            key={session.id}
                            className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
                            data-testid={`pairing-session-${session.id}`}
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-2 min-w-0">
                                <CalendarClock className="h-3.5 w-3.5 text-[#ECC462] flex-shrink-0" />
                                <span className="font-medium text-gray-800">
                                  {pairingStudentName(session.studentIdA)} &amp; {pairingStudentName(session.studentIdB)}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-500">{pairingClassLabel(session.classId)}</span>
                                <Badge
                                  variant="outline"
                                  className={`text-xs ${session.status === "confirmed" ? "border-green-400 text-green-700" : "border-amber-400 text-amber-700"}`}
                                >
                                  {session.status}
                                </Badge>
                              </div>
                            </div>
                            <div className="flex items-center justify-between gap-2 mt-1.5">
                              <span className="text-xs text-gray-500" data-testid={`pairing-session-confirm-${session.id}`}>
                                {confirm.pending > 0
                                  ? `${confirm.pending} pending confirmation${confirm.pending !== 1 ? "s" : ""}`
                                  : "All confirmed"}
                              </span>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={requeueMutation.isPending}
                                  onClick={() => requeueMutation.mutate(session.queueEntryIdA)}
                                  data-testid={`button-requeue-session-a-${session.id}`}
                                >
                                  Requeue {pairingStudentName(session.studentIdA)}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={requeueMutation.isPending}
                                  onClick={() => requeueMutation.mutate(session.queueEntryIdB)}
                                  data-testid={`button-requeue-session-b-${session.id}`}
                                >
                                  Requeue {pairingStudentName(session.studentIdB)}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => { setConvertSession(session); setConvertEnrollmentId(""); setConvertLessonNumber("11"); }}
                                  data-testid={`button-convert-session-${session.id}`}
                                >
                                  Convert to Solo
                                </Button>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pairing History Dialog (Task 276) */}
        <Dialog open={historyOpen} onOpenChange={(open) => { if (!open) setHistoryOpen(false); }}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="dialog-pairing-history">
            <DialogHeader>
              <DialogTitle>12/13 Pairing History</DialogTitle>
              <DialogDescription>
                Full audit timeline of pairing events — offers, pairs, deferrals, and conversions. Filter by student or class.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap gap-4 pb-2">
              <div className="space-y-1.5">
                <Label htmlFor="history-student-id">Student ID</Label>
                <Input
                  id="history-student-id"
                  type="number"
                  min={1}
                  placeholder="All students"
                  className="w-40"
                  value={historyStudentId}
                  onChange={(e) => setHistoryStudentId(e.target.value)}
                  data-testid="input-history-student"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="history-class">Class</Label>
                <Select value={historyClassId || "all"} onValueChange={(v) => setHistoryClassId(v === "all" ? "" : v)}>
                  <SelectTrigger id="history-class" className="w-56" data-testid="select-history-class">
                    <SelectValue placeholder="All classes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All classes</SelectItem>
                    {classes
                      .filter((c) => c.classType === "driving")
                      .slice()
                      .sort((a, b) => `${b.date ?? ""} ${b.time ?? ""}`.localeCompare(`${a.date ?? ""} ${a.time ?? ""}`))
                      .map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {pairingClassLabel(c.id)} · #{c.classNumber}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {historyLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
              </div>
            ) : !pairingHistory || pairingHistory.events.length === 0 ? (
              <p className="text-sm text-gray-500 py-6" data-testid="text-history-empty">
                No pairing events found{historyQueryString ? " for this filter" : ""}.
              </p>
            ) : (
              <ul className="space-y-2" data-testid="list-pairing-history">
                {pairingHistory.events.map((event) => {
                  const reason = historyReason(event);
                  return (
                    <li
                      key={event.id}
                      className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm"
                      data-testid={`pairing-history-${event.id}`}
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                          <Badge variant="outline" className="capitalize">{formatEventType(event.eventType)}</Badge>
                          <span className="font-medium text-gray-800 truncate">
                            {event.studentName ?? (event.studentId != null ? `Student #${event.studentId}` : "—")}
                          </span>
                          {event.classId != null && (
                            <span className="text-xs text-gray-500">{pairingClassLabel(event.classId)}</span>
                          )}
                        </div>
                        <span className="text-xs text-gray-500 whitespace-nowrap">
                          {format(new Date(event.createdAt), "MMM d, yyyy h:mm a")}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-600 flex-wrap">
                        <span>
                          By: {event.actorRole === "system" ? "system" : `${event.actorRole ?? "unknown"}${event.actorId && event.actorId !== "system" ? ` (${event.actorId})` : ""}`}
                        </span>
                        {(event.previousStatus || event.newStatus) && (
                          <span>
                            Status: {event.previousStatus ?? "—"} → {event.newStatus ?? "—"}
                          </span>
                        )}
                        {reason && <span className="text-gray-700">Reason: {reason}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </DialogContent>
        </Dialog>

        {/* Manual Pair Dialog */}
        <Dialog open={!!manualPairEntry} onOpenChange={(open) => { if (!open) { setManualPairEntry(null); setManualPairClassId(""); } }}>
          <DialogContent data-testid="dialog-manual-pair">
            <DialogHeader>
              <DialogTitle>Manual Pair</DialogTitle>
              <DialogDescription>
                {manualPairEntry ? `Pair ${pairingStudentName(manualPairEntry.studentId)} into an In-Car #12/13 class.` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label htmlFor="manual-pair-class">Canonical 12/13 Slot (awaiting partner)</Label>
              {manualPairSlots.length === 0 ? (
                <p className="text-sm text-gray-500">No canonical 12/13 slots with a booked-first student awaiting a partner.</p>
              ) : (
                <Select value={manualPairClassId} onValueChange={setManualPairClassId}>
                  <SelectTrigger id="manual-pair-class" data-testid="select-manual-pair-class">
                    <SelectValue placeholder="Select a slot" />
                  </SelectTrigger>
                  <SelectContent>
                    {manualPairSlots
                      .slice()
                      .sort((a, b) => pairingClassLabel(a.classId).localeCompare(pairingClassLabel(b.classId)))
                      .map((slot) => (
                        <SelectItem key={slot.classId} value={String(slot.classId)}>
                          {pairingClassLabel(slot.classId)} · {pairingStudentName(slot.bookedFirstStudentId)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setManualPairEntry(null); setManualPairClassId(""); }}>
                Cancel
              </Button>
              <Button
                className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] font-medium"
                disabled={!manualPairClassId || !manualPairEntry || manualPairMutation.isPending}
                onClick={() => {
                  if (manualPairEntry && manualPairClassId) {
                    manualPairMutation.mutate({ classId: parseInt(manualPairClassId), waitingStudentId: manualPairEntry.studentId });
                  }
                }}
                data-testid="button-confirm-manual-pair"
              >
                {manualPairMutation.isPending ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Pairing…</>) : "Pair"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Convert to Solo Dialog */}
        <Dialog open={!!convertSession} onOpenChange={(open) => { if (!open) { setConvertSession(null); setConvertEnrollmentId(""); setConvertLessonNumber("11"); } }}>
          <DialogContent data-testid="dialog-convert-session">
            <DialogHeader>
              <DialogTitle>Convert to Solo Lesson</DialogTitle>
              <DialogDescription>
                Convert the present student in this paired session to a solo lesson (11 or 14).
              </DialogDescription>
            </DialogHeader>
            {convertSession && (
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>Present Student</Label>
                  <Select value={convertEnrollmentId} onValueChange={setConvertEnrollmentId}>
                    <SelectTrigger data-testid="select-convert-student">
                      <SelectValue placeholder="Select the present student" />
                    </SelectTrigger>
                    <SelectContent>
                      {convertSession.enrollmentIdA != null && (
                        <SelectItem value={String(convertSession.enrollmentIdA)}>
                          {pairingStudentName(convertSession.studentIdA)}
                        </SelectItem>
                      )}
                      {convertSession.enrollmentIdB != null && (
                        <SelectItem value={String(convertSession.enrollmentIdB)}>
                          {pairingStudentName(convertSession.studentIdB)}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Target Lesson</Label>
                  <Select value={convertLessonNumber} onValueChange={setConvertLessonNumber}>
                    <SelectTrigger data-testid="select-convert-lesson">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="11">Lesson 11</SelectItem>
                      <SelectItem value="14">Lesson 14</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setConvertSession(null); setConvertEnrollmentId(""); setConvertLessonNumber("11"); }}>
                Cancel
              </Button>
              <Button
                className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] font-medium"
                disabled={!convertEnrollmentId || !convertSession || convertMutation.isPending}
                onClick={() => {
                  if (convertSession && convertEnrollmentId) {
                    convertMutation.mutate({
                      pairedSessionId: convertSession.id,
                      presentEnrollmentId: parseInt(convertEnrollmentId),
                      targetLessonNumber: parseInt(convertLessonNumber) === 14 ? 14 : 11,
                    });
                  }
                }}
                data-testid="button-confirm-convert"
              >
                {convertMutation.isPending ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Converting…</>) : "Convert"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Expanded Day Dialog */}
        {expandedDay && (
          <Dialog open={true} onOpenChange={() => setExpandedDay(null)}>
            <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto" data-testid="dialog-day-classes">
              <DialogHeader>
                <DialogTitle>{format(expandedDay, 'EEEE, MMMM d, yyyy')}</DialogTitle>
                <DialogDescription>
                  All classes scheduled for this day. Click a class to edit it.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                {classes
                  .filter(cls => {
                    if (!cls.date || typeof cls.date !== 'string') return false;
                    const [year, month, day] = cls.date.split('-').map(Number);
                    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false;
                    return year === expandedDay.getFullYear() &&
                           (month - 1) === expandedDay.getMonth() &&
                           day === expandedDay.getDate();
                  })
                  .filter(cls =>
                    vehicleFilters[cls.courseType as keyof typeof vehicleFilters] &&
                    classTypeFilters[(cls.classType || 'theory') as keyof typeof classTypeFilters]
                  )
                  .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
                  .map(cls => {
                    const hasConflict = getClassConflicts(cls.id).length > 0;
                    return (
                      <button
                        key={cls.id}
                        type="button"
                        onClick={() => {
                          setExpandedDay(null);
                          setEditingClass(cls);
                        }}
                        className={`w-full text-left text-sm px-3 py-2 rounded-md font-medium cursor-pointer ${getCourseColor(cls.courseType)} ${hasConflict ? 'ring-2 ring-red-500 ring-offset-1' : ''}`}
                        data-testid={`button-day-class-${cls.id}`}
                      >
                        <div className="flex items-center gap-2">
                          {hasConflict && <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />}
                          <span>{getSchedulingClassLabel(cls)}</span>
                          <span className="ml-auto flex items-center gap-2 text-xs">
                            <span className="flex items-center gap-1" data-testid={`text-day-enrolled-${cls.id}`}>
                              <Users className="h-3 w-3" />
                              {cls.enrolledCount ?? 0}/{cls.maxStudents}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {cls.time}
                            </span>
                          </span>
                        </div>
                        {hasConflict && <div className="text-xs text-red-600 mt-1">Scheduling conflict</div>}
                      </button>
                    );
                  })}
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* Edit Dialog */}
        {editingClass && (
          <Dialog open={true} onOpenChange={() => setEditingClass(null)}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Edit Class</DialogTitle>
                <DialogDescription>
                  Update class details, timing, and instructor assignment.
                </DialogDescription>
                <div className="flex items-center gap-1.5 text-sm text-gray-700 pt-1" data-testid="text-dialog-enrolled">
                  <Users className="h-4 w-4 text-[#ECC462]" />
                  <span className="font-semibold">{editingClass.enrolledCount ?? 0} / {editingClass.maxStudents}</span>
                  <span className="text-gray-500">students enrolled</span>
                </div>
                {(editingClass.enrolledCount ?? 0) > 0 && (
                  <div className="rounded-md border border-gray-200 bg-gray-50 p-2.5 mt-1" data-testid="list-enrolled-students">
                    {enrolledStudentsLoading ? (
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading enrolled students…
                      </div>
                    ) : enrolledStudents.length === 0 ? (
                      <p className="text-sm text-gray-500">No active enrollments.</p>
                    ) : (
                      <ul className="space-y-1">
                        {enrolledStudents.map((s) => (
                          <li key={s.enrollmentId} className="flex items-center justify-between text-sm" data-testid={`enrolled-student-${s.studentId}`}>
                            <span className="text-gray-800">{s.firstName} {s.lastName}</span>
                            {s.attendanceStatus && s.attendanceStatus !== "pending" && (
                              <Badge variant="outline" className="text-xs capitalize">{s.attendanceStatus.replace(/_/g, " ")}</Badge>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </DialogHeader>
              {editingClass.seriesId && (
                <div className="rounded-md border border-[#ECC462] bg-amber-50 p-3 flex items-center justify-between gap-3 flex-wrap" data-testid="banner-series-membership">
                  <div className="flex items-center gap-2 text-sm text-gray-800">
                    <Repeat className="h-4 w-4 text-[#ECC462] flex-shrink-0" />
                    <span className="font-medium">Part of a recurring schedule</span>
                    {editingClass.detachedFromSeries && (
                      <Badge variant="outline" className="text-xs border-amber-400 text-amber-700" data-testid="badge-detached">
                        Edited individually — series edits skip this class
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-[#ECC462] text-[#111111] hover:bg-amber-100"
                      onClick={() => {
                        setSeriesAction({ mode: "edit", anchorClass: editingClass });
                        setEditingClass(null);
                      }}
                      data-testid="button-edit-series"
                    >
                      Edit Series
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSeriesAction({ mode: "days", anchorClass: editingClass });
                        setEditingClass(null);
                      }}
                      data-testid="button-change-series-days"
                    >
                      Change Days
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-red-300 text-red-600 hover:bg-red-50"
                      onClick={() => {
                        setSeriesAction({ mode: "delete", anchorClass: editingClass });
                        setEditingClass(null);
                      }}
                      data-testid="button-delete-series"
                    >
                      Delete Series
                    </Button>
                  </div>
                </div>
              )}
              {editingClass.sessionGroupId && (
                <div className="rounded-md border border-blue-200 bg-blue-50 p-3" data-testid="banner-session-group">
                  <div className="flex items-center gap-2 text-sm font-medium text-blue-900">
                    <Link2 className="h-4 w-4" />
                    Linked virtual session
                  </div>
                  <p className="mt-1 text-sm text-blue-800">
                    This is part {classes.filter(cls => cls.sessionGroupId === editingClass.sessionGroupId).sort((a, b) => a.id - b.id).findIndex(cls => cls.id === editingClass.id) + 1} of {classes.filter(cls => cls.sessionGroupId === editingClass.sessionGroupId).length}.
                    Each part has its own instructor, roster, attendance, capacity, and Zoom link.
                  </p>
                </div>
              )}
              {!!editingClass.zoomLink?.trim() && (editingClass.enrolledCount ?? 0) > 30 && !editingClass.sessionGroupId && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 flex items-center justify-between gap-3" data-testid="banner-virtual-over-capacity">
                  <div>
                    <p className="text-sm font-semibold text-red-900">Virtual class exceeds the 30-student limit</p>
                    <p className="text-sm text-red-700">Split the roster evenly before making other changes.</p>
                  </div>
                  <Button
                    type="button"
                    onClick={() => {
                      setSplitClass(editingClass);
                      setEditingClass(null);
                    }}
                    data-testid="button-split-virtual-class"
                  >
                    <Scissors className="mr-2 h-4 w-4" />
                    Split class
                  </Button>
                </div>
              )}
              {(() => {
                const classDateTime = new Date(`${editingClass.date}T${editingClass.time || "00:00"}`);
                const isPastClass = !isNaN(classDateTime.getTime()) && classDateTime < new Date();
                if (!isPastClass) return null;
                const activeCount = editingClass.enrolledCount ?? 0;
                const historyCount = editingClass.historicalEnrollmentCount ?? activeCount;
                const hasStudents = historyCount > 0;
                const onlyCancelled = hasStudents && activeCount === 0;
                return (
                  <div className="rounded-md border border-gray-200 bg-gray-50 p-3 flex items-center justify-between gap-3 flex-wrap" data-testid="banner-past-class-delete">
                    <div className="text-sm text-gray-700">
                      <span className="font-medium">This class is in the past.</span>{" "}
                      {hasStudents
                        ? onlyCancelled
                          ? "It cannot be deleted because it has booking history (cancelled enrollments) — attendance records are preserved."
                          : "It cannot be deleted because students were enrolled — attendance history is preserved."
                        : "No students were ever enrolled, so it can be safely removed from the calendar."}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-red-300 text-red-600 hover:bg-red-50"
                      disabled={hasStudents || deleteClassMutation.isPending}
                      onClick={() => {
                        if (window.confirm(`Delete this past class on ${editingClass.date} at ${editingClass.time}? This cannot be undone.`)) {
                          deleteClassMutation.mutate(editingClass.id, {
                            onSuccess: () => setEditingClass(null),
                          });
                        }
                      }}
                      data-testid="button-delete-past-class"
                    >
                      <X className="h-4 w-4 mr-1" />
                      Delete Past Class
                    </Button>
                  </div>
                );
              })()}
              <ClassForm 
                classData={editingClass} 
                onSuccess={() => setEditingClass(null)} 
              />
            </DialogContent>
          </Dialog>
        )}

        {splitClass && (
          <VirtualClassSplitDialog
            classData={splitClass}
            instructors={instructors}
            onClose={() => setSplitClass(null)}
          />
        )}

        {/* Series Edit/Delete Dialog */}
        {seriesAction && seriesAction.anchorClass.seriesId && (
          <SeriesManager
            seriesId={seriesAction.anchorClass.seriesId}
            anchorClass={seriesAction.anchorClass}
            mode={seriesAction.mode}
            instructors={instructors}
            onClose={() => setSeriesAction(null)}
          />
        )}

        {/* Generate Schedule Dialog */}
        <Dialog open={isGenerateOpen} onOpenChange={setIsGenerateOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Wand2 className="h-5 w-5 text-[#ECC462]" />
                Generate Recurring Schedule
              </DialogTitle>
              <DialogDescription>
                Create classes automatically for a date range — up to 1 year in advance.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 py-2">
              {/* Course & Class Type */}
              <div className={genForm.fullCurriculum ? "grid grid-cols-1 gap-4" : "grid grid-cols-2 gap-4"}>
                <div className="space-y-1.5">
                  <Label>Course Type</Label>
                  <Select
                    value={genForm.courseType}
                    onValueChange={v => setGenForm(p => ({
                      ...p,
                      courseType: v,
                      // Auto and moto are curriculum-driven programs. Selecting
                      // either type should immediately plan the whole schedule;
                      // staff can uncheck the planner to create a partial series.
                      fullCurriculum: v === "auto" || v === "moto",
                      progressive: false,
                      classType: "theory",
                      classNumber: "1",
                      duration: v === "moto" ? 180 : 120,
                      motoTrainingStage: "closed-circuit",
                    }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="moto">Moto</SelectItem>
                      <SelectItem value="scooter">Scooter</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {!genForm.fullCurriculum && <div className="space-y-1.5">
                  <Label>Class Type</Label>
                  <Select
                    value={genForm.classType}
                    onValueChange={v => setGenForm(p => ({
                      ...p,
                      classType: v,
                      classNumber: v === "driving" && p.courseType === "moto" ? "1" : p.classNumber,
                      duration: p.courseType === "moto"
                        ? (v === "driving" ? 240 : 180)
                        : p.duration,
                      maxStudents: v === "driving" && p.courseType === "moto" ? 1 : p.maxStudents,
                      motoTrainingStage: "closed-circuit",
                    }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="theory">
                        {genForm.courseType === "moto" ? "Motorcycle Theory / Preparation" : "Theory Class"}
                      </SelectItem>
                      <SelectItem value="driving">
                        {genForm.courseType === "moto" ? "Motorcycle Practical Training" : "Driving Class"}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>}
              </div>

              {isMotoPracticalSeries && (
                <div className="space-y-1.5 rounded-md border border-blue-200 bg-blue-50 p-3">
                  <Label>Motorcycle Training Stage</Label>
                  <Select
                    value={motoPracticalStage}
                    onValueChange={(value: "closed-circuit" | "road") => selectMotoPracticalStage(value)}
                  >
                    <SelectTrigger data-testid="select-recurring-moto-training-stage">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="closed-circuit">Closed-Circuit Training — Sessions 1–4</SelectItem>
                      <SelectItem value="road">Road Training — Sessions 1–3</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-600">
                    {motoPracticalStage === "closed-circuit"
                      ? "Choose class numbers 1–4. Each closed-circuit session is 4 hours."
                      : "Choose class #5 for Road Session 1 (2 hours), or #6–7 for Road Sessions 2–3 (4 hours)."}
                  </p>
                </div>
              )}

              {/* Class Number & Duration */}
              {!genForm.fullCurriculum && <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>
                    {isMotoPracticalSeries
                      ? motoPracticalStage === "road"
                        ? "Road Session"
                        : "Closed-Circuit Session"
                      : "Class Number"}
                  </Label>
                  <Input
                    type="number"
                    min={isMotoPracticalSeries && motoPracticalStage === "road" ? 5 : 1}
                    max={isMotoPracticalSeries ? (motoPracticalStage === "road" ? 7 : 4) : 15}
                    step={1}
                    value={genForm.classNumber}
                    onChange={e => {
                      const nextNumber = parseInt(e.target.value, 10);
                      setGenForm(p => ({
                        ...p,
                        classNumber: e.target.value,
                        duration: isMotoPracticalSeries && Number.isInteger(nextNumber)
                          ? (nextNumber === 5 ? 120 : 240)
                          : p.duration,
                        maxStudents: isMotoPracticalSeries ? 1 : p.maxStudents,
                      }));
                    }}
                    className={classNumberValid ? undefined : 'border-red-400 focus-visible:ring-red-400'}
                  />
                  {!classNumberValid && (
                    <p className="text-xs text-red-500">Enter a whole number (1 or higher)</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Duration</Label>
                  <Select
                    value={String(genForm.duration)}
                    disabled={genForm.courseType === "moto"}
                    onValueChange={v => setGenForm(p => ({ ...p, duration: parseInt(v) }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="60">60 min</SelectItem>
                      <SelectItem value="90">90 min</SelectItem>
                      <SelectItem value="120">120 min</SelectItem>
                      <SelectItem value="180">180 min</SelectItem>
                      <SelectItem value="240">240 min</SelectItem>
                    </SelectContent>
                  </Select>
                  {genForm.courseType === "moto" && (
                    <p className="text-xs text-gray-500">Set automatically from the motorcycle program.</p>
                  )}
                </div>
              </div>}

              {/* Full curriculum plan (auto & moto courses) */}
              {(genForm.courseType === 'auto' || genForm.courseType === 'moto') && (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3">
                  <Checkbox
                    id="gen-full-curriculum"
                    checked={genForm.fullCurriculum}
                    onCheckedChange={v => setGenForm(p => ({ ...p, fullCurriculum: v === true, progressive: false }))}
                    data-testid="checkbox-full-curriculum"
                  />
                  <div className="space-y-0.5">
                    <Label htmlFor="gen-full-curriculum" className="cursor-pointer">
                      {genForm.courseType === 'moto' ? 'Plan the full motorcycle program' : 'Plan the full 4-phase curriculum'}
                    </Label>
                    <p className="text-xs text-gray-600">
                      {genForm.courseType === 'moto'
                        ? "Creates all 9 classes in program order on the selected weekdays: Theory #1 yard prep (3h), four closed-circuit sessions (4h each), Theory #2 road prep (3h), then road sessions of 2h/4h/4h. Class type, number, duration, and capacity are set per class automatically."
                        : "Creates all 27 classes (Theory #1–12 and In-Car #1–15) in the school's recommended order on the selected weekdays, automatically spacing them to satisfy the phase minimums (28 days for Phases 1–2, 56 days for Phases 3–4). Class type, number, and duration are set per class automatically."}
                    </p>
                  </div>
                </div>
              )}

              {genForm.fullCurriculum && genForm.courseType === "moto" && (
                <div className="grid gap-2 sm:grid-cols-2" data-testid="moto-curriculum-preview">
                  <div className="rounded-md border bg-white p-3">
                    <p className="font-medium">1. Yard Preparation</p>
                    <p className="text-xs text-gray-500">Theory #1 · 3 hours</p>
                  </div>
                  <div className="rounded-md border bg-white p-3">
                    <p className="font-medium">2. Closed-Circuit Training</p>
                    <p className="text-xs text-gray-500">4 sessions · 4 hours each</p>
                  </div>
                  <div className="rounded-md border bg-white p-3">
                    <p className="font-medium">3. Road Preparation</p>
                    <p className="text-xs text-gray-500">Theory #2 · 3 hours</p>
                  </div>
                  <div className="rounded-md border bg-white p-3">
                    <p className="font-medium">4. Road Training</p>
                    <p className="text-xs text-gray-500">3 sessions · 2h / 4h / 4h</p>
                  </div>
                </div>
              )}

              {/* Progressive series */}
              {!genForm.fullCurriculum && (
              <div className="flex items-start gap-2 rounded-md border border-gray-200 p-3">
                <Checkbox
                  id="gen-progressive"
                  checked={genForm.progressive}
                  onCheckedChange={v => setGenForm(p => ({ ...p, progressive: v === true }))}
                  data-testid="checkbox-progressive"
                />
                <div className="space-y-0.5">
                  <Label htmlFor="gen-progressive" className="cursor-pointer">
                    {isMotoPracticalSeries
                      ? motoPracticalStage === "closed-circuit"
                        ? "Create all Closed-Circuit sessions"
                        : "Create all Road Training sessions"
                      : "Progress through class numbers"}
                  </Label>
                  <p className="text-xs text-gray-500">
                    {isMotoPracticalSeries
                      ? motoPracticalStage === "closed-circuit"
                        ? "Creates Closed-Circuit Sessions #1–4 on consecutive matching dates, each with the required 4-hour duration."
                        : "Creates Road Sessions #1–3 on consecutive matching dates with the required 2h / 4h / 4h durations."
                      : `Each date gets the next class number (${genForm.classType === 'driving' ? 'Driving' : 'Theory'} ${classNumberInt}, ${classNumberInt + 1}, …) up to the last session of the ${genForm.courseType} course, instead of repeating the same class every time.`}
                  </p>
                </div>
              </div>
              )}

              {/* Days of Week */}
              <div className="space-y-2">
                <Label>Days of Week <span className="text-red-500">*</span></Label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { label: 'Sun', day: 0 },
                    { label: 'Mon', day: 1 },
                    { label: 'Tue', day: 2 },
                    { label: 'Wed', day: 3 },
                    { label: 'Thu', day: 4 },
                    { label: 'Fri', day: 5 },
                    { label: 'Sat', day: 6 },
                  ].map(({ label, day }) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleGenDay(day)}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                        genForm.daysOfWeek.includes(day)
                          ? 'bg-[#ECC462] border-[#ECC462] text-[#111111]'
                          : 'bg-white border-gray-200 text-gray-600 hover:border-[#ECC462]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time & Instructor */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Start Time <span className="text-red-500">*</span></Label>
                  <Input
                    type="time"
                    value={genForm.time}
                    onChange={e => setGenForm(p => ({ ...p, time: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Instructor (optional)</Label>
                  <Select value={genForm.instructorId} onValueChange={v => setGenForm(p => ({ ...p, instructorId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Assign later" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Assign later</SelectItem>
                      {instructors.map(inst => (
                        <SelectItem key={inst.id} value={String(inst.id)}>
                          {inst.firstName} {inst.lastName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Max Students & Lesson Type */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Max Students</Label>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={genForm.maxStudents}
                    onChange={e => setGenForm(p => ({ ...p, maxStudents: parseInt(e.target.value) || 15 }))}
                  />
                </div>
                {genForm.classType === 'driving' && (
                  <div className="space-y-1.5">
                    <Label>Lesson Type</Label>
                    <Select value={genForm.lessonType} onValueChange={v => setGenForm(p => ({ ...p, lessonType: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="regular">Regular</SelectItem>
                        <SelectItem value="one_off">One-Off</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* Date Range */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Start Date <span className="text-red-500">*</span></Label>
                  <Input
                    type="date"
                    value={genForm.startDate}
                    min={todayStr}
                    onChange={e => setGenForm(p => ({ ...p, startDate: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>End Date <span className="text-red-500">*</span></Label>
                  <Input
                    type="date"
                    value={genForm.endDate}
                    min={genForm.startDate}
                    max={format(addDays(new Date(genForm.startDate || todayStr), 365), 'yyyy-MM-dd')}
                    onChange={e => setGenForm(p => ({ ...p, endDate: e.target.value }))}
                  />
                </div>
              </div>

              {/* Preview count */}
              <div className={`rounded-lg p-4 text-sm font-medium ${
                previewCount > 0
                  ? 'bg-amber-50 border border-[#ECC462] text-[#111111]'
                  : 'bg-gray-50 border border-gray-200 text-gray-500'
              }`}>
                {previewCount > 0
                  ? `Will create ${previewCount} class${previewCount !== 1 ? 'es' : ''} between ${genForm.startDate} and ${genForm.endDate}`
                  : 'Select at least one day of the week and a valid date range to see a preview'}
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setIsGenerateOpen(false)}>
                Cancel
              </Button>
              <Button
                className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] font-medium"
                disabled={previewCount === 0 || generateScheduleMutation.isPending}
                onClick={() => generateScheduleMutation.mutate(genForm)}
              >
                {generateScheduleMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Wand2 className="mr-2 h-4 w-4" />
                    Generate {previewCount > 0 ? `${previewCount} Classes` : 'Schedule'}
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
