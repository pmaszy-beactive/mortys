import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  AlertCircle,
  Car,
  Sparkles,
  GraduationCap,
  Bike,
  BookOpen,
  ArrowRight,
  CreditCard,
} from "lucide-react";
import { useLocation } from "wouter";
import { useStudentAuth } from "@/hooks/useStudentAuth";
import { useSelectedCourse } from "@/hooks/useSelectedCourse";
import type { Student } from "@shared/schema";
import type { PhaseProgressData } from "@shared/phaseConfig";
import PhaseProgressTracker, { PhaseProgressTrackerSkeleton } from "@/components/phase-progress-tracker";

interface DashboardData {
  student: Student;
  stats: {
    progress: number;
    phase: string;
    completedTheoryClasses: number;
    completedInCarSessions: number;
    totalHoursCompleted: number;
    classesAttended: number;
    upcomingClasses: number;
  };
  upcomingClasses: any[];
  recentEvaluations: any[];
}

const getCourseIcon = (courseType: string) => {
  switch (courseType?.toLowerCase()) {
    case "auto":
    case "car":
      return <Car className="h-4 w-4" />;
    case "moto":
    case "motorcycle":
      return <Bike className="h-4 w-4" />;
    case "scooter":
      return <Bike className="h-4 w-4" />;
    default:
      return <Car className="h-4 w-4" />;
  }
};

const getCourseLabel = (courseType: string) => {
  switch (courseType?.toLowerCase()) {
    case "auto":
      return "Car";
    case "moto":
      return "Motorcycle";
    case "scooter":
      return "Scooter";
    default:
      return courseType?.toUpperCase() || "Course";
  }
};

export default function StudentDashboard() {
  const [, setLocation] = useLocation();
  const { student, isLoading: authLoading, isAuthenticated } = useStudentAuth();
  const { courses, selectedCourse, selectCourse, hasMultipleCourses, isLoading: coursesLoading } = useSelectedCourse();

  const { data: dashboardData, isLoading: dashboardLoading } = useQuery<DashboardData>({
    queryKey: ["/api/student/dashboard"],
    enabled: isAuthenticated,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });

  const { data: phaseProgressData, isLoading: phaseLoading } = useQuery<PhaseProgressData>({
    queryKey: ["/api/student/phase-progress"],
    enabled: isAuthenticated,
  });

  if (!authLoading && !isAuthenticated) {
    setLocation("/student/login");
    return null;
  }

  if (authLoading || dashboardLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#ECC462] mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  if (!dashboardData) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-gray-700 font-medium text-lg">Unable to load dashboard</p>
          <Button 
            className="mt-4 bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111]"
            onClick={() => window.location.reload()}
            data-testid="button-retry"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const studentData = dashboardData.student;

  return (
    <div className="space-y-8">
      <div className="bg-white border border-gray-200 rounded-md shadow-sm">
        <div className="px-6 py-8">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900" data-testid="text-welcome">
              Welcome back, {studentData.firstName}!
            </h1>
          </div>
          <p className="mt-1 text-sm sm:text-base text-gray-600">
            Track your progress and manage your driving education
          </p>
          
          {hasMultipleCourses && courses.length > 0 && (
            <div className="mt-6">
              <Tabs 
                value={selectedCourse?.id?.toString() || ""} 
                onValueChange={(value) => selectCourse(parseInt(value))}
                className="w-full"
              >
                <TabsList className="bg-gray-100 p-1">
                  {courses.map((course) => (
                    <TabsTrigger
                      key={course.id}
                      value={course.id.toString()}
                      className="flex items-center gap-2 data-[state=active]:bg-[#ECC462] data-[state=active]:text-[#111111] rounded-sm"
                      data-testid={`tab-course-${course.courseType}`}
                    >
                      {getCourseIcon(course.courseType)}
                      <span>{getCourseLabel(course.courseType)}</span>
                      {course.status === "active" && (
                        <Badge variant="outline" className="ml-1 text-xs py-0 px-1.5 border-[#ECC462] bg-[#ECC462]/10 text-[#111111]">Active</Badge>
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          )}
        </div>
      </div>

      {/* Book a Driving Session */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Book a Driving Session</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Option A: Program session */}
          <button
            onClick={() => setLocation("/student/book")}
            className="group text-left bg-white border border-gray-200 rounded-md shadow-sm p-6 hover:border-[#ECC462] hover:shadow-md transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[#ECC462]"
            data-testid="button-book-program-session"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="p-3 bg-[#ECC462]/15 rounded-md border-l-4 border-[#ECC462]">
                <BookOpen className="h-6 w-6 text-[#111111]" />
              </div>
              <ArrowRight className="h-5 w-5 text-gray-300 group-hover:text-[#ECC462] transition-colors mt-1" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">Book a Program Session</h3>
            <p className="text-sm text-gray-500 mb-3">
              Book a driving lesson that is part of your course — no extra charge. Phase rules apply.
            </p>
            <span className="inline-flex items-center text-xs font-semibold text-[#111111] bg-[#ECC462]/20 px-2 py-1 rounded">
              Included in your program
            </span>
          </button>

          {/* Option B: Extra lesson */}
          <button
            onClick={() => setLocation("/student/extra-lessons")}
            className="group text-left bg-white border border-gray-200 rounded-md shadow-sm p-6 hover:border-gray-400 hover:shadow-md transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-gray-400"
            data-testid="button-book-extra-lesson"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="p-3 bg-gray-100 rounded-md border-l-4 border-[#111111]">
                <CreditCard className="h-6 w-6 text-[#111111]" />
              </div>
              <ArrowRight className="h-5 w-5 text-gray-300 group-hover:text-gray-700 transition-colors mt-1" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">Book an Extra Lesson</h3>
            <p className="text-sm text-gray-500 mb-3">
              Book an additional driving session outside of your course program. Payment required at time of booking.
            </p>
            <span className="inline-flex items-center text-xs font-semibold text-gray-600 bg-gray-100 px-2 py-1 rounded">
              Extra charge applies
            </span>
          </button>
        </div>
      </div>

      {/* Course Progress */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
          My Course Progress
        </h2>
        <div className="bg-white border border-gray-200 rounded-md shadow-sm p-6">
          {phaseLoading ? (
            <PhaseProgressTrackerSkeleton />
          ) : phaseProgressData ? (
            <PhaseProgressTracker phaseData={phaseProgressData} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
