import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import Layout from "@/components/layout";
import Landing from "@/pages/landing";
import Home from "@/pages/home";
import Dashboard from "@/pages/dashboard";
import Students from "@/pages/students";
import StudentProfile from "@/pages/student-profile";
import Instructors from "@/pages/instructors";
import InstructorProfile from "@/pages/instructor-profile";
import Locations from "@/pages/locations";
import Vehicles from "@/pages/vehicles";
import Scheduling from "@/pages/scheduling";
import Evaluations from "@/pages/evaluations";
import Communications from "@/pages/communications";
import Reports from "@/pages/reports";
import RegistrationReports from "@/pages/registration-reports";
import ZoomIntegration from "@/pages/zoom-integration";
import SchoolPermits from "@/pages/school-permits";
import TransferCredits from "@/pages/transfer-credits";
import DataMigration from "@/pages/data-migration";
import Analytics from "@/pages/analytics";
import Settings from "@/pages/settings";
import BookingPolicies from "@/pages/booking-policies";
import OverrideAuditLogs from "@/pages/override-audit-logs";
import DocumentVerification from "@/pages/document-verification";
import PaymentReconciliation from "@/pages/payment-reconciliation";
import TransactionAudit from "@/pages/transaction-audit";
import ChangeRequests from "@/pages/change-requests";
import NotFound from "@/pages/not-found";
import InstructorInvite from "@/pages/instructor-invite";
import InstructorLogin from "@/pages/instructor/instructor-login";
import InstructorDashboard from "@/pages/instructor/instructor-dashboard";
import InstructorOwnProfile from "@/pages/instructor/instructor-profile";
import InstructorStudents from "@/pages/instructor/instructor-students";
import InstructorSchedule from "@/pages/instructor/instructor-schedule";
import InstructorEvaluations from "@/pages/instructor/instructor-evaluations";
import InstructorHours from "@/pages/instructor/instructor-hours";
import InstructorStudentDetail from "@/pages/instructor/instructor-student-detail";
import LessonCheckIn from "@/pages/instructor/lesson-check-in";
import StudentInvite from "@/pages/student-invite";
import ParentInvite from "@/pages/parent/parent-invite";
import StudentLogin from "@/pages/student/student-login";
import StudentSignup from "@/pages/student/student-signup";
import StudentOnboarding from "@/pages/student/student-onboarding";
import StudentForgotPassword from "@/pages/student/student-forgot-password";
import StudentResetPassword from "@/pages/student/student-reset-password";
import StudentOwnProfile from "@/pages/student/student-profile";
import StudentClasses from "@/pages/student/student-classes";
import StudentParents from "@/pages/student/student-parents";
import StudentBilling from "@/pages/student/student-billing";
import StudentEvaluations from "@/pages/student/student-evaluations";
import StudentNotifications from "@/pages/student/student-notifications";
import ExtraLessons from "@/pages/student/extra-lessons";
import StudentPortalLayout from "@/components/student-portal-layout";
import InstructorPortalLayout from "@/components/instructor-portal-layout";
import AdminLogin from "@/pages/admin-login";
import ParentLogin from "@/pages/parent/parent-login";
import ParentSelectStudent from "@/pages/parent/select-student";
import ParentDashboard from "@/pages/parent/parent-dashboard";

