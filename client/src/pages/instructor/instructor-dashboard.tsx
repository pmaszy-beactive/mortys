import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Calendar, 
  Clock, 
  Users, 
  CheckCircle, 
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Car,
  Sparkles,
  XCircle,
  Search,
  UserX,
  ClipboardList,
  ArrowRight,
  Info
} from "lucide-react";
import { formatDate, formatTime } from "@/lib/utils";
import type { Instructor, Class, Student } from "@shared/schema";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useInstructorAuth } from "@/hooks/useInstructorAuth";
import RequestChangeModal from "@/components/request-change-modal";

interface TodayStudent extends Student {
  todaysClasses: Class[];
}

interface HousekeepingTask {
  id: string;
  type: 'info' | 'warning';
  title: string;
  description: string;
  count: number;
  link: string;
}

interface DashboardData {
  instructor: Instructor;
  stats: {
    totalStudents: number;
    upcomingClasses: number;
    completedEvaluations: number;
    pendingEvaluations: number;
    totalClasses: number;
    weeklyHours: number;
    weeklyNoShows: number;
    todaysStudentCount: number;
  };
  todaysStudents: TodayStudent[];
  todaysClasses: Class[];
  housekeepingTasks: HousekeepingTask[];
  upcomingClasses: Class[];
}

