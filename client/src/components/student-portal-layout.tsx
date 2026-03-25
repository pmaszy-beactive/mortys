import StudentSidebar from "./student-sidebar";
import ImpersonationBanner from "./impersonation-banner";

interface StudentPortalLayoutProps {
  children: React.ReactNode;
}

export default function StudentPortalLayout({ children }: StudentPortalLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <ImpersonationBanner />
      <div className="flex">
        {/* Sidebar */}
        <StudentSidebar />
        
        {/* Main Content Area */}
        <div className="flex-1 min-h-screen md:ml-0">
          {/* Mobile top spacing for fixed header */}
          <div className="md:hidden h-16"></div>
          
          {/* Scrollable content */}
          <main className="p-4 md:p-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
