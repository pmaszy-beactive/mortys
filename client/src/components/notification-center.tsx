import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Bell, Check, Calendar, CreditCard, AlertTriangle, Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface Notification {
  id: number;
  notificationId: number;
  type: string;
  title: string;
  message: string;
  payload: any;
  status: string;
  readAt: string | null;
  createdAt: string;
}

interface NotificationCenterProps {
  userType: "student" | "parent" | "admin";
}

const notificationIcons: Record<string, any> = {
  upcoming_class: Calendar,
  schedule_change: Clock,
  payment_due: CreditCard,
  payment_received: CreditCard,
  policy_override: AlertTriangle,
  class_reminder: Calendar,
  class_cancelled: X,
};

const notificationColors: Record<string, string> = {
  upcoming_class: "bg-blue-100 text-blue-600",
  schedule_change: "bg-yellow-100 text-yellow-600",
  payment_due: "bg-orange-100 text-orange-600",
  payment_received: "bg-green-100 text-green-600",
  policy_override: "bg-red-100 text-red-600",
  class_reminder: "bg-purple-100 text-purple-600",
  class_cancelled: "bg-gray-100 text-gray-600",
};

export function NotificationCenter({ userType }: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const apiPath = userType === "admin" 
    ? "/api/admin/notifications" 
    : userType === "parent" 
    ? "/api/parent/notifications" 
    : "/api/student/notifications";

  const { data: notifications = [], isLoading } = useQuery<Notification[]>({
    queryKey: [apiPath],
    refetchInterval: 60000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (deliveryId: number) => {
      const readPath = userType === "admin"
        ? `/api/admin/notifications/${deliveryId}/read`
        : userType === "parent"
        ? `/api/parent/notifications/${deliveryId}/read`
        : `/api/student/notifications/${deliveryId}/read`;
      await apiRequest("POST", readPath);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [apiPath] });
    },
    onError: (error: any) => {
      console.error("Failed to mark notification as read:", error);
      toast({
        title: "Error",
        description: "Could not update notification. Please try again.",
        variant: "destructive",
      });
    },
  });

  const unreadCount = notifications.filter(n => n.status !== "read").length;

  const handleMarkRead = (id: number) => {
    markReadMutation.mutate(id);
  };

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const markAllPath = userType === "admin"
        ? "/api/admin/notifications/mark-all-read"
        : userType === "parent"
        ? "/api/parent/notifications/mark-all-read"
        : "/api/student/notifications/mark-all-read";
      await apiRequest("POST", markAllPath);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [apiPath] });
    },
    onError: (error: any) => {
      console.error("Failed to mark all notifications as read:", error);
      toast({
        title: "Error",
        description: "Could not mark all notifications as read. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleMarkAllRead = () => {
    markAllReadMutation.mutate();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon" 
          className="relative"
          data-testid="button-notifications"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge 
              className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center bg-red-500 text-white text-xs"
              data-testid="badge-unread-count"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold">Notifications</h3>
          {unreadCount > 0 && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleMarkAllRead}
              className="text-xs"
              data-testid="button-mark-all-read"
            >
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-[300px]">
          {isLoading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              Loading...
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No notifications</p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => {
                const IconComponent = notificationIcons[notification.type] || Bell;
                const colorClass = notificationColors[notification.type] || "bg-gray-100 text-gray-600";
                const isUnread = notification.status !== "read";

                return (
                  <div
                    key={notification.id}
                    className={`p-4 hover:bg-gray-50 cursor-pointer transition-colors ${isUnread ? "bg-blue-50/50" : ""}`}
                    onClick={() => isUnread && handleMarkRead(notification.id)}
                    data-testid={`notification-item-${notification.id}`}
                  >
                    <div className="flex gap-3">
                      <div className={`p-2 rounded-full shrink-0 ${colorClass}`}>
                        <IconComponent className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm font-medium truncate ${isUnread ? "text-foreground" : "text-muted-foreground"}`}>
                            {notification.title}
                          </p>
                          {isUnread && (
                            <div className="h-2 w-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                          {notification.message}
                        </p>
                        <p className="text-xs text-muted-foreground mt-2">
                          {notification.createdAt && formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

export function NotificationPreferences({ userType }: NotificationCenterProps) {
  const apiPath = userType === "admin"
    ? "/api/admin/notification-preferences"
    : userType === "parent"
    ? "/api/parent/notification-preferences"
    : "/api/student/notification-preferences";

  const { data: preferences = [], isLoading } = useQuery<{
    notificationType: string;
    emailEnabled: boolean;
    inAppEnabled: boolean;
  }[]>({
    queryKey: [apiPath],
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: { notificationType: string; emailEnabled: boolean; inAppEnabled: boolean }[]) => {
      await apiRequest("PUT", apiPath, { preferences: updates });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [apiPath] });
    },
  });

  const notificationTypeLabels: Record<string, string> = {
    upcoming_class: "Upcoming Classes",
    schedule_change: "Schedule Changes",
    payment_due: "Payment Reminders",
    payment_received: "Payment Confirmations",
    policy_override: "Policy Override Notices",
  };

  const handleToggle = (type: string, field: "emailEnabled" | "inAppEnabled", currentValue: boolean) => {
    const updated = preferences.map(p => 
      p.notificationType === type 
        ? { ...p, [field]: !currentValue }
        : p
    );
    updateMutation.mutate(updated);
  };

  if (isLoading) {
    return <div className="text-muted-foreground">Loading preferences...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4 text-sm font-medium text-muted-foreground pb-2 border-b">
        <div>Notification Type</div>
        <div className="text-center">Email</div>
        <div className="text-center">In-App</div>
      </div>
      {preferences.map((pref) => (
        <div key={pref.notificationType} className="grid grid-cols-3 gap-4 items-center">
          <div className="text-sm">
            {notificationTypeLabels[pref.notificationType] || pref.notificationType}
          </div>
          <div className="flex justify-center">
            <Button
              variant={pref.emailEnabled ? "default" : "outline"}
              size="sm"
              onClick={() => handleToggle(pref.notificationType, "emailEnabled", pref.emailEnabled)}
              disabled={updateMutation.isPending}
              data-testid={`toggle-email-${pref.notificationType}`}
            >
              {pref.emailEnabled ? <Check className="h-4 w-4" /> : "Off"}
            </Button>
          </div>
          <div className="flex justify-center">
            <Button
              variant={pref.inAppEnabled ? "default" : "outline"}
              size="sm"
              onClick={() => handleToggle(pref.notificationType, "inAppEnabled", pref.inAppEnabled)}
              disabled={updateMutation.isPending}
              data-testid={`toggle-inapp-${pref.notificationType}`}
            >
              {pref.inAppEnabled ? <Check className="h-4 w-4" /> : "Off"}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