export default function InstructorDashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [changeRequestClass, setChangeRequestClass] = useState<Class | null>(null);
  const { isAuthenticated, isLoading: authLoading } = useInstructorAuth();

  const { data: dashboardData, isLoading, error } = useQuery<DashboardData>({
    queryKey: ["/api/instructor/dashboard"],
    staleTime: 0,
    refetchOnMount: "always",
    retry: 1,
  });

  const confirmClassMutation = useMutation({
    mutationFn: async (classId: number) => {
      return await apiRequest("POST", `/api/instructor/classes/${classId}/confirm`);
    },
    onSuccess: () => {
      toast({
        title: "Class Confirmed",
        description: "You have confirmed this class assignment.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/dashboard"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to confirm class",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      setLocation("/instructor/login");
    }
  }, [authLoading, isAuthenticated, setLocation]);

  const handleConfirmClass = (classId: number) => {
    confirmClassMutation.mutate(classId);
  };

  const handleRequestChange = (classData: Class) => {
    setChangeRequestClass(classData);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setLocation(`/instructor/students?search=${encodeURIComponent(searchQuery)}`);
    }
  };

  if (authLoading) {
    return (
      <div className="h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#ECC462] mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-[#ECC462] mx-auto mb-4"></div>
          <p className="text-gray-700 font-medium">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  if (error || (!isLoading && !dashboardData)) {
    return (
      <div className="h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <p className="text-gray-700 font-medium text-lg">Unable to load dashboard</p>
          {error && (
            <p className="text-sm text-gray-500 mt-2">
              Error: {error.message}
            </p>
          )}
          <Button 
            className="mt-4 bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111]"
            onClick={() => window.location.reload()}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const { instructor, stats, todaysStudents, housekeepingTasks } = dashboardData!;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
      {/* Header with Search */}
      <div className="mb-8">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
                Welcome back, {instructor.firstName}!
              </h1>
              <Sparkles className="flex-shrink-0 h-6 w-6 text-[#ECC462]" />
            </div>
            <p className="mt-1 text-sm sm:text-base text-gray-600">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          
          {/* Search Bar */}
          <form onSubmit={handleSearch} className="w-full lg:w-auto">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search students..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 w-full lg:w-80 border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462]"
                data-testid="input-search-students"
              />
            </div>
          </form>
        </div>
      </div>

      {/* Weekly Stats */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="stat-card">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-gray-100 rounded-md p-3">
              <Clock className="h-8 w-8 text-gray-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Weekly Hours</p>
              <p className="text-3xl font-bold text-gray-900" data-testid="stat-weekly-hours">
                {stats.weeklyHours}
              </p>
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-gray-100 rounded-md p-3">
              <UserX className="h-8 w-8 text-gray-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Weekly No-Shows</p>
              <p className="text-3xl font-bold text-gray-900" data-testid="stat-weekly-noshows">
                {stats.weeklyNoShows}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today's Students */}
        <Card className="border border-gray-200 rounded-md shadow-sm bg-white overflow-hidden">
          <CardHeader className="border-b bg-gray-50">
            <CardTitle className="flex items-center text-gray-900 text-xl font-semibold">
              <Users className="mr-2 h-5 w-5 text-[#ECC462]" />
              Today's Students
              <Badge className="ml-2 bg-[#ECC462] text-[#111111] rounded-md">
                {todaysStudents.length}
              </Badge>
            </CardTitle>
            <CardDescription className="text-gray-500">
              Students you're seeing today
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {todaysStudents.length > 0 ? (
              <div className="space-y-3">
                {todaysStudents.map((student) => (
                  <div 
                    key={student.id} 
                    className="p-4 bg-white rounded-md border border-gray-200 hover:bg-gray-50 transition-colors duration-200"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="flex-shrink-0 bg-gray-100 rounded-full p-2">
                          <Users className="h-5 w-5 text-[#ECC462]" />
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">
                            {student.firstName} {student.lastName}
                          </p>
                          <p className="text-sm text-gray-500">
                            {student.todaysClasses.length} class{student.todaysClasses.length !== 1 ? 'es' : ''} today
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {student.todaysClasses.map((cls) => (
                          <Badge 
                            key={cls.id}
                            variant="outline"
                            className="text-xs border-gray-200 text-gray-600 rounded-md"
                          >
                            {formatTime(cls.time)} - {cls.classType === 'theory' ? 'Theory' : 'Driving'}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    
                    {/* Class confirmation actions */}
                    {student.todaysClasses.map((cls) => (
                      cls.confirmationStatus === 'pending' && (
                        <div key={`confirm-${cls.id}`} className="mt-3 pt-3 border-t border-gray-100">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm text-gray-500">
                              Confirm {formatTime(cls.time)} class:
                            </p>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={() => handleConfirmClass(cls.id)}
                                disabled={confirmClassMutation.isPending}
                                className="bg-green-600 text-white hover:bg-green-700 rounded-md"
                                data-testid={`button-confirm-class-${cls.id}`}
                              >
                                <CheckCircle className="h-4 w-4 mr-1" />
                                Confirm
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleRequestChange(cls)}
                                className="border-gray-200 text-gray-700 hover:bg-gray-50 rounded-md"
                                data-testid={`button-request-change-${cls.id}`}
                              >
                                <XCircle className="h-4 w-4 mr-1" />
                                Change
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="bg-gray-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                  <Calendar className="h-10 w-10 text-gray-400" />
                </div>
                <p className="text-gray-500 font-medium">No students scheduled today</p>
                <p className="text-sm text-gray-400 mt-1">Enjoy your free day!</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Housekeeping Tasks */}
        <Card className="border border-gray-200 rounded-md shadow-sm bg-white overflow-hidden">
          <CardHeader className="border-b bg-gray-50">
            <CardTitle className="flex items-center text-gray-900 text-xl font-semibold">
              <ClipboardList className="mr-2 h-5 w-5 text-gray-600" />
              Housekeeping
              {housekeepingTasks.length > 0 && (
                <Badge className="ml-2 bg-amber-500 text-white rounded-md">
                  {housekeepingTasks.length}
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-gray-500">
              Tasks that need your attention
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {housekeepingTasks.length > 0 ? (
              <div className="space-y-3">
                {housekeepingTasks.map((task) => (
                  <div 
                    key={task.id}
                    className={`p-4 rounded-md border transition-all duration-200 cursor-pointer ${
                      task.type === 'warning' 
                        ? 'bg-orange-50 border-orange-200' 
                        : 'bg-blue-50 border-blue-200'
                    }`}
                    onClick={() => setLocation(task.link)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className={`flex-shrink-0 rounded-md p-2 ${
                          task.type === 'warning' ? 'bg-orange-100' : 'bg-blue-100'
                        }`}>
                          {task.type === 'warning' ? (
                            <AlertTriangle className="h-5 w-5 text-orange-600" />
                          ) : (
                            <Info className="h-5 w-5 text-blue-600" />
                          )}
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">{task.title}</p>
                          <p className="text-sm text-gray-600">{task.description}</p>
                        </div>
                      </div>
                      <ArrowRight className="h-5 w-5 text-gray-400" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="bg-green-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="h-10 w-10 text-green-500" />
                </div>
                <p className="text-gray-700 font-medium">All caught up!</p>
                <p className="text-sm text-gray-500 mt-1">No pending tasks</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Request Change Modal */}
      {changeRequestClass && (
        <RequestChangeModal
          classData={changeRequestClass}
          open={!!changeRequestClass}
          onOpenChange={(open) => {
            if (!open) setChangeRequestClass(null);
          }}
        />
      )}
    </div>
  );
}
