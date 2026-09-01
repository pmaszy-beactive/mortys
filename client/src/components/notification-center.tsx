import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Bell, Check, Calendar, CreditCard, AlertTriangle, Clock, X, Users, UserCheck, CheckCircle2, XCircle } from "lucide-react";
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
  // Task 272: In-Car #12/13 combined-session pairing notifications.
  incar_pairing_offer: Users,
  incar_pairing_offer_expired: Clock,
  incar_pairing_confirmed: CheckCircle2,
  incar_session_confirmation: UserCheck,
  incar_pairing_broken: AlertTriangle,
  incar_pairing_deferred: AlertTriangle,
  incar_lesson_converted: Calendar,
};

const notificationColors: Record<string, string> = {
  upcoming_class: "bg-blue-100 text-blue-600",
  schedule_change: "bg-yellow-100 text-yellow-600",
  payment_due: "bg-orange-100 text-orange-600",
  payment_received: "bg-green-100 text-green-600",
  policy_override: "bg-red-100 text-red-600",
  class_reminder: "bg-purple-100 text-purple-600",
  class_cancelled: "bg-gray-100 text-gray-600",
  incar_pairing_offer: "bg-purple-100 text-purple-600",
  incar_pairing_offer_expired: "bg-gray-100 text-gray-600",
  incar_pairing_confirmed: "bg-green-100 text-green-600",
  incar_session_confirmation: "bg-green-100 text-green-600",
  incar_pairing_broken: "bg-amber-100 text-amber-600",
  incar_pairing_deferred: "bg-amber-100 text-amber-600",
  incar_lesson_converted: "bg-blue-100 text-blue-600",
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

  const respondOfferMutation = useMutation({
    mutationFn: async ({ offerId, action, notificationId }: { offerId: number; action: "accept" | "decline"; notificationId: number }) => {
      await apiRequest("POST", `/api/student/lesson-pairing/offers/${offerId}/respond`, { action });
      // Mark the notification read after responding
      const readPath = `/api/student/notifications/${notificationId}/read`;
      await apiRequest("POST", readPath);
    },
    onSuccess: (_data, { action }) => {
      queryClient.invalidateQueries({ queryKey: [apiPath] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/lesson-pairing/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/classes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/classes/available"] });
      toast({
        title: action === "accept" ? "Offer Accepted" : "Offer Declined",
        description: action === "accept"
          ? "You've accepted the In-Car 12/13 pairing offer. You're paired!"
          : "You've declined the pairing offer. You'll remain in the queue.",
        variant: "success",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Action Failed",
        description: error?.message || "Could not process your response. Please try again.",
        variant: "destructive",
      });
    },
  });

  const respondConfirmationMutation = useMutation({
    mutationFn: async ({ confirmationId, action, notificationId }: { confirmationId: number; action: "confirm" | "decline"; notificationId: number }) => {
      await apiRequest("POST", `/api/student/lesson-pairing/confirmations/${confirmationId}/respond`, { action });
      const readPath = `/api/student/notifications/${notificationId}/read`;
      await apiRequest("POST", readPath);
    },
    onSuccess: (_data, { action }) => {
      queryClient.invalidateQueries({ queryKey: [apiPath] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/lesson-pairing/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/classes"] });
      toast({
        title: action === "confirm" ? "Session Confirmed" : "Session Declined",
        description: action === "confirm"
          ? "Your paired In-Car 12/13 session is confirmed. See you there!"
          : "You've declined. Your spot will be re-offered to another student.",
        variant: "success",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Confirmation Failed",
        description: error?.message || "Could not process your response. Please try again.",
        variant: "destructive",
      });
    },
  });

  const confirmCancellationDecline = async (confirmationId: number) => {
    const check: any = await apiRequest(
      "GET",
      `/api/student/lesson-pairing/cancellation-check?confirmationId=${confirmationId}`,
    );
    return window.confirm(check?.policy?.feeRequired
      ? "This session starts in less than 24 hours. Declining now will charge $100.00 plus applicable taxes to your saved card. If payment fails, the invoice will remain due. Continue?"
      : "This session is at least 24 hours away, so declining has no cancellation fee. Continue?");
  };

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

  const isPairingActionPending = respondOfferMutation.isPending || respondConfirmationMutation.isPending;

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
                // Task 272: the `incar_pairing_offer` type is reused for both an
                // actionable offer (payload has offerId) and an informational
                // "pairing confirmed" message (payload has pairedSessionId, no
                // offerId). Only render action buttons when the keyed id is present.
                const offerId = notification.payload?.offerId;
                const confirmationId = notification.payload?.confirmationId;
                const hasOfferAction = notification.type === "incar_pairing_offer" && offerId != null;
                const hasConfirmationAction = notification.type === "incar_session_confirmation" && confirmationId != null;
                const isPairingAction = hasOfferAction || hasConfirmationAction;

                return (
                  <div
                    key={notification.id}
                    className={`p-4 hover:bg-gray-50 transition-colors ${isUnread ? "bg-blue-50/50" : ""}`}
                    onClick={() => {
                      // Only mark read on click if it's not an actionable pairing
                      // notification (those get marked read via the action buttons).
                      if (isUnread && !isPairingAction) {
                        handleMarkRead(notification.id);
                      }
                    }}
                    style={{ cursor: isUnread && !isPairingAction ? "pointer" : "default" }}
                    data-testid={`notification-item-${notification.id}`}
                  >
                    <div className="flex gap-3">
                      <div className={`h-8 w-8 min-h-8 min-w-8 max-h-8 max-w-8 rounded-full flex-none self-start flex items-center justify-center ${colorClass}`}>
                        <IconComponent className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm font-medium break-words min-w-0 ${isUnread ? "text-foreground" : "text-muted-foreground"}`}>
                            {notification.title}
                          </p>
                          {isUnread && (
                            <div className="h-2 w-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground break-words mt-1">
                          {notification.message}
                        </p>
                        <p className="text-xs text-muted-foreground mt-2">
                          {notification.createdAt && formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                        </p>

                        {/* Accept / Decline buttons for an actionable pairing offer */}
                        {hasOfferAction && (
                          <div className="flex gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="sm"
                              className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white px-3"
                              disabled={isPairingActionPending}
                              onClick={() => respondOfferMutation.mutate({ offerId, action: "accept", notificationId: notification.id })}
                              data-testid={`button-pairing-accept-${notification.id}`}
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-red-200 text-red-600 hover:bg-red-50 px-3"
                              disabled={isPairingActionPending}
                              onClick={() => respondOfferMutation.mutate({ offerId, action: "decline", notificationId: notification.id })}
                              data-testid={`button-pairing-decline-${notification.id}`}
                            >
                              <XCircle className="h-3 w-3 mr-1" />
                              Decline
                            </Button>
                          </div>
                        )}

                        {/* Confirm / Decline buttons for a session confirmation request */}
                        {hasConfirmationAction && (
                          <div className="flex gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="sm"
                              className="h-7 text-xs bg-purple-600 hover:bg-purple-700 text-white px-3"
                              disabled={isPairingActionPending}
                              onClick={() => respondConfirmationMutation.mutate({ confirmationId, action: "confirm", notificationId: notification.id })}
                              data-testid={`button-pairing-confirm-${notification.id}`}
                            >
                              <UserCheck className="h-3 w-3 mr-1" />
                              Confirm
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-red-200 text-red-600 hover:bg-red-50 px-3"
                              disabled={isPairingActionPending}
                              onClick={async () => {
                                try {
                                  if (await confirmCancellationDecline(confirmationId)) {
                                    respondConfirmationMutation.mutate({ confirmationId, action: "decline", notificationId: notification.id });
                                  }
                                } catch (error: any) {
                                  toast({
                                    title: "Unable to check cancellation fee",
                                    description: error?.message || "Please try again.",
                                    variant: "destructive",
                                  });
                                }
                              }}
                              data-testid={`button-pairing-decline-confirmation-${notification.id}`}
                            >
                              <XCircle className="h-3 w-3 mr-1" />
                              Can't Attend
                            </Button>
                          </div>
                        )}
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
