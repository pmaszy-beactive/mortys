import { useState, DragEvent } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Calendar, ChevronLeft, ChevronRight, Car, Bike, Users, Edit, Eye, X, Sparkles, CalendarClock, BookOpen, MapPin, AlertTriangle, Clock, GripVertical } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import ClassForm from "@/components/class-form";
import type { Class, Instructor } from "@shared/schema";
import { startOfWeek, endOfWeek, parse, format } from "date-fns";

export default function Scheduling() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<Class | null>(null);
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
  const [dragOverDate, setDragOverDate] = useState<Date | null>(null);
  const { toast } = useToast();

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
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to reschedule class.",
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
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete this class. Please try again.",
        variant: "destructive",
      });
    },
  });

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

  const { data: classes = [], isLoading: classesLoading } = useQuery<Class[]>({
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

  const upcomingClasses = classes.filter(c => c.status === "scheduled").slice(0, 5);

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

  // Helper function to convert time string to minutes since midnight
  const timeToMinutes = (timeStr: string): number => {
    const [hours, minutes] = timeStr.split(':').map(Number);
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

        // Same date check
        if (class1.date !== class2.date) continue;

        // Time overlap check - using minutes since midnight for correct calculation
        const time1Start = timeToMinutes(class1.time);
        const time2Start = timeToMinutes(class2.time);
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
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Schedule New Class</DialogTitle>
                  <DialogDescription>
                    Create a new theory class session with instructor and room assignment.
                  </DialogDescription>
                </DialogHeader>
                <ClassForm onSuccess={() => setIsCreateDialogOpen(false)} />
              </DialogContent>
            </Dialog>
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
                  const [year, month, day] = cls.date.split('-').map(Number);
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
                    className={`p-3 h-28 relative transition-all duration-200 ${
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
                            title={`${cls.courseType.toUpperCase()} #${cls.classNumber} - ${cls.time}${hasConflict ? ' (CONFLICT!)' : ''} - Drag to reschedule`}
                          >
                            <div className="flex items-center gap-1">
                              {hasConflict && <AlertTriangle className="h-3 w-3 text-red-500 flex-shrink-0" />}
                              <span className="truncate">{cls.courseType.charAt(0).toUpperCase()}{cls.courseType.slice(1)} #{cls.classNumber}</span>
                            </div>
                          </div>
                        );
                      })}
                      {filteredClasses.length > 2 && (
                        <div className="text-xs text-gray-600 font-medium bg-gray-100 rounded-md px-2 py-1">
                          +{filteredClasses.length - 2} more
                        </div>
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
                <p className="text-sm text-gray-600 mt-1">Next scheduled theory sessions</p>
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
                          {classItem.courseType.charAt(0).toUpperCase() + classItem.courseType.slice(1)} Theory Class #{classItem.classNumber}
                        </h4>
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
                        <p className="text-sm font-bold text-gray-900 mb-0.5">
                          0 / {classItem.maxStudents}
                        </p>
                        <p className="text-xs text-gray-500">
                          Students
                        </p>
                        <Badge className="mt-2 bg-[#ECC462] text-[#111111]">
                          {classItem.maxStudents} spots
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
                            if (window.confirm(`Delete "${classItem.name}" on ${classItem.date}? This cannot be undone.`)) {
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

        {/* Edit Dialog */}
        {editingClass && (
          <Dialog open={true} onOpenChange={() => setEditingClass(null)}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Edit Class</DialogTitle>
                <DialogDescription>
                  Update class details, timing, and instructor assignment.
                </DialogDescription>
              </DialogHeader>
              <ClassForm 
                classData={editingClass} 
                onSuccess={() => setEditingClass(null)} 
              />
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}
