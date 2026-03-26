import { useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  Car, 
  Calendar, 
  Award, 
  Users, 
  DollarSign, 
  Bell,
  User, 
  Menu, 
  X, 
  LogOut,
  Bike,
  ChevronDown,
  GraduationCap,
  Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useStudentAuth } from "@/hooks/useStudentAuth";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { StudentCourse } from "@shared/schema";
import { NotificationCenter } from "@/components/notification-center";
import versionData from "../../../version.json";

const version: string = versionData.version;

const navigation = [
  { name: "My Classes", href: "/student/classes", icon: Calendar },
  { name: "Extra Lessons", href: "/student/extra-lessons", icon: Sparkles },
  { name: "Evaluations", href: "/student/evaluations", icon: Award },
  { name: "Parents & Guardians", href: "/student/parents", icon: Users },
  { name: "Billing & Payments", href: "/student/billing", icon: DollarSign },
  { name: "Notifications", href: "/student/notifications", icon: Bell },
  { name: "My Profile", href: "/student/profile", icon: User },
];

export default function StudentSidebar() {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { toast } = useToast();
  const { student } = useStudentAuth();

  const { data: studentCourses = [] } = useQuery<StudentCourse[]>({
    queryKey: ["/api/student/courses"],
    enabled: !!student,
  });

  const closeMobileMenu = () => setMobileMenuOpen(false);

  const getCourseIcon = (courseType: string) => {
    switch (courseType) {
      case "moto":
      case "scooter":
        return Bike;
      default:
        return Car;
    }
  };

  const getCourseLabel = (courseType: string) => {
    switch (courseType) {
      case "moto": return "Motorcycle";
      case "scooter": return "Scooter";
      default: return "Automobile";
    }
  };

  const logoutMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/student/logout", undefined);
    },
    onSuccess: () => {
      toast({
        title: "Logged out successfully",
        description: "You have been logged out of your account.",
      });
      window.location.href = '/student/login';
    },
    onError: () => {
      window.location.href = '/student/login';
    },
  });

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  return (
    <>
      {/* Mobile menu button */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-[#ECC462] rounded-lg flex items-center justify-center mr-2">
              <Car className="text-[#111111] h-5 w-5" />
            </div>
            <h1 className="text-lg font-bold text-gray-900">Morty's Driving School</h1>
          </div>
          <div className="flex items-center gap-1">
            <NotificationCenter userType="student" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2"
              data-testid="button-mobile-menu"
            >
              {mobileMenuOpen ? (
                <X className="h-6 w-6" />
              ) : (
                <Menu className="h-6 w-6" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div 
          className="md:hidden fixed inset-0 z-40 bg-black bg-opacity-50"
          onClick={closeMobileMenu}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 transform transition-transform duration-300 ease-in-out
        md:relative md:translate-x-0 md:inset-auto
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className="flex flex-col h-screen md:h-full">
          {/* Logo and Brand - Desktop */}
          <div className="hidden md:flex items-center justify-between flex-shrink-0 px-4 py-5 border-b border-gray-100">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-[#ECC462] rounded-md flex items-center justify-center shadow-sm">
                <Car className="text-[#111111] h-6 w-6" />
              </div>
              <div className="ml-3">
                <h1 className="text-xl font-bold text-gray-900">Morty's</h1>
                <p className="text-sm text-gray-500">Student Portal</p>
              </div>
            </div>
            <NotificationCenter userType="student" />
          </div>

          {/* Mobile top spacing */}
          <div className="md:hidden h-16"></div>

          {/* Course Switcher - Only show if student has multiple courses */}
          {studentCourses.length > 0 && (
            <div className="px-3 py-3 border-b border-gray-100" data-testid="section-courses">
              <p className="text-xs font-medium text-gray-500 uppercase mb-2 px-1">My Courses</p>
              {studentCourses.length === 1 ? (
                <div className="flex items-center gap-2 px-2 py-2 bg-[#ECC462]/10 rounded-lg" data-testid={`card-course-${studentCourses[0].id}`}>
                  {(() => { const CourseIcon = getCourseIcon(studentCourses[0].courseType); return <CourseIcon className="h-4 w-4 text-[#111111]" />; })()}
                  <span className="text-sm font-medium text-[#111111]" data-testid={`text-course-type-${studentCourses[0].id}`}>
                    {getCourseLabel(studentCourses[0].courseType)}
                  </span>
                  <Badge className={`ml-auto text-xs ${studentCourses[0].status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`} data-testid={`badge-course-status-${studentCourses[0].id}`}>
                    {studentCourses[0].status}
                  </Badge>
                </div>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full justify-between text-sm h-9" data-testid="button-course-switcher">
                      <div className="flex items-center gap-2">
                        <GraduationCap className="h-4 w-4" />
                        <span>{studentCourses.length} Courses</span>
                      </div>
                      <ChevronDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    {studentCourses.map((course) => {
                      const CourseIcon = getCourseIcon(course.courseType);
                      return (
                        <DropdownMenuItem key={course.id} className="flex items-center justify-between" data-testid={`menu-item-course-${course.id}`}>
                          <div className="flex items-center gap-2">
                            <CourseIcon className="h-4 w-4" />
                            <span data-testid={`text-course-type-${course.id}`}>{getCourseLabel(course.courseType)}</span>
                          </div>
                          <Badge className={`text-xs ${course.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`} data-testid={`badge-course-progress-${course.id}`}>
                            {course.progress}%
                          </Badge>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}

          {/* Navigation Menu */}
          <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
            {navigation.map((item) => {
              const isActive = location === item.href;
              const Icon = item.icon;
              
              return (
                <Link 
                  key={item.name} 
                  href={item.href} 
                  onClick={closeMobileMenu}
                >
                  <div
                    className={`
                      flex items-center px-3 py-2.5 text-sm font-medium rounded-md transition-all duration-150
                      ${isActive 
                        ? 'bg-[#ECC462] text-[#111111] border-l-4 border-[#111111]' 
                        : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                      }
                    `}
                    data-testid={`nav-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <Icon className="mr-3 flex-shrink-0 h-5 w-5" />
                    {item.name}
                  </div>
                </Link>
              );
            })}
          </nav>

          {/* User Profile & Logout */}
          <div className="flex-shrink-0 border-t border-gray-200 bg-gray-50">
            <div className="p-4">
              <div className="flex items-center mb-3">
                <div className="w-10 h-10 bg-[#ECC462] rounded-full flex items-center justify-center flex-shrink-0 shadow-sm">
                  <User className="text-[#111111] h-5 w-5" />
                </div>
                <div className="ml-3 min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate" data-testid="text-student-name">
                    {student?.firstName} {student?.lastName}
                  </p>
                  <p className="text-xs text-gray-500 truncate" data-testid="text-student-email">
                    {student?.email}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogout}
                disabled={logoutMutation.isPending}
                className="w-full justify-center border-gray-200 text-gray-700 hover:bg-gray-100"
                data-testid="button-logout"
              >
                <LogOut className="h-4 w-4 mr-2" />
                {logoutMutation.isPending ? "Logging out..." : "Logout"}
              </Button>
              <p className="mt-3 text-[10px] text-gray-400 font-mono tracking-wide text-center" data-testid="text-version-student">© Morty's Driving School · <span>{version}</span></p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
