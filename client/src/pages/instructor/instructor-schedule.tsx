import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Calendar, Clock, MapPin, Users, Car, BookOpen, ArrowLeft, Filter, ChevronLeft, ChevronRight, LogOut, GraduationCap, CheckCircle, ClipboardCheck, UserCheck, PenTool, AlertTriangle, CalendarDays, List, XCircle } from "lucide-react";
import { useInstructorAuth } from "@/hooks/useInstructorAuth";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { format, startOfWeek, endOfWeek, addDays, addWeeks, subWeeks, addMonths, subMonths, startOfMonth, endOfMonth, isSameMonth, isToday, isBefore, parse, isSameDay, getDay } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import SignaturePad, { SignaturePadRef } from "@/components/signature-pad";
import type { Class } from "@shared/schema";

type ViewMode = "week" | "month";

interface ConflictInfo {
  date: string;
  time: string;
  classes: Class[];
}

interface StudentAttendance {
  enrollmentId: number;
  studentId: number;
  firstName: string;
  lastName: string;
  email: string;
  attendanceStatus: string;
  attended: boolean;
}

export default function InstructorSchedule() {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [selectedWeek, setSelectedWeek] = useState(() => {
    const now = new Date();
    return format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');
  });
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return format(startOfMonth(now), 'yyyy-MM-dd');
  });
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [attendanceClass, setAttendanceClass] = useState<Class | null>(null);
  const [studentAttendance, setStudentAttendance] = useState<StudentAttendance[]>([]);
  const [useSavedSignature, setUseSavedSignature] = useState(false);
  const signaturePadRef = useRef<SignaturePadRef>(null);
  
  const { instructor, isLoading: authLoading, isAuthenticated } = useInstructorAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: classes = [], isLoading } = useQuery<Class[]>({
    queryKey: ["/api/instructor/classes"],
    enabled: !!instructor,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const { data: evaluations = [] } = useQuery<Array<{ id: number; classId: number; signedOff: boolean; instructorSignature: string | null; studentSignature: string | null }>>({
    queryKey: ["/api/instructor/evaluations"],
    enabled: !!instructor,
  });

  const evaluatedClassIds = useMemo(() => {
    return new Set(
      evaluations
        .filter(e => e.signedOff || (e.instructorSignature && e.studentSignature))
        .map(e => e.classId)
        .filter(Boolean)
    );
  }, [evaluations]);

  // Query to get students for attendance dialog (only runs when dialog is open with valid class)
  const { data: classStudentsData, isLoading: studentsLoading } = useQuery<{
    classData: Class;
    students: Array<{
      enrollmentId: number;
      studentId: number;
      firstName: string;
      lastName: string;
      email: string;
      attendanceStatus: string;
    }>;
  }>({
    queryKey: ["/api/instructor/classes", attendanceClass?.id, "students"],
    queryFn: async () => {
      const res = await fetch(`/api/instructor/classes/${attendanceClass!.id}/students`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch students');
      return res.json();
    },
    enabled: !!attendanceClass?.id,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });

  useEffect(() => {
    if (attendanceClass) {
      signaturePadRef.current?.clear();
      setStudentAttendance([]);
      setUseSavedSignature(!!instructor?.digitalSignature);
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/classes", attendanceClass.id, "students"] });
    }
  }, [attendanceClass, instructor?.digitalSignature]);

  // Initialize attendance state when students data loads
  useEffect(() => {
    if (classStudentsData?.students) {
      setStudentAttendance(
        classStudentsData.students.map(s => ({
          ...s,
          // Only default to attended if status is 'attended'; otherwise default to present for new entries
          attended: s.attendanceStatus === 'attended' ? true : s.attendanceStatus === 'absent' ? false : true,
        }))
      );
    }
  }, [classStudentsData]);

  // Mutation to submit attendance
  const submitAttendanceMutation = useMutation({
    mutationFn: (data: { attendance: Array<{ enrollmentId: number; attended: boolean }>; signature: string; classId: number }) =>
      apiRequest("POST", `/api/instructor/classes/${data.classId}/attendance`, { attendance: data.attendance, signature: data.signature }),
    onSuccess: (response: any, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/classes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/classes-needing-evaluation"] });
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/dashboard"] });
      // Also invalidate the students query for this class
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/classes", variables.classId, "students"] });
      toast({
        title: "Attendance Submitted",
        description: `${response.attendedCount} students marked present, ${response.absentCount} absent.`,
      });
      setAttendanceClass(null);
      setStudentAttendance([]);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message || "Failed to submit attendance",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      setLocation("/instructor/login");
    }
  }, [authLoading, isAuthenticated, setLocation]);

  // Calculate week dates
  const weekStart = parse(selectedWeek, 'yyyy-MM-dd', new Date()); // Parse as local time
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Calculate month dates
  const monthStart = parse(selectedMonth, 'yyyy-MM-dd', new Date());
  const monthEnd = endOfMonth(monthStart);
  const monthStartDay = getDay(monthStart); // 0 = Sunday
  const adjustedStartDay = monthStartDay === 0 ? 6 : monthStartDay - 1; // Adjust for Monday start
  const calendarStart = addDays(monthStart, -adjustedStartDay);
  const calendarDays = Array.from({ length: 42 }, (_, i) => addDays(calendarStart, i)); // 6 weeks

  // Filter classes for the selected week and filters
  const weekClasses = classes.filter(classItem => {
    const classDate = parse(classItem.date, 'yyyy-MM-dd', new Date()); // Parse as local time
    const inWeek = classDate >= weekStart && classDate <= weekEnd;
    const matchesStatus = statusFilter === "all" || classItem.status === statusFilter;
    const matchesType = typeFilter === "all" || classItem.courseType === typeFilter;
    return inWeek && matchesStatus && matchesType;
  });

  // Filter classes for the selected month
  const monthClasses = classes.filter(classItem => {
    const classDate = parse(classItem.date, 'yyyy-MM-dd', new Date());
    const inMonth = isSameMonth(classDate, monthStart);
    const matchesStatus = statusFilter === "all" || classItem.status === statusFilter;
    const matchesType = typeFilter === "all" || classItem.courseType === typeFilter;
    return inMonth && matchesStatus && matchesType;
  });

  // Current view classes based on mode
  const currentViewClasses = viewMode === "week" ? weekClasses : monthClasses;

  // Group classes by date
  const classesByDate = classes.reduce((acc, classItem) => {
    const date = classItem.date;
    if (!acc[date]) acc[date] = [];
    acc[date].push(classItem);
    return acc;
  }, {} as Record<string, Class[]>);

  // Detect scheduling conflicts (overlapping classes at same time)
  const conflicts = useMemo<ConflictInfo[]>(() => {
    const conflictMap = new Map<string, Class[]>();
    
    currentViewClasses.forEach(classItem => {
      if (classItem.status === 'cancelled') return;
      const key = `${classItem.date}|${classItem.time}`;
      if (!conflictMap.has(key)) {
        conflictMap.set(key, []);
      }
      conflictMap.get(key)!.push(classItem);
    });
    
    const result: ConflictInfo[] = [];
    conflictMap.forEach((classes, key) => {
      if (classes.length > 1) {
        const [date, time] = key.split('|');
        result.push({ date, time, classes });
      }
    });
    
    return result.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.time.localeCompare(b.time);
    });
  }, [currentViewClasses]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled':
        return 'default';
      case 'completed':
        return 'secondary';
      case 'cancelled':
        return 'destructive';
      case 'in-progress':
        return 'outline';
      default:
        return 'secondary';
    }
  };

  const getTimeStatus = (date: string, time: string) => {
    const classDateTime = new Date(`${date}T${time}`);
    const now = new Date();
    
    if (isBefore(classDateTime, now)) {
      return 'past';
    } else if (isToday(classDateTime)) {
      return 'today';
    }
    return 'future';
  };

  // Determine if class is theory or practical
  const isTheoryClass = (classNumber: number) => {
    return classNumber === 1 || classNumber === 5; // Classes 1 and 5 are theory
  };

  // Get color scheme for class type
  const getClassTypeColors = (classNumber: number) => {
    if (isTheoryClass(classNumber)) {
      return {
        border: 'border-l-blue-500',
        bg: 'bg-white',
        icon: 'text-blue-600',
        iconBg: 'bg-blue-50',
        badge: 'bg-blue-600 text-white rounded-md'
      };
    } else {
      return {
        border: 'border-l-green-500',
        bg: 'bg-white',
        icon: 'text-green-600',
        iconBg: 'bg-green-50',
        badge: 'bg-green-600 text-white rounded-md'
      };
    }
  };

  // Week navigation handlers
  const goToPreviousWeek = () => {
    const newWeek = subWeeks(weekStart, 1);
    setSelectedWeek(format(startOfWeek(newWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  };

  const goToNextWeek = () => {
    const newWeek = addWeeks(weekStart, 1);
    setSelectedWeek(format(startOfWeek(newWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  };

  const goToToday = () => {
    const now = new Date();
    setSelectedWeek(format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
    setSelectedMonth(format(startOfMonth(now), 'yyyy-MM-dd'));
  };

  // Month navigation handlers
  const goToPreviousMonth = () => {
    const newMonth = subMonths(monthStart, 1);
    setSelectedMonth(format(startOfMonth(newMonth), 'yyyy-MM-dd'));
  };

  const goToNextMonth = () => {
    const newMonth = addMonths(monthStart, 1);
    setSelectedMonth(format(startOfMonth(newMonth), 'yyyy-MM-dd'));
  };

  // Check if a date has conflicts
  const hasConflict = (dateStr: string) => {
    return conflicts.some(c => c.date === dateStr);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
      toast({
        title: "Logged out successfully",
        description: "You have been logged out of your account.",
      });
      window.location.href = '/instructor-login';
    } catch (error) {
      console.error('Logout error:', error);
      window.location.href = '/instructor-login';
    }
  };

  // Mutation to mark a class as completed
  const markCompleteMutation = useMutation({
    mutationFn: (classId: number) => apiRequest("POST", `/api/instructor/classes/${classId}/complete`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/classes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/classes-needing-evaluation"] });
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/dashboard"] });
      toast({
        title: "Class Completed",
        description: "The class has been marked as completed and is now ready for evaluation.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message || "Failed to mark class as completed",
        variant: "destructive",
      });
    },
  });

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  // Check if a class can be marked as complete (today or past, not already completed)
  const canMarkComplete = (classItem: Class) => {
    return classItem.date <= todayStr && classItem.status !== 'completed' && classItem.status !== 'cancelled';
  };

  // Check if a class can have attendance taken (both theory and driving classes)
  // Allow on same day even for completed classes (so instructor can undo/correct)
  const canTakeAttendance = (classItem: Class) => {
    if (classItem.status === 'cancelled') return false;
    if (classItem.date === todayStr) return true;
    return classItem.date < todayStr && classItem.status !== 'completed';
  };

  // Toggle individual student attendance
  const toggleStudentAttendance = (enrollmentId: number) => {
    setStudentAttendance(prev =>
      prev.map(s =>
        s.enrollmentId === enrollmentId ? { ...s, attended: !s.attended } : s
      )
    );
  };

  // Mark all students as present
  const markAllPresent = () => {
    setStudentAttendance(prev => prev.map(s => ({ ...s, attended: true })));
  };

  // Mark all students as absent
  const markAllAbsent = () => {
    setStudentAttendance(prev => prev.map(s => ({ ...s, attended: false })));
  };

  // Handle attendance submission
  const handleSubmitAttendance = () => {
    if (!attendanceClass) {
      return;
    }

    let signature: string | null = null;
    
    if (useSavedSignature && instructor?.digitalSignature) {
      signature = instructor.digitalSignature;
    } else {
      signature = signaturePadRef.current?.getSignature() || null;
      if (!signature || signaturePadRef.current?.isEmpty()) {
        toast({
          title: "Signature Required",
          description: "Please sign to confirm the attendance, or use your saved signature.",
          variant: "destructive",
        });
        return;
      }
    }

    submitAttendanceMutation.mutate({
      classId: attendanceClass.id,
      attendance: studentAttendance.map(s => ({
        enrollmentId: s.enrollmentId,
        attended: s.attended,
      })),
      signature,
    });
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-[#ECC462] mx-auto mb-4"></div>
          <p className="text-gray-700 font-medium">Loading schedule...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-2 sm:space-y-0 sm:space-x-4">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setLocation('/instructor/dashboard')}
                className="hover:bg-gray-100 transition-colors"
              >
                <ArrowLeft className="flex-shrink-0 h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
                  My Schedule
                </h1>
                <p className="mt-1 text-sm sm:text-base text-gray-600">
                  View and manage your teaching schedule
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2 flex-wrap">
              {conflicts.length > 0 && (
                <Badge variant="destructive" className="rounded-md">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {conflicts.length} Conflict{conflicts.length !== 1 ? 's' : ''}
                </Badge>
              )}
              <div className="flex items-center space-x-2 bg-gray-100 px-4 py-2 rounded-md">
                <Calendar className="flex-shrink-0 h-5 w-5 text-[#ECC462]" />
                <span className="text-sm font-medium text-gray-900">
                  {currentViewClasses.length} class{currentViewClasses.length !== 1 ? 'es' : ''} this {viewMode}
                </span>
              </div>
              <Button 
                variant="ghost"
                onClick={handleLogout}
                className="text-gray-600 hover:text-[#111111] hover:bg-gray-100"
                data-testid="button-logout"
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Legend */}
        <Card className="mb-6 border border-gray-200 rounded-md shadow-sm bg-white">
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center justify-center gap-6">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-md bg-blue-50 border border-blue-200 flex items-center justify-center">
                  <GraduationCap className="h-4 w-4 text-blue-600" />
                </div>
                <span className="text-sm font-medium text-gray-700">Theory Classes (1 & 5)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-md bg-green-50 border border-green-200 flex items-center justify-center">
                  <Car className="h-4 w-4 text-green-600" />
                </div>
                <span className="text-sm font-medium text-gray-700">Driving Classes (2, 3 & 4)</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* View Toggle */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-gray-200 bg-white shadow-sm overflow-hidden">
            <Button
              variant={viewMode === "week" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("week")}
              className={viewMode === "week" 
                ? "bg-[#ECC462] text-[#111111] rounded-none hover:bg-[#ECC462]/90" 
                : "rounded-none hover:bg-gray-50"
              }
            >
              <List className="h-4 w-4 mr-2" />
              Week
            </Button>
            <Button
              variant={viewMode === "month" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("month")}
              className={viewMode === "month" 
                ? "bg-[#ECC462] text-[#111111] rounded-none hover:bg-[#ECC462]/90" 
                : "rounded-none hover:bg-gray-50"
              }
            >
              <CalendarDays className="h-4 w-4 mr-2" />
              Month
            </Button>
          </div>
        </div>

        {/* Conflict Alerts */}
        {conflicts.length > 0 && (
          <Alert variant="destructive" className="mb-6 border-red-200 bg-red-50 rounded-md">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Scheduling Conflicts Detected</AlertTitle>
            <AlertDescription>
              <p className="mb-2">You have {conflicts.length} scheduling conflict{conflicts.length !== 1 ? 's' : ''} where you're assigned to multiple classes at the same time:</p>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {conflicts.map((conflict, idx) => (
                  <div key={idx} className="flex flex-wrap items-center gap-2 text-sm bg-white/50 p-2 rounded-md">
                    <Badge variant="outline" className="bg-white rounded-md">
                      {format(parse(conflict.date, 'yyyy-MM-dd', new Date()), 'MMM d')} at {conflict.time.slice(0, 5)}
                    </Badge>
                    <span className="text-red-700">
                      {conflict.classes.map(c => `${c.courseType?.toUpperCase()} Class ${c.classNumber}`).join(' & ')}
                    </span>
                  </div>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Controls */}
        <Card className="mb-6 border border-gray-200 rounded-md shadow-sm bg-white">
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4">
              {/* Navigation */}
              <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={viewMode === "week" ? goToPreviousWeek : goToPreviousMonth}
                      data-testid="button-previous"
                      className="border-gray-200 hover:bg-gray-50 transition-all duration-200 rounded-md"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <h2 className="text-lg font-bold text-gray-900 min-w-[150px] text-center">
                      {viewMode === "week" 
                        ? `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`
                        : format(monthStart, 'MMMM yyyy')
                      }
                    </h2>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={viewMode === "week" ? goToNextWeek : goToNextMonth}
                      data-testid="button-next"
                      className="border-gray-200 hover:bg-gray-50 transition-all duration-200 rounded-md"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={goToToday}
                    className="border-gray-200 hover:bg-gray-50 rounded-md"
                  >
                    Today
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-gray-400" />
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-[140px] h-9 border-gray-200 rounded-md">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        <SelectItem value="scheduled">Scheduled</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="w-[140px] h-9 border-gray-200 rounded-md">
                      <SelectValue placeholder="Course Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="auto">Automobile</SelectItem>
                      <SelectItem value="moto">Motorcycle</SelectItem>
                      <SelectItem value="scooter">Scooter</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Weekly Calendar View */}
        {viewMode === "week" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-4 mb-8">
            {weekDays.map((day, index) => {
              const dateStr = format(day, 'yyyy-MM-dd');
              const dayClasses = (classesByDate[dateStr] || []).filter(c => {
                const matchesStatus = statusFilter === "all" || c.status === statusFilter;
                const matchesType = typeFilter === "all" || c.courseType === typeFilter;
                return matchesStatus && matchesType;
              });
              const isWeekend = index >= 5;
              const isDayToday = isToday(day);
              const dayHasConflict = hasConflict(dateStr);

              return (
                <Card 
                  key={dateStr} 
                  className={`border-0 shadow-xl bg-white/90 backdrop-blur-sm hover:shadow-2xl transition-all duration-300 ${
                    isDayToday ? 'ring-2 ring-[#ECC462] shadow-yellow-200' : ''
                  } ${
                    isWeekend ? 'bg-gradient-to-br from-gray-50 to-yellow-50' : ''
                  } ${
                    dayHasConflict ? 'ring-2 ring-red-400' : ''
                  }`}
                >
                <CardHeader className="pb-3 border-b bg-gradient-to-r from-yellow-50 to-amber-50">
                  <CardTitle className="text-sm font-medium text-gray-900">
                    {format(day, 'EEE')}
                  </CardTitle>
                  <div className="flex items-center justify-between">
                    <span className={`text-lg font-semibold ${
                      isDayToday ? 'text-[#ECC462]' : 'text-gray-900'
                    }`}>
                      {format(day, 'd')}
                    </span>
                    {dayClasses.length > 0 && (
                      <Badge variant="secondary" className="text-xs shadow-sm">
                        {dayClasses.length}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-3">
                  <div className="space-y-2">
                    {dayClasses.length === 0 ? (
                      <p className="text-xs text-gray-500 text-center py-2">No classes</p>
                    ) : (
                      dayClasses.map((classItem) => {
                        const timeStatus = getTimeStatus(classItem.date, classItem.time);
                        const typeColors = getClassTypeColors(classItem.classNumber);
                        const isTheory = isTheoryClass(classItem.classNumber);
                        return (
                          <div
                            key={classItem.id}
                            className={`p-2 rounded-lg text-xs border-l-4 transition-all duration-200 hover:shadow-md cursor-pointer ${
                              timeStatus === 'past' 
                                ? 'border-l-gray-400 bg-gray-50/80' 
                                : timeStatus === 'today' 
                                ? 'border-l-[#ECC462] bg-gradient-to-r from-yellow-50 to-amber-50 shadow-sm' 
                                : `${typeColors.border} ${typeColors.bg} shadow-sm`
                            }`}
                            onClick={() => setLocation(`/instructor/lesson/${classItem.id}/check-in`)}
                          >
                            <div className="flex items-center space-x-1 mb-1">
                              <div className={`rounded p-1 shadow-sm ${
                                timeStatus === 'past' ? 'bg-gray-200' : typeColors.iconBg
                              }`}>
                                {isTheory ? (
                                  <GraduationCap className={`h-3 w-3 ${
                                    timeStatus === 'past' ? 'text-gray-500' : typeColors.icon
                                  }`} />
                                ) : (
                                  <Car className={`h-3 w-3 ${
                                    timeStatus === 'past' ? 'text-gray-500' : typeColors.icon
                                  }`} />
                                )}
                              </div>
                              <span className="font-medium text-gray-900">
                                {classItem.time.slice(0, 5)}
                              </span>
                            </div>
                            <p className="text-gray-700 font-medium">
                              {classItem.courseType?.toUpperCase()} - Class {classItem.classNumber}
                            </p>
                            <div className="flex items-center gap-1 mt-1">
                              <Badge className={`shadow-sm ${
                                timeStatus === 'past' ? 'bg-gray-400' : typeColors.badge
                              }`}>
                                {isTheory ? 'Theory' : 'Driving'}
                              </Badge>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          </div>
        )}

        {/* Monthly Calendar View */}
        {viewMode === "month" && (
          <Card className="mb-8 border-0 shadow-xl bg-white/90 backdrop-blur-sm">
            <CardContent className="pt-6">
              {/* Month header */}
              <div className="grid grid-cols-7 gap-1 mb-2">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                  <div key={day} className="text-center text-xs sm:text-sm font-medium text-gray-600 py-2">
                    <span className="hidden sm:inline">{day}</span>
                    <span className="sm:hidden">{day.charAt(0)}</span>
                  </div>
                ))}
              </div>
              
              {/* Calendar grid */}
              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((day, idx) => {
                  const dateStr = format(day, 'yyyy-MM-dd');
                  const dayClasses = (classesByDate[dateStr] || []).filter(c => {
                    const matchesStatus = statusFilter === "all" || c.status === statusFilter;
                    const matchesType = typeFilter === "all" || c.courseType === typeFilter;
                    return matchesStatus && matchesType;
                  });
                  const isCurrentMonth = isSameMonth(day, monthStart);
                  const isDayToday = isToday(day);
                  const isWeekendDay = idx % 7 >= 5;
                  const dayHasConflict = hasConflict(dateStr);
                  
                  return (
                    <div
                      key={dateStr}
                      className={`min-h-[60px] sm:min-h-[100px] p-1 sm:p-2 border rounded-lg transition-all ${
                        !isCurrentMonth ? 'bg-gray-50 opacity-50' : ''
                      } ${
                        isDayToday ? 'ring-2 ring-[#ECC462] bg-yellow-50' : 'bg-white'
                      } ${
                        isWeekendDay && isCurrentMonth ? 'bg-amber-50/50' : ''
                      } ${
                        dayHasConflict ? 'ring-2 ring-red-400 bg-red-50' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs sm:text-sm font-medium ${
                          isDayToday ? 'text-[#ECC462] font-bold' : 
                          !isCurrentMonth ? 'text-gray-400' : 'text-gray-700'
                        }`}>
                          {format(day, 'd')}
                        </span>
                        {dayClasses.length > 0 && (
                          <Badge variant="secondary" className="text-[10px] sm:text-xs px-1 py-0">
                            {dayClasses.length}
                          </Badge>
                        )}
                      </div>
                      
                      {/* Mobile: Just show dots */}
                      <div className="sm:hidden flex flex-wrap gap-0.5">
                        {dayClasses.slice(0, 4).map((classItem) => (
                          <div
                            key={classItem.id}
                            className={`w-2 h-2 rounded-full ${
                              isTheoryClass(classItem.classNumber) ? 'bg-blue-500' : 'bg-green-500'
                            }`}
                          />
                        ))}
                        {dayClasses.length > 4 && (
                          <span className="text-[8px] text-gray-500">+{dayClasses.length - 4}</span>
                        )}
                      </div>
                      
                      {/* Desktop: Show class details */}
                      <div className="hidden sm:block space-y-1 max-h-[70px] overflow-y-auto">
                        {dayClasses.slice(0, 3).map((classItem) => {
                          const isTheory = isTheoryClass(classItem.classNumber);
                          return (
                            <div
                              key={classItem.id}
                              className={`text-[10px] p-1 rounded truncate cursor-pointer hover:opacity-80 ${
                                isTheory 
                                  ? 'bg-blue-100 text-blue-800 border-l-2 border-blue-500' 
                                  : 'bg-green-100 text-green-800 border-l-2 border-green-500'
                              }`}
                              onClick={() => setLocation(`/instructor/lesson/${classItem.id}/check-in`)}
                            >
                              {classItem.time.slice(0, 5)} {classItem.courseType?.toUpperCase()}
                            </div>
                          );
                        })}
                        {dayClasses.length > 3 && (
                          <div className="text-[10px] text-gray-500 text-center">
                            +{dayClasses.length - 3} more
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Detailed Schedule List */}
        <Card className="border-0 shadow-xl bg-white/90 backdrop-blur-sm hover:shadow-2xl transition-shadow duration-300">
          <CardHeader className="border-b bg-gradient-to-r from-yellow-50 to-amber-50">
            <CardTitle className="flex items-center text-gray-900">
              <div className="bg-yellow-100 rounded-lg p-2 mr-3">
                <Clock className="h-5 w-5 text-[#ECC462]" />
              </div>
              {viewMode === "week" ? "Week" : "Month"} Schedule Details
            </CardTitle>
            <CardDescription className="text-gray-600">
              Complete list of classes for the selected {viewMode}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {currentViewClasses.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date & Time</TableHead>
                      <TableHead>Course</TableHead>
                      <TableHead>Class Details</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Students</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentViewClasses
                      .sort((a, b) => {
                        const dateA = new Date(`${a.date}T${a.time}`);
                        const dateB = new Date(`${b.date}T${b.time}`);
                        return dateA.getTime() - dateB.getTime();
                      })
                      .map((classItem) => {
                        const timeStatus = getTimeStatus(classItem.date, classItem.time);
                        const typeColors = getClassTypeColors(classItem.classNumber);
                        const isTheory = isTheoryClass(classItem.classNumber);
                        return (
                          <TableRow 
                            key={classItem.id} 
                            className={`transition-all duration-200 hover:bg-gradient-to-r cursor-pointer ${
                              isTheory 
                                ? 'hover:from-blue-50 hover:to-indigo-50' 
                                : 'hover:from-green-50 hover:to-emerald-50'
                            } ${
                              timeStatus === 'past' ? 'opacity-60' : ''
                            }`}
                            onClick={() => setLocation(`/instructor/lesson/${classItem.id}/check-in`)}
                          >
                            <TableCell>
                              <div className="space-y-1">
                                <div className="flex items-center">
                                  <div className="bg-yellow-100 rounded p-1 mr-2">
                                    <Calendar className="h-3 w-3 text-[#ECC462]" />
                                  </div>
                                  <span className={`font-medium ${
                                    timeStatus === 'today' ? 'text-[#ECC462]' : 'text-gray-900'
                                  }`}>
                                    {format(parse(classItem.date, 'yyyy-MM-dd', new Date()), 'MMM d')}
                                  </span>
                                </div>
                                <div className="flex items-center text-sm text-gray-500">
                                  <div className="bg-amber-100 rounded p-1 mr-2">
                                    <Clock className="h-3 w-3 text-amber-600" />
                                  </div>
                                  {classItem.time.slice(0, 5)}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-2">
                                <div className="flex items-center space-x-2">
                                  <div className={`rounded p-1.5 shadow-sm ${typeColors.iconBg}`}>
                                    {isTheory ? (
                                      <GraduationCap className={`h-4 w-4 ${typeColors.icon}`} />
                                    ) : (
                                      <Car className={`h-4 w-4 ${typeColors.icon}`} />
                                    )}
                                  </div>
                                  <Badge variant="outline" className="shadow-sm">
                                    {classItem.courseType?.toUpperCase()}
                                  </Badge>
                                </div>
                                <Badge className={`w-fit ${typeColors.badge}`}>
                                  {isTheory ? 'Theory' : 'Driving'}
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <p className="font-medium text-gray-900">Class {classItem.classNumber}</p>
                                <div className="flex flex-wrap gap-1">
                                  {classItem.lessonType === 'one_off' && (
                                    <Badge className="bg-purple-100 text-purple-800 border border-purple-300 shadow-sm">
                                      Refresher
                                    </Badge>
                                  )}
                                  {classItem.hasTest && (
                                    <Badge variant="destructive" className="shadow-sm">
                                      Test
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              {classItem.room && (
                                <div className="flex items-center text-sm">
                                  <div className="bg-orange-100 rounded p-1 mr-2">
                                    <MapPin className="h-3 w-3 text-orange-600" />
                                  </div>
                                  <span className="text-gray-700">{classItem.room}</span>
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant={getStatusColor(classItem.status) as any} className="shadow-sm">
                                {classItem.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {canTakeAttendance(classItem) ? (
                                <button
                                  onClick={() => setLocation(`/instructor/lesson/${classItem.id}/check-in`)}
                                  className="flex items-center text-sm group cursor-pointer hover:underline"
                                  title="Click to view students and sign them in"
                                >
                                  <div className="bg-[#ECC462]/20 rounded p-1 mr-2 group-hover:bg-[#ECC462]/40 transition-colors">
                                    <Users className="h-3 w-3 text-[#ECC462]" />
                                  </div>
                                  <span className="font-medium text-[#ECC462] group-hover:text-[#d9b456]">
                                    {classItem.maxStudents || 'View'}
                                  </span>
                                </button>
                              ) : (
                                <div className="flex items-center text-sm">
                                  <div className="bg-gray-200 rounded p-1 mr-2">
                                    <Users className="h-3 w-3 text-[#111111]" />
                                  </div>
                                  <span className="font-medium text-gray-700">
                                    {classItem.maxStudents || 'No limit'}
                                  </span>
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
                                {canTakeAttendance(classItem) && (
                                  <>
                                    <Button
                                      size="sm"
                                      onClick={() => setLocation(`/instructor/lesson/${classItem.id}/check-in`)}
                                      className="bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111] hover:from-[#ECC462]/90 hover:to-amber-500/90 shadow-md hover:shadow-lg transition-all"
                                      data-testid={`button-checkin-class-${classItem.id}`}
                                    >
                                      <PenTool className="h-4 w-4 mr-1" />
                                      Student Sign-In
                                    </Button>
                                    <Button
                                      size="sm"
                                      onClick={() => setAttendanceClass(classItem)}
                                      className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white hover:from-blue-600 hover:to-indigo-600 shadow-md hover:shadow-lg transition-all"
                                      data-testid={`button-attendance-class-${classItem.id}`}
                                    >
                                      <ClipboardCheck className="h-4 w-4 mr-1" />
                                      Attendance
                                    </Button>
                                  </>
                                )}
                                {!canTakeAttendance(classItem) && canMarkComplete(classItem) ? (
                                  <Button
                                    size="sm"
                                    onClick={() => markCompleteMutation.mutate(classItem.id)}
                                    disabled={markCompleteMutation.isPending}
                                    className="bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111] hover:from-[#ECC462]/90 hover:to-amber-500/90 shadow-md hover:shadow-lg transition-all"
                                    data-testid={`button-complete-class-${classItem.id}`}
                                  >
                                    <CheckCircle className="h-4 w-4 mr-1" />
                                    {markCompleteMutation.isPending ? 'Saving...' : 'Class Done'}
                                  </Button>
                                ) : classItem.status === 'completed' ? (
                                  <div className="flex flex-col gap-1">
                                    <Badge className="bg-green-100 text-green-800 shadow-sm">
                                      <CheckCircle className="h-3 w-3 mr-1" />
                                      Completed
                                    </Badge>
                                    {evaluatedClassIds.has(classItem.id) && (
                                      <Badge className="bg-purple-100 text-purple-800 shadow-sm">
                                        <PenTool className="h-3 w-3 mr-1" />
                                        Evaluation Completed
                                      </Badge>
                                    )}
                                  </div>
                                ) : classItem.status === 'cancelled' ? (
                                  <Badge className="bg-red-100 text-red-800 shadow-sm">
                                    <XCircle className="h-3 w-3 mr-1" />
                                    Cancelled
                                  </Badge>
                                ) : (
                                  <span className="text-gray-400 text-sm">-</span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="bg-gradient-to-br from-yellow-100 to-amber-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4 shadow-lg">
                  <Calendar className="h-10 w-10 text-[#ECC462]" />
                </div>
                <h3 className="text-lg font-medium bg-gradient-to-r from-[#111111] to-gray-800 bg-clip-text text-transparent">
                  No classes scheduled
                </h3>
                <p className="mt-2 text-gray-600">
                  You don't have any classes scheduled for this {viewMode}.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Attendance Dialog */}
      <Dialog open={!!attendanceClass} onOpenChange={(open) => !open && setAttendanceClass(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <div className={`rounded-lg p-2 mr-3 ${isTheoryClass(attendanceClass?.classNumber || 0) ? 'bg-blue-100' : 'bg-green-100'}`}>
                <ClipboardCheck className={`h-5 w-5 ${isTheoryClass(attendanceClass?.classNumber || 0) ? 'text-blue-600' : 'text-green-600'}`} />
              </div>
              {isTheoryClass(attendanceClass?.classNumber || 0) ? 'Theory' : 'Driving'} Class Attendance
            </DialogTitle>
            <DialogDescription>
              {attendanceClass && (
                <>
                  <strong>Class {attendanceClass.classNumber}</strong> ({attendanceClass.courseType.toUpperCase()}) on{' '}
                  {format(parse(attendanceClass.date, 'yyyy-MM-dd', new Date()), 'MMMM d, yyyy')} at {attendanceClass.time.slice(0, 5)}
                  <br />
                  <span className="text-sm text-amber-600 mt-2 block">
                    Mark attendance and sign to confirm.
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {studentsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#ECC462]"></div>
            </div>
          ) : studentAttendance.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Users className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p>No students enrolled in this class.</p>
            </div>
          ) : (
            <>
              {/* Quick Actions */}
              <div className="flex items-center justify-between mb-4 pb-4 border-b">
                <div className="text-sm text-gray-600">
                  {studentAttendance.filter(s => s.attended).length} of {studentAttendance.length} students marked present
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={markAllPresent}
                    className="text-green-600 border-green-200 hover:bg-green-50"
                    data-testid="button-mark-all-present"
                  >
                    <UserCheck className="h-4 w-4 mr-1" />
                    All Present
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={markAllAbsent}
                    className="text-red-600 border-red-200 hover:bg-red-50"
                    data-testid="button-mark-all-absent"
                  >
                    All Absent
                  </Button>
                </div>
              </div>

              {/* Student List */}
              <div className="space-y-2 max-h-60 overflow-y-auto mb-4">
                {studentAttendance.map((student) => (
                  <div
                    key={student.enrollmentId}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                      student.attended 
                        ? 'bg-green-50 border-green-200' 
                        : 'bg-red-50 border-red-200'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <Checkbox
                        checked={student.attended}
                        onCheckedChange={() => toggleStudentAttendance(student.enrollmentId)}
                        className="data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
                        data-testid={`checkbox-attendance-${student.enrollmentId}`}
                      />
                      <div>
                        <div className="font-medium text-gray-900">
                          {student.firstName} {student.lastName}
                        </div>
                        <div className="text-sm text-gray-500">{student.email}</div>
                      </div>
                    </div>
                    <Badge 
                      className={student.attended 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                      }
                    >
                      {student.attended ? 'Present' : 'Absent'}
                    </Badge>
                  </div>
                ))}
              </div>

              <Separator className="my-4" />

              {/* Signature Section */}
              <div className="space-y-3">
                <Label className="flex items-center text-base font-medium">
                  <PenTool className="h-4 w-4 mr-2 text-[#ECC462]" />
                  Instructor Signature
                </Label>
                <p className="text-sm text-gray-500">
                  Confirm the attendance with your signature.
                </p>
                
                {/* Signature options */}
                {instructor?.digitalSignature && (
                  <div className="flex items-center space-x-4 p-3 bg-gray-50 rounded-lg border">
                    <Checkbox
                      id="use-saved-signature"
                      checked={useSavedSignature}
                      onCheckedChange={(checked) => setUseSavedSignature(!!checked)}
                      data-testid="checkbox-use-saved-signature"
                    />
                    <label 
                      htmlFor="use-saved-signature" 
                      className="text-sm font-medium cursor-pointer flex-1"
                    >
                      Use my saved signature from profile
                    </label>
                  </div>
                )}
                
                {useSavedSignature && instructor?.digitalSignature ? (
                  <div className="border rounded-lg p-4 bg-white">
                    <p className="text-sm text-gray-600 mb-2">Your saved signature:</p>
                    <img 
                      src={instructor.digitalSignature} 
                      alt="Saved Signature" 
                      className="max-h-24 border rounded"
                      data-testid="img-saved-signature"
                    />
                  </div>
                ) : (
                  <>
                    <div className="border rounded-lg p-1 bg-white">
                      <SignaturePad ref={signaturePadRef} height={150} />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => signaturePadRef.current?.clear()}
                      data-testid="button-clear-signature"
                    >
                      Clear Signature
                    </Button>
                  </>
                )}
              </div>
            </>
          )}

          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              onClick={() => setAttendanceClass(null)}
              data-testid="button-cancel-attendance"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmitAttendance}
              disabled={submitAttendanceMutation.isPending || studentAttendance.length === 0}
              className="bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111] hover:from-[#ECC462]/90 hover:to-amber-500/90"
              data-testid="button-submit-attendance"
            >
              {submitAttendanceMutation.isPending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#111111] mr-2"></div>
                  Submitting...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Submit Attendance
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
