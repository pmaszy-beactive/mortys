import { Switch, Route, useLocation } from "wouter";
import { useInstructorAuth } from "@/hooks/useInstructorAuth";
import { useEffect } from "react";

import InstructorDashboard from "./instructor-dashboard";
import InstructorProfile from "./instructor-profile";
import InstructorStudents from "./instructor-students";
import InstructorSchedule from "./instructor-schedule";
import InstructorEvaluations from "./instructor-evaluations";

export default function InstructorApp() {
  const { isAuthenticated, isLoading } = useInstructorAuth();
  const [location, setLocation] = useLocation();

  console.log("Instructor Router state:", { isAuthenticated, isLoading });
  console.log("Current path:", window.location.pathname);

  useEffect(() => {
    if (!isLoading && !isAuthenticated && location !== "/instructor/login") {
      console.log("Not authenticated, redirecting to login");
      setLocation("/instructor/login");
    }
  }, [isAuthenticated, isLoading, location, setLocation]);

  if (isLoading) {
    return (
      <div className="h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading instructor auth...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Will redirect via useEffect
  }

  console.log("Authenticated, showing dashboard");
  return (
    <Switch>
      <Route path="/instructor" component={InstructorDashboard} />
      <Route path="/instructor/dashboard" component={InstructorDashboard} />
      <Route path="/instructor/profile" component={InstructorProfile} />
      <Route path="/instructor/students" component={InstructorStudents} />
      <Route path="/instructor/evaluations" component={InstructorEvaluations} />
      <Route path="/instructor/schedule" component={InstructorSchedule} />
    </Switch>
  );
}