import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Users, GraduationCap, Car, Calendar, TrendingUp, LogOut, ChevronRight, RefreshCw, Bell, Mail, MessageSquare } from "lucide-react";
import { useLocation, Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { NotificationCenter } from "@/components/notification-center";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";

interface NotificationPref {
  notificationType: string;
  emailEnabled: boolean;
  inAppEnabled: boolean;
}

const PREF_LABELS: Record<string, { label: string; description: string }> = {
  upcoming_class: { label: "Lesson Reminders", description: "Get notified before upcoming theory and driving classes" },
  schedule_change: { label: "Schedule Changes", description: "Alerts when classes are rescheduled or cancelled" },
  payment_due: { label: "Payment Reminders", description: "Notifications about upcoming or overdue payments" },
  payment_received: { label: "Payment Confirmations", description: "Receipts and confirmations for completed payments" },
  policy_override: { label: "General School Info", description: "Important announcements and updates from the school" },
};

export default function ParentDashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [localPrefs, setLocalPrefs] = useState<NotificationPref[]>([]);

  const { data: parentInfo, isLoading } = useQuery({
    queryKey: ["/api/parent/me"],
    queryFn: async () => {
      const response = await fetch("/api/parent/me", {
        credentials: "include",
      });
      if (!response.ok) {
        if (response.status === 401) {
          setLocation("/parent/login");
          return null;
        }
        throw new Error("Failed to fetch parent info");
      }
      return response.json();
    },
  });

  const { data: notifPrefs, isLoading: prefsLoading } = useQuery<NotificationPref[]>({
    queryKey: ["/api/parent/notification-preferences"],
    queryFn: async () => {
      const response = await fetch("/api/parent/notification-preferences", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch preferences");
      return response.json();
    },
  });

  useEffect(() => {
    if (notifPrefs) {
      setLocalPrefs(notifPrefs);
    }
  }, [notifPrefs]);

  const updatePrefsMutation = useMutation({
    mutationFn: async (preferences: NotificationPref[]) => {
      await apiRequest("PUT", "/api/parent/notification-preferences", { preferences });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parent/notification-preferences"] });
      toast({ title: "Preferences saved", description: "Your notification settings have been updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save preferences. Please try again.", variant: "destructive" });
    },
  });

  const handleToggle = (notificationType: string, channel: "emailEnabled" | "inAppEnabled") => {
    const updated = localPrefs.map((p) =>
      p.notificationType === notificationType ? { ...p, [channel]: !p[channel] } : p
    );
    setLocalPrefs(updated);
    updatePrefsMutation.mutate(updated);
  };

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/parent/logout", {});
      await queryClient.invalidateQueries({ queryKey: ["/api/parent/me"] });
      setLocation("/parent/login");
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  const handleSwitchStudent = () => {
    setLocation("/parent/select-student");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-[#ECC462]" />
      </div>
    );
  }

  if (!parentInfo) {
    return null;
  }

  const selectedStudent = parentInfo.selectedStudent;
  const hasMultipleStudents = parentInfo.linkedStudents?.length > 1;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#111111] text-white">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 bg-[#ECC462] rounded-md flex items-center justify-center">
                <Users className="h-6 w-6 text-[#111111]" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Parent Portal</h1>
                <p className="text-sm text-gray-400">
                  Welcome, {parentInfo.firstName} {parentInfo.lastName}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <NotificationCenter userType="parent" />
              {hasMultipleStudents && (
                <Button
                  variant="outline"
                  className="border-[#ECC462] text-[#ECC462] hover:bg-[#ECC462] hover:text-[#111111] rounded-md"
                  onClick={handleSwitchStudent}
                  data-testid="button-switch-student"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Switch Student
                </Button>
              )}
              <Button
                variant="ghost"
                className="text-gray-400 hover:text-white hover:bg-white/10 rounded-md"
                onClick={handleLogout}
                data-testid="button-logout"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {selectedStudent ? (
          <>
            <Card className="mb-8 bg-white border border-gray-200 rounded-md shadow-sm border-l-4 border-l-[#ECC462]">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-16 w-16 bg-gray-100 rounded-md flex items-center justify-center">
                      <GraduationCap className="h-8 w-8 text-[#111111]" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900">
                        {selectedStudent.firstName} {selectedStudent.lastName}
                      </h2>
                      <div className="flex items-center gap-2 mt-1">
                        <Car className="h-4 w-4 text-gray-500" />
                        <span className="text-gray-600 capitalize">{selectedStudent.courseType} Course</span>
                        <Badge variant="outline" className="text-gray-600 border-gray-200">
                          {selectedStudent.status}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-500 uppercase tracking-wider font-semibold">Progress</div>
                    <div className="text-4xl font-bold text-gray-900">{selectedStudent.progress}%</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              <Card className="shadow-sm border-gray-200 rounded-md">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-[#ECC462]" />
                    Upcoming Classes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-600 mb-4">View scheduled classes and sessions</p>
                  <Button className="w-full bg-[#111111] hover:bg-[#111111]/90 text-white rounded-md">
                    View Schedule
                    <ChevronRight className="h-4 w-4 ml-2" />
                  </Button>
                </CardContent>
              </Card>

              <Card className="shadow-sm border-gray-200 rounded-md">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-green-500" />
                    Progress & Evaluations
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-600 mb-4">Track learning progress and results</p>
                  <Button className="w-full bg-[#111111] hover:bg-[#111111]/90 text-white rounded-md">
                    View Progress
                    <ChevronRight className="h-4 w-4 ml-2" />
                  </Button>
                </CardContent>
              </Card>

              <Card className="shadow-sm border-gray-200 rounded-md">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <Users className="h-5 w-5 text-blue-500" />
                    Account Settings
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-600 mb-4">Manage your parent account</p>
                  <Button variant="outline" className="w-full border-gray-200 text-gray-700 rounded-md">
                    Settings
                    <ChevronRight className="h-4 w-4 ml-2" />
                  </Button>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-white border-gray-200 rounded-md shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Bell className="h-5 w-5 text-[#ECC462]" />
                  Notification Preferences
                </CardTitle>
                <p className="text-sm text-gray-500">Choose how you'd like to be notified about your student's activities</p>
              </CardHeader>
              <CardContent>
                {prefsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-[#ECC462]" />
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 gap-y-1 items-center">
                      <div />
                      <div className="flex items-center gap-1.5 text-sm font-medium text-gray-500">
                        <Mail className="h-4 w-4" />
                        Email
                      </div>
                      <div className="flex items-center gap-1.5 text-sm font-medium text-gray-500">
                        <MessageSquare className="h-4 w-4" />
                        Text
                      </div>
                    </div>

                    {localPrefs.map((pref) => {
                      const info = PREF_LABELS[pref.notificationType];
                      if (!info) return null;
                      return (
                        <div
                          key={pref.notificationType}
                          className="grid grid-cols-[1fr_auto_auto] gap-x-6 items-center py-3 border-b last:border-b-0"
                        >
                          <div>
                            <Label className="text-sm font-medium">{info.label}</Label>
                            <p className="text-sm text-gray-500">{info.description}</p>
                          </div>
                          <Switch
                            checked={pref.emailEnabled}
                            onCheckedChange={() => handleToggle(pref.notificationType, "emailEnabled")}
                            disabled={updatePrefsMutation.isPending}
                          />
                          <Switch
                            checked={pref.inAppEnabled}
                            onCheckedChange={() => handleToggle(pref.notificationType, "inAppEnabled")}
                            disabled={updatePrefsMutation.isPending}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          <Card className="text-center py-12">
            <CardContent>
              <Users className="h-16 w-16 mx-auto text-gray-400 mb-4" />
              <h2 className="text-xl font-semibold text-gray-700 mb-2">
                No Student Selected
              </h2>
              <p className="text-gray-500 mb-6">
                Please select a student to view their information
              </p>
              <Button
                className="bg-[#ECC462] text-[#111111] hover:bg-[#ECC462]/90"
                onClick={handleSwitchStudent}
              >
                Select Student
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
