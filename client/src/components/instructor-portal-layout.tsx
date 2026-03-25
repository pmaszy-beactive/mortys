import { useEffect } from "react";
import { useLocation } from "wouter";
import { useInstructorAuth } from "@/hooks/useInstructorAuth";
import InstructorSidebar from "./instructor-sidebar";
import ImpersonationBanner from "./impersonation-banner";

interface InstructorPortalLayoutProps {
  children: React.ReactNode;
}

export default function InstructorPortalLayout({ children }: InstructorPortalLayoutProps) {
  const { isLoading, isAuthenticated } = useInstructorAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation("/instructor/login");
    }
  }, [isLoading, isAuthenticated, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#ECC462] mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <ImpersonationBanner />
      <div className="flex">
        <InstructorSidebar />
        <div className="flex-1 min-h-screen md:ml-0">
          <div className="md:hidden h-24"></div>
          <main>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
