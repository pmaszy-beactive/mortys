import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { 
  Calendar, 
  Users, 
  FileText, 
  User,
  LogOut,
  Menu,
  X,
  GraduationCap,
  Clock
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { GlobalSearchBar } from "@/components/global-search-bar";
import versionData from "../../../version.json";

const version: string = versionData.version;

interface InstructorData {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
}

export default function InstructorSidebar() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { data: instructor } = useQuery<InstructorData>({
    queryKey: ["/api/instructor/me"],
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
    },
    onSuccess: () => {
      toast({
        title: "Logged out successfully",
        description: "You have been logged out of your account.",
      });
      window.location.href = "/instructor/login";
    },
    onError: () => {
      window.location.href = "/instructor/login";
    },
  });

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
  };

  const navigationItems = [
    { path: "/instructor/schedule", label: "My Schedule", icon: Calendar },
    { path: "/instructor/students", label: "My Students", icon: Users },
    { path: "/instructor/evaluations", label: "Evaluations", icon: FileText },
    { path: "/instructor/hours", label: "Hours & Payroll", icon: Clock },
    { path: "/instructor/profile", label: "My Profile", icon: User },
  ];

  const isActive = (path: string) => location === path;

  return (
    <>
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-gray-200 px-4 py-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-[#ECC462] rounded flex items-center justify-center">
              <GraduationCap className="text-[#111111] h-5 w-5" />
            </div>
            <span className="ml-2 text-lg font-bold text-[#111111]">Morty's</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2"
            data-testid="button-mobile-menu"
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </Button>
        </div>
        <GlobalSearchBar userType="instructor" />
      </div>

      {/* Overlay for mobile */}
      {mobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={closeMobileMenu}
          data-testid="overlay-mobile-menu"
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
          <div className="hidden md:flex flex-col flex-shrink-0 px-4 py-5 border-b border-gray-100 space-y-4">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-[#ECC462] rounded flex items-center justify-center">
                <GraduationCap className="text-[#111111] h-6 w-6" />
              </div>
              <div className="ml-3">
                <h2 className="text-lg font-bold text-[#111111]">Morty's Driving</h2>
                <p className="text-xs text-gray-500">Instructor Portal</p>
              </div>
            </div>
            <GlobalSearchBar userType="instructor" />
          </div>

          {/* Mobile Header Inside Sidebar */}
          <div className="md:hidden flex items-center justify-between px-4 py-4 border-b border-gray-100">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-[#ECC462] rounded flex items-center justify-center">
                <GraduationCap className="text-[#111111] h-6 w-6" />
              </div>
              <div className="ml-3">
                <h2 className="text-lg font-bold text-[#111111]">Morty's Driving</h2>
                <p className="text-xs text-gray-500">Instructor Portal</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={closeMobileMenu}
              className="p-2"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto py-4 px-3">
            <div className="space-y-1">
              {navigationItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.path);
                return (
                  <button
                    key={item.path}
                    onClick={() => {
                      setLocation(item.path);
                      closeMobileMenu();
                    }}
                    className={`
                      w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-md transition-all duration-200
                      ${active 
                        ? 'bg-[#ECC462] text-[#111111]' 
                        : 'text-gray-700 hover:bg-gray-100 hover:text-[#111111]'
                      }
                    `}
                    data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <Icon className={`h-5 w-5 flex-shrink-0 ${active ? 'text-[#111111]' : 'text-gray-500'}`} />
                    <span className="ml-3">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>

          {/* User Profile & Logout */}
          <div className="flex-shrink-0 border-t border-gray-200 bg-gray-50">
            <div className="p-4">
              <div className="flex items-center mb-3">
                <div className="w-10 h-10 bg-[#ECC462] rounded-full flex items-center justify-center flex-shrink-0">
                  <User className="text-[#111111] h-5 w-5" />
                </div>
                <div className="ml-3 min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate" data-testid="text-instructor-name">
                    {instructor?.firstName} {instructor?.lastName}
                  </p>
                  <p className="text-xs text-gray-500 truncate" data-testid="text-instructor-email">
                    {instructor?.email}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogout}
                disabled={logoutMutation.isPending}
                className="w-full justify-center border-[#ECC462] text-[#111111] hover:bg-[#ECC462] hover:text-[#111111]"
                data-testid="button-logout"
              >
                <LogOut className="h-4 w-4 mr-2" />
                {logoutMutation.isPending ? "Logging out..." : "Logout"}
              </Button>
              <p className="mt-3 text-[10px] text-gray-400 font-mono tracking-wide text-center" data-testid="text-version-instructor">© Morty's Driving School · <span>{version}</span></p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