function Router() {
  const { isAuthenticated, isLoading, user } = useAuth();

  console.log("Router state:", { isAuthenticated, isLoading, user: !!user });

  if (isLoading) {
    return (
      <div className="h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <Switch>
      {/* Instructor Invite - Public route */}
      <Route path="/instructor-invite/:token" component={InstructorInvite} />
      
      {/* Student Invite - Public route */}
      <Route path="/student-invite/:token" component={StudentInvite} />
      
      {/* Instructor Login - Public route */}
      <Route path="/instructor/login" component={InstructorLogin} />
      <Route path="/instructor-login" component={InstructorLogin} />
      
      {/* Instructor Portal - Protected routes with layout */}
      <Route path="/instructor">
        <InstructorPortalLayout><InstructorSchedule /></InstructorPortalLayout>
      </Route>
      <Route path="/instructor/dashboard">
        <InstructorPortalLayout><InstructorSchedule /></InstructorPortalLayout>
      </Route>
      <Route path="/instructor/profile">
        <InstructorPortalLayout><InstructorOwnProfile /></InstructorPortalLayout>
      </Route>
      <Route path="/instructor/students/:id">
        {(params: { id: string }) => (
          <InstructorPortalLayout>
            <InstructorStudentDetail studentId={parseInt(params.id)} />
          </InstructorPortalLayout>
        )}
      </Route>
      <Route path="/instructor/students">
        <InstructorPortalLayout><InstructorStudents /></InstructorPortalLayout>
      </Route>
      <Route path="/instructor/schedule">
        <InstructorPortalLayout><InstructorSchedule /></InstructorPortalLayout>
      </Route>
      <Route path="/instructor/lesson/:classId/check-in">
        <LessonCheckIn />
      </Route>
      <Route path="/instructor/evaluations">
        <InstructorPortalLayout><InstructorEvaluations /></InstructorPortalLayout>
      </Route>
      <Route path="/instructor/hours">
        <InstructorPortalLayout><InstructorHours /></InstructorPortalLayout>
      </Route>
      
      {/* Student Portal - Public routes */}
      <Route path="/student-login" component={StudentLogin} />
      <Route path="/student/login" component={StudentLogin} />
      <Route path="/student/signup" component={StudentSignup} />
      <Route path="/student/onboarding/:registrationId" component={StudentOnboarding} />
      <Route path="/student/forgot-password" component={StudentForgotPassword} />
      <Route path="/student/reset-password/:token" component={StudentResetPassword} />
      
      {/* Student Portal - Protected routes with layout */}
      <Route path="/student/dashboard">
        <StudentPortalLayout><StudentClasses /></StudentPortalLayout>
      </Route>
      <Route path="/student/profile">
        <StudentPortalLayout><StudentOwnProfile /></StudentPortalLayout>
      </Route>
      <Route path="/student/classes">
        <StudentPortalLayout><StudentClasses /></StudentPortalLayout>
      </Route>
      <Route path="/student/book">
        <StudentPortalLayout><StudentClasses /></StudentPortalLayout>
      </Route>
      <Route path="/student/parents">
        <StudentPortalLayout><StudentParents /></StudentPortalLayout>
      </Route>
      <Route path="/student/billing">
        <StudentPortalLayout><StudentBilling /></StudentPortalLayout>
      </Route>
      <Route path="/student/evaluations">
        <StudentPortalLayout><StudentEvaluations /></StudentPortalLayout>
      </Route>
      <Route path="/student/notifications">
        <StudentPortalLayout><StudentNotifications /></StudentPortalLayout>
      </Route>
      <Route path="/student/extra-lessons">
        <StudentPortalLayout><ExtraLessons /></StudentPortalLayout>
      </Route>
      
      {/* Parent Portal - Public routes */}
      <Route path="/parent-invite/:token" component={ParentInvite} />
      <Route path="/parent/login" component={ParentLogin} />
      <Route path="/parent-login" component={ParentLogin} />
      <Route path="/parent/select-student" component={ParentSelectStudent} />
      <Route path="/parent/dashboard" component={ParentDashboard} />
      
      {/* Admin Login - Public route */}
      <Route path="/admin/login" component={AdminLogin} />
      
      {!isAuthenticated ? (
        <Route path="*" component={Landing} />
      ) : (
        <Layout>
          <Route path="/" component={Dashboard} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/students" component={Students} />
          <Route path="/students/:id" component={StudentProfile} />
          <Route path="/instructors" component={Instructors} />
          <Route path="/instructors/:id" component={InstructorProfile} />
          <Route path="/locations" component={Locations} />
          <Route path="/vehicles" component={Vehicles} />
          <Route path="/scheduling" component={Scheduling} />
          <Route path="/evaluations" component={Evaluations} />
          <Route path="/change-requests" component={ChangeRequests} />
          <Route path="/communications" component={Communications} />
          <Route path="/reports" component={Reports} />
          <Route path="/registration-reports" component={RegistrationReports} />
          <Route path="/analytics" component={Analytics} />
          <Route path="/document-verification" component={DocumentVerification} />
          <Route path="/zoom" component={ZoomIntegration} />
          <Route path="/school-permits" component={SchoolPermits} />
          <Route path="/transfer-credits" component={TransferCredits} />
          <Route path="/data-migration" component={DataMigration} />
          <Route path="/settings" component={Settings} />
          <Route path="/booking-policies" component={BookingPolicies} />
          <Route path="/override-audit-logs" component={OverrideAuditLogs} />
          <Route path="/payment-reconciliation" component={PaymentReconciliation} />
          <Route path="/transaction-audit" component={TransactionAudit} />
        </Layout>
      )}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
