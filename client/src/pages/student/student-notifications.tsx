import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Bell, Mail, MessageSquare, Calendar, CreditCard, RefreshCw, ArrowLeft } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";

interface NotificationPreferences {
  emailNotificationsEnabled: boolean;
  smsNotificationsEnabled: boolean;
  notifyUpcomingClasses: boolean;
  notifyScheduleChanges: boolean;
  notifyPaymentReceipts: boolean;
}

export default function StudentNotifications() {
  const { toast } = useToast();

  // Fetch current notification preferences
  const { data: preferences, isLoading } = useQuery<NotificationPreferences>({
    queryKey: ["/api/student/notifications/preferences"],
  });

  const [localPreferences, setLocalPreferences] = useState<NotificationPreferences>({
    emailNotificationsEnabled: true,
    smsNotificationsEnabled: false,
    notifyUpcomingClasses: true,
    notifyScheduleChanges: true,
    notifyPaymentReceipts: true,
  });

  // Update local state when preferences are loaded
  useEffect(() => {
    if (preferences) {
      setLocalPreferences(preferences);
    }
  }, [preferences]);

  // Mutation to update preferences
  const updatePreferencesMutation = useMutation({
    mutationFn: async (updates: Partial<NotificationPreferences>) => {
      return await apiRequest("PATCH", "/api/student/notifications/preferences", updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/notifications/preferences"] });
      toast({
        title: "Preferences saved",
        description: "Your notification preferences have been updated.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update notification preferences. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleToggle = (field: keyof NotificationPreferences, value: boolean) => {
    const newPreferences = { ...localPreferences, [field]: value };
    setLocalPreferences(newPreferences);
    updatePreferencesMutation.mutate({ [field]: value });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen" data-testid="loading-notifications">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#ECC462]"></div>
      </div>
    );
  }

  const currentPrefs = preferences || localPreferences;

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-md shadow-sm p-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <Link href="/student/classes">
              <Button 
                variant="ghost" 
                size="icon"
                className="text-gray-600 hover:text-gray-900"
                data-testid="button-back-to-dashboard"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <div className="bg-gray-50 rounded-md p-2 border border-gray-100">
                <Bell className="h-6 w-6 text-[#ECC462]" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Notifications & Reminders</h1>
                <p className="text-sm text-gray-600">Manage how and when you receive updates</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* Email Notifications Card */}
        <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-gray-400" />
              <CardTitle className="text-lg font-semibold text-gray-900">Email Notifications</CardTitle>
            </div>
            <CardDescription>
              Receive updates and reminders via email
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="email-enabled" className="text-base font-medium text-gray-900">
                  Enable Email Notifications
                </Label>
                <p className="text-sm text-gray-500">
                  Master toggle for all email notifications
                </p>
              </div>
              <Switch
                id="email-enabled"
                data-testid="toggle-email-enabled"
                checked={currentPrefs.emailNotificationsEnabled}
                onCheckedChange={(checked) => handleToggle('emailNotificationsEnabled', checked)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Notification Types Card */}
        <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold text-gray-900">Notification Types</CardTitle>
            <CardDescription>
              Choose which events trigger notifications
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Upcoming Classes */}
            <div className={`flex items-center justify-between ${!currentPrefs.emailNotificationsEnabled ? 'opacity-50' : ''}`}>
              <div className="flex items-start gap-3 flex-1">
                <Calendar className="h-5 w-5 text-blue-500 mt-0.5" />
                <div className="space-y-0.5">
                  <Label htmlFor="notify-classes" className={`text-base font-medium ${!currentPrefs.emailNotificationsEnabled ? 'text-gray-400' : 'text-gray-900'}`}>
                    Upcoming Classes
                  </Label>
                  <p className={`text-sm ${!currentPrefs.emailNotificationsEnabled ? 'text-gray-400' : 'text-gray-500'}`}>
                    Get reminders 24 hours before your scheduled classes
                  </p>
                </div>
              </div>
              <Switch
                id="notify-classes"
                data-testid="toggle-notify-upcoming-classes"
                checked={currentPrefs.notifyUpcomingClasses && currentPrefs.emailNotificationsEnabled}
                onCheckedChange={(checked) => handleToggle('notifyUpcomingClasses', checked)}
                disabled={!currentPrefs.emailNotificationsEnabled}
              />
            </div>

            <Separator className="border-gray-100" />

            {/* Schedule Changes */}
            <div className={`flex items-center justify-between ${!currentPrefs.emailNotificationsEnabled ? 'opacity-50' : ''}`}>
              <div className="flex items-start gap-3 flex-1">
                <RefreshCw className="h-5 w-5 text-amber-500 mt-0.5" />
                <div className="space-y-0.5">
                  <Label htmlFor="notify-schedule" className={`text-base font-medium ${!currentPrefs.emailNotificationsEnabled ? 'text-gray-400' : 'text-gray-900'}`}>
                    Schedule Changes
                  </Label>
                  <p className={`text-sm ${!currentPrefs.emailNotificationsEnabled ? 'text-gray-400' : 'text-gray-500'}`}>
                    Be notified when classes are rescheduled or cancelled
                  </p>
                </div>
              </div>
              <Switch
                id="notify-schedule"
                data-testid="toggle-notify-schedule-changes"
                checked={currentPrefs.notifyScheduleChanges && currentPrefs.emailNotificationsEnabled}
                onCheckedChange={(checked) => handleToggle('notifyScheduleChanges', checked)}
                disabled={!currentPrefs.emailNotificationsEnabled}
              />
            </div>

            <Separator className="border-gray-100" />

            {/* Payment Receipts */}
            <div className={`flex items-center justify-between ${!currentPrefs.emailNotificationsEnabled ? 'opacity-50' : ''}`}>
              <div className="flex items-start gap-3 flex-1">
                <CreditCard className="h-5 w-5 text-green-500 mt-0.5" />
                <div className="space-y-0.5">
                  <Label htmlFor="notify-payments" className={`text-base font-medium ${!currentPrefs.emailNotificationsEnabled ? 'text-gray-400' : 'text-gray-900'}`}>
                    Payment Receipts
                  </Label>
                  <p className={`text-sm ${!currentPrefs.emailNotificationsEnabled ? 'text-gray-400' : 'text-gray-500'}`}>
                    Receive confirmation emails when payments are processed
                  </p>
                </div>
              </div>
              <Switch
                id="notify-payments"
                data-testid="toggle-notify-payment-receipts"
                checked={currentPrefs.notifyPaymentReceipts && currentPrefs.emailNotificationsEnabled}
                onCheckedChange={(checked) => handleToggle('notifyPaymentReceipts', checked)}
                disabled={!currentPrefs.emailNotificationsEnabled}
              />
            </div>
          </CardContent>
        </Card>

        {/* SMS Notifications Card (Future Feature) */}
        <Card className="bg-gray-50/50 border border-gray-200 rounded-md shadow-none opacity-60">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-gray-400" />
              <CardTitle className="text-lg font-semibold text-gray-400">SMS Notifications</CardTitle>
            </div>
            <CardDescription className="text-gray-400">
              Receive text message reminders (Coming Soon)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="sms-enabled" className="text-base font-medium text-gray-400">
                  Enable SMS Notifications
                </Label>
                <p className="text-sm text-gray-400">
                  Master toggle for all SMS notifications
                </p>
              </div>
              <Switch
                id="sms-enabled"
                data-testid="toggle-sms-enabled"
                checked={false}
                disabled
              />
            </div>
          </CardContent>
        </Card>

        {/* Info Card */}
        <Card className="bg-blue-50/30 border border-blue-100 rounded-md shadow-none">
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <Bell className="h-5 w-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-blue-900">
                  Stay Informed
                </p>
                <p className="text-sm text-blue-700 leading-relaxed">
                  Enabling notifications helps you stay on top of your driving lessons, 
                  never miss important schedule changes, and keep track of your payments. 
                  You can adjust these settings anytime.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
