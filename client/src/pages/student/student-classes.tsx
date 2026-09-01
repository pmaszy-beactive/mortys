import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  Calendar, 
  Clock, 
  Car,
  Bike,
  ChevronLeft,
  ChevronRight,
  Video,
  MapPin,
  User,
  Users,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Timer,
  FileText,
  RefreshCw,
  Trash2,
  DollarSign,
  CheckCircle,
  BookOpen,
  Lock,
  AlertTriangle,
  CalendarClock,
} from "lucide-react";
import { useLocation } from "wouter";
import { useStudentAuth } from "@/hooks/useStudentAuth";
import { useState, useMemo, useEffect } from "react";
import type { Class } from "@shared/schema";
import type { PhaseProgressData, PhaseClassProgress, PhaseProgress } from "@shared/phaseConfig";
import PhaseProgressTracker, { PhaseProgressTrackerSkeleton, type ClassBookState } from "@/components/phase-progress-tracker";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CardCaptureForm } from "@/components/student/card-capture-form";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { getStripePromise } from "@/lib/stripe";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getPhaseClassBookState } from "@/lib/class-book-state";
import { isPermitExpired, isPermitExpiringSoon, formatDate } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const stripePromise = getStripePromise();

interface ClassWithDetails extends Class {
  enrollmentId?: number;
  attendanceStatus?: string;
  testScore?: number;
  paymentStatus?: string;
  paidAmount?: number;
  instructorName: string;
}

interface ReschedulePolicy {
  withinRestrictedWindow: boolean;
  feeRequired: boolean;
  feeAmount: number;
  restrictedWindowHours: number;
  hoursUntilClass: number;
}

interface CancelPolicy {
  withinRestrictedWindow: boolean;
  feeRequired: boolean;
  feeAmount: number;
  restrictedWindowHours: number;
  hoursUntilClass: number;
}

interface AvailableClass {
  id: number;
  courseType: string;
  classType?: string;
  classNumber: number;
  date: string;
  time: string;
  duration: number;
  instructorId: number;
  instructorName: string;
  room: string | null;
  maxStudents: number;
  enrolledCount: number;
  spotsRemaining: number;
  status: string;
  /** Set by the server-side phase rules engine */
  bookingAllowed?: boolean;
  blockingReason?: string;
  blockingRule?: string;
  /** Task 272: canonical combined In-Car 12/13 slot annotations */
  pairedLesson?: boolean;
  pairedLabel?: string;
}

// ── Task 272: In-Car 12/13 combined-session pairing status ─────────────────
interface PairingQueueEntry {
  id: number;
  studentId: number;
  sessionNumber: number;
  status: 'waiting' | 'offered' | 'booked_first' | 'paired' | 'confirmed' | 'completed' | 'deferred' | 'converted_solo' | 'cancelled';
  priority: number;
  bookedClassId: number | null;
  enrollmentId?: number | null;
}

interface PairingOffer {
  id: number;
  classId: number;
  expiresAt: string;
  status: string;
}

interface PairingConfirmation {
  id: number;
  pairedSessionId: number;
  status: string;
}

interface PairingSession {
  id: number;
  classId: number;
  status: string;
}

interface PairingStatusResponse {
  queueEntries: PairingQueueEntry[];
  pendingOffers: PairingOffer[];
  pendingConfirmations: PairingConfirmation[];
  activeSessions: PairingSession[];
}

interface PairingCancellationCheck {
  policy: {
    feeRequired: boolean;
    feeAmount: number;
    taxApplicable: boolean;
  };
}

interface StudentPaymentMethodSummary {
  id: number;
  cardBrand: string | null;
  last4: string | null;
}

interface PhaseInfo {
  currentPhase: string;
  phaseOrder: number;
  allowedClassTypes: string[];
  completedTheory: number;
  completedDriving: number;
  theoryRequired: number;
  drivingRequired: number;
  theoryComplete: boolean;
}

interface AvailableClassesResponse {
  classes: AvailableClass[];
  phaseInfo: PhaseInfo;
}

const getCourseIcon = (courseType: string) => {
  switch (courseType.toLowerCase()) {
    case 'auto':
      return <Car className="h-5 w-5" />;
    case 'moto':
      return <Bike className="h-5 w-5" />;
    case 'scooter':
      return <Bike className="h-4 w-4" />;
    default:
      return <Car className="h-5 w-5" />;
  }
};

type LiveClassStatus = 'cancelled' | 'completed' | 'missed' | 'pending_review' | 'in_progress' | 'starting_soon' | 'upcoming';

const STARTING_SOON_WINDOW_MS = 15 * 60 * 1000;

const getLiveClassStatus = (classItem: ClassWithDetails, now: Date): LiveClassStatus => {
  if (classItem.status === 'cancelled') return 'cancelled';

  const startMs = new Date(`${classItem.date}T${classItem.time}`).getTime();
  const endMs = startMs + (classItem.duration ?? 0) * 60 * 1000;
  const nowMs = now.getTime();

  if (classItem.attendanceStatus === 'attended' || classItem.status === 'completed') return 'completed';
  if (classItem.attendanceStatus === 'absent' || classItem.attendanceStatus === 'no-show') return 'missed';

  if (nowMs >= endMs) return 'pending_review';
  if (nowMs >= startMs) return 'in_progress';
  if (startMs - nowMs <= STARTING_SOON_WINDOW_MS) return 'starting_soon';
  return 'upcoming';
};

const classActionsLocked = (classItem: ClassWithDetails, now: Date): boolean => {
  const status = getLiveClassStatus(classItem, now);
  return status !== 'upcoming' && status !== 'starting_soon';
};

const getStatusBadge = (classItem: ClassWithDetails, now: Date = new Date()) => {
  const status = getLiveClassStatus(classItem, now);
  const testId = `badge-status-${classItem.id}`;

  switch (status) {
    case 'cancelled':
      return <Badge variant="destructive" data-testid={testId}><XCircle className="mr-1 h-3 w-3" />Cancelled</Badge>;
    case 'completed':
      return <Badge className="bg-gray-500 text-white hover:bg-gray-600 dark:bg-gray-600 dark:hover:bg-gray-500" data-testid={testId}><CheckCircle2 className="mr-1 h-3 w-3" />Completed</Badge>;
    case 'missed':
      return <Badge className="bg-red-500 text-white hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-500" data-testid={testId}><XCircle className="mr-1 h-3 w-3" />Missed</Badge>;
    case 'pending_review':
      return <Badge variant="secondary" data-testid={testId}>Pending Review</Badge>;
    case 'in_progress':
      return (
        <Badge className="bg-green-500 text-white hover:bg-green-600 dark:bg-green-600 dark:hover:bg-green-500" data-testid={testId}>
          <span className="relative mr-1.5 flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
          </span>
          Live now
        </Badge>
      );
    case 'starting_soon':
      return <Badge className="bg-orange-500 text-white hover:bg-orange-600 dark:bg-orange-600 dark:hover:bg-orange-500" data-testid={testId}><Timer className="mr-1 h-3 w-3" />Starting soon!</Badge>;
    default:
      return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-300 dark:hover:bg-yellow-900/60" data-testid={testId}><Timer className="mr-1 h-3 w-3" />Upcoming</Badge>;
  }
};

const useNow = (intervalMs: number = 30000) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs]);
  return now;
};

const CalendarView = ({ 
  classes, 
  renderClassCard, 
  isUpcoming 
}: { 
  classes: ClassWithDetails[]; 
  renderClassCard: (classItem: ClassWithDetails, isUpcoming: boolean) => JSX.Element;
  isUpcoming: boolean;
}) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [detailClass, setDetailClass] = useState<ClassWithDetails | null>(null);
  const now = useNow();
  
  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
  
  const classesByDate = useMemo(() => {
    const grouped: Record<string, ClassWithDetails[]> = {};
    classes.forEach(classItem => {
      const dateKey = classItem.date;
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(classItem);
    });
    return grouped;
  }, [classes]);
  
  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };
  
  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };
  
  const monthName = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  
  const calendarDays = [];
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  
  for (let i = 0; i < firstDayOfMonth; i++) {
    calendarDays.push(<div key={`empty-${i}`} className="min-h-32 bg-gray-50 rounded-lg" />);
  }
  
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayClasses = classesByDate[dateStr] || [];
    const isToday = dateStr === new Date().toISOString().split('T')[0];
    
    calendarDays.push(
      <div 
        key={day} 
        className={`min-h-32 p-2 rounded-lg border flex flex-col ${isToday ? 'border-[#ECC462] bg-[#ECC462]/5' : 'border-gray-200 bg-white'}`}
      >
        <div className={`text-sm font-medium mb-1 flex-shrink-0 ${isToday ? 'text-[#ECC462]' : 'text-gray-700'}`}>
          {day}
        </div>
        <div className="flex-1 space-y-1.5">
          {dayClasses.slice(0, 2).map((classItem) => {
            const isTheory = classItem.classType
              ? classItem.classType === 'theory'
              : classItem.classNumber != null && classItem.classNumber <= 5;
            return (
              <button
                key={classItem.id}
                type="button"
                onClick={() => setDetailClass(classItem)}
                className={`w-full text-left text-xs p-1.5 rounded-md border-l-2 shadow-sm cursor-pointer hover:brightness-95 transition ${
                  isTheory 
                    ? 'bg-blue-50 text-blue-800 border-l-blue-500' 
                    : 'bg-amber-50 text-amber-800 border-l-amber-500'
                }`}
                title={`${classItem.courseType} - Class ${classItem.classNumber} at ${classItem.time}`}
                data-testid={`chip-class-${classItem.id}`}
              >
                <div className="font-medium leading-tight">
                  {classItem.time.slice(0, 5)}
                </div>
                <div className="leading-tight opacity-80">
                  {isTheory ? 'Theory' : 'Driving'} {classItem.classNumber}
                </div>
              </button>
            );
          })}
          {dayClasses.length > 2 && (
            <button
              type="button"
              onClick={() => setExpandedDay(dateStr)}
              className="w-full text-left text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md px-1.5 py-1.5 transition-colors"
              data-testid={`button-more-classes-${dateStr}`}
            >
              +{dayClasses.length - 2} more
            </button>
          )}
        </div>
      </div>
    );
  }
  
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Button variant="outline" size="sm" onClick={prevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="text-lg font-semibold text-gray-900">{monthName}</h3>
        <Button variant="outline" size="sm" onClick={nextMonth}>
          <ChevronLeft className="h-4 w-4 rotate-180" />
        </Button>
      </div>
      
      <div className="grid grid-cols-7 gap-2 mb-2">
        {weekDays.map(day => (
          <div key={day} className="text-center text-sm font-medium text-gray-500 py-2">
            {day}
          </div>
        ))}
      </div>
      
      <div className="grid grid-cols-7 gap-2">
        {calendarDays}
      </div>
      
      <Dialog open={expandedDay !== null} onOpenChange={(open) => { if (!open) setExpandedDay(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {expandedDay ? new Date(`${expandedDay}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : ''}
            </DialogTitle>
            <DialogDescription>
              All classes scheduled for this day
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {(expandedDay ? classesByDate[expandedDay] || [] : []).map((classItem) => {
              const isTheory = classItem.classType
                ? classItem.classType === 'theory'
                : classItem.classNumber != null && classItem.classNumber <= 5;
              return (
                <button
                  key={classItem.id}
                  type="button"
                  onClick={() => setDetailClass(classItem)}
                  className={`w-full flex items-center justify-between gap-3 text-left text-sm p-3 rounded-md border-l-4 shadow-sm hover:brightness-95 transition ${
                    isTheory
                      ? 'bg-blue-50 text-blue-900 border-l-blue-500'
                      : 'bg-amber-50 text-amber-900 border-l-amber-500'
                  }`}
                  data-testid={`day-class-${classItem.id}`}
                >
                  <div>
                    <div className="font-medium">
                      {isTheory ? 'Theory' : 'Driving'} Class {classItem.classNumber}
                    </div>
                    <div className="text-xs opacity-80 flex items-center gap-1 mt-0.5">
                      <Clock className="h-3 w-3" />
                      {new Date(`${classItem.date}T${classItem.time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      <span className="mx-1">·</span>
                      {classItem.duration} min
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 opacity-60" />
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
      
      <Dialog open={detailClass !== null} onOpenChange={(open) => { if (!open) setDetailClass(null); }}>
        <DialogContent className="sm:max-w-md">
          {detailClass && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {getCourseIcon(detailClass.courseType)}
                  {detailClass.courseType.toUpperCase()} - Class {detailClass.classNumber}
                </DialogTitle>
                <DialogDescription className="sr-only">Class details</DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2">
                {getStatusBadge(detailClass, now)}
              </div>
              <div className="space-y-3 text-sm text-gray-700">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  <span data-testid={`detail-date-${detailClass.id}`}>
                    {new Date(`${detailClass.date}T${detailClass.time}`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <span data-testid={`detail-time-${detailClass.id}`}>
                    {new Date(`${detailClass.date}T${detailClass.time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    {' · '}{detailClass.duration} min
                  </span>
                </div>
                {detailClass.instructorName && (
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-gray-400" />
                    <span data-testid={`detail-instructor-${detailClass.id}`}>{detailClass.instructorName}</span>
                  </div>
                )}
                {detailClass.room && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-gray-400" />
                    <span data-testid={`detail-room-${detailClass.id}`}>Room {detailClass.room}</span>
                  </div>
                )}
                {detailClass.zoomLink && (
                  <a
                    href={detailClass.zoomLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-amber-700 hover:underline"
                    data-testid={`detail-zoom-${detailClass.id}`}
                  >
                    <Video className="h-4 w-4" />
                    Join Zoom
                  </a>
                )}
                {detailClass.hasTest && (
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-gray-400" />
                    <span>
                      Test Included
                      {detailClass.testScore !== null && detailClass.testScore !== undefined && (
                        <span className="ml-1 font-semibold">({detailClass.testScore}%)</span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      
      <div className="mt-6 space-y-4">
        <h4 className="font-medium text-gray-700">Classes this month:</h4>
        {(() => {
          const monthClasses = classes.filter(c => {
            const [year, month] = c.date.split('-').map(Number);
            return month === currentMonth.getMonth() + 1 && 
                   year === currentMonth.getFullYear();
          });
          
          if (monthClasses.length === 0) {
            return <p className="text-gray-500 text-sm">No classes scheduled for this month.</p>;
          }
          
          return (
            <div className="space-y-4">
              {monthClasses.map(classItem => renderClassCard(classItem, isUpcoming))}
            </div>
          );
        })()}
      </div>
    </div>
  );
};

const CountdownTimer = ({ targetDate, durationMinutes }: { targetDate: Date; durationMinutes?: number }) => {
  const [display, setDisplay] = useState<{ caption: string; label: string }>({ caption: "Starts in", label: "" });
  
  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date();
      const diff = targetDate.getTime() - now.getTime();
      const endTime = targetDate.getTime() + (durationMinutes ?? 0) * 60 * 1000;
      
      if (diff <= 0) {
        if (durationMinutes && now.getTime() < endTime) {
          setDisplay({ caption: "Status", label: "In progress" });
        } else if (durationMinutes) {
          setDisplay({ caption: "Status", label: "Ended" });
        } else {
          setDisplay({ caption: "Status", label: "Starting soon!" });
        }
        return;
      }
      
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      
      let label: string;
      if (days > 0) {
        label = `${days}d ${hours}h`;
      } else if (hours > 0) {
        label = `${hours}h ${minutes}m`;
      } else if (minutes > 0) {
        label = `${minutes}m`;
      } else {
        label = "Starting soon!";
      }
      setDisplay({ caption: "Starts in", label });
    };
    
    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 60000);
    
    return () => clearInterval(interval);
  }, [targetDate, durationMinutes]);
  
  return (
    <div className="text-right">
      <p className="text-xs text-gray-500 mb-1">{display.caption}</p>
      <span
        className={`text-sm font-medium ${display.label === "Ended" ? "text-gray-400" : "text-[#ECC462]"}`}
        data-testid="text-countdown"
      >
        {display.label}
      </span>
    </div>
  );
};

function ReschedulePaymentForm({ 
  enrollmentId, 
  newClassId, 
  onSuccess, 
  onCancel 
}: { 
  enrollmentId: number; 
  newClassId: number;
  onSuccess: () => void; 
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);

    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/student/classes`,
        },
        redirect: 'if_required',
      });

      if (error) {
        toast({
          title: "Payment Failed",
          description: error.message,
          variant: "destructive",
        });
        setIsProcessing(false);
        return;
      }

      if (paymentIntent && paymentIntent.status === 'succeeded') {
        await apiRequest("POST", `/api/student/classes/${enrollmentId}/reschedule`, {
          newClassId,
          paymentIntentId: paymentIntent.id,
        });

        toast({
          title: "Class Rescheduled Successfully!",
          description: "Your class has been rescheduled and payment processed.",
        });

        onSuccess();
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Failed to process reschedule",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isProcessing}>
          Cancel
        </Button>
        <Button type="submit" disabled={!stripe || isProcessing}>
          {isProcessing ? "Processing..." : "Pay & Reschedule"}
        </Button>
      </div>
    </form>
  );
}

function CancelPaymentForm({ 
  enrollmentId, 
  onSuccess, 
  onCancel 
}: { 
  enrollmentId: number;
  onSuccess: () => void; 
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);

    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/student/classes`,
        },
        redirect: 'if_required',
      });

      if (error) {
        toast({
          title: "Payment Failed",
          description: error.message,
          variant: "destructive",
        });
        setIsProcessing(false);
        return;
      }

      if (paymentIntent && paymentIntent.status === 'succeeded') {
        await apiRequest("POST", `/api/student/classes/${enrollmentId}/cancel`, {
          paymentIntentId: paymentIntent.id,
        });

        toast({
          title: "Class Cancelled Successfully!",
          description: "Your class has been cancelled and payment processed.",
        });

        onSuccess();
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Failed to process cancellation",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isProcessing}>
          Keep Class
        </Button>
        <Button type="submit" variant="destructive" disabled={!stripe || isProcessing}>
          {isProcessing ? "Processing..." : "Pay & Cancel Class"}
        </Button>
      </div>
    </form>
  );
}

function RescheduleModal({ 
  enrollmentId,
  classDetails, 
  open, 
  onOpenChange 
}: { 
  enrollmentId: number;
  classDetails: ClassWithDetails | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [selectedNewClassId, setSelectedNewClassId] = useState<number | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  const { data: policyData, isLoading: policyLoading } = useQuery({
    queryKey: [`/api/student/classes/${enrollmentId}/reschedule-check`],
    enabled: open && !!enrollmentId && !!classDetails,
  });

  const policy = (policyData as any)?.policy;
  const availableSlots = (policyData as any)?.availableSlots || [];

  const freeRescheduleMutation = useMutation({
    mutationFn: async (newClassId: number) => {
      return await apiRequest("POST", `/api/student/classes/${enrollmentId}/reschedule`, {
        newClassId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/classes"] });
      toast({
        title: "Class Rescheduled!",
        description: "Your class has been successfully rescheduled.",
      });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Reschedule Failed",
        description: error?.message || "Failed to reschedule class",
        variant: "destructive",
      });
    },
  });

  const handlePaidReschedule = async () => {
    if (!selectedNewClassId) return;

    try {
      const response = await apiRequest("POST", `/api/student/classes/${enrollmentId}/create-reschedule-payment`, {
        newClassId: selectedNewClassId,
      });
      setClientSecret(response.clientSecret);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Failed to create payment",
        variant: "destructive",
      });
    }
  };

  const handleFreeReschedule = () => {
    if (selectedNewClassId) {
      freeRescheduleMutation.mutate(selectedNewClassId);
    }
  };

  const handlePaymentSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/student/classes"] });
    onOpenChange(false);
    setClientSecret(null);
    setSelectedNewClassId(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        {classDetails ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5 text-[#ECC462]" />
                Reschedule Class
              </DialogTitle>
              <DialogDescription>
                {classDetails.courseType.toUpperCase()} - Class {classDetails.classNumber}
              </DialogDescription>
            </DialogHeader>

        {policyLoading ? (
          <div className="py-8 text-center">Loading policy...</div>
        ) : policy ? (
          <div className="space-y-4">
            <div className={`p-4 rounded-lg ${policy.feeRequired ? 'bg-amber-50' : 'bg-green-50'}`}>
              <div className="flex items-start gap-2">
                {policy.feeRequired ? (
                  <DollarSign className="h-5 w-5 text-amber-600 mt-0.5" />
                ) : (
                  <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                )}
                <div className="flex-1">
                  <p className={`font-semibold ${policy.feeRequired ? 'text-amber-900' : 'text-green-900'}`}>
                    {policy.feeRequired ? `$${policy.feeAmount.toFixed(2)} Fee Required` : 'Free Reschedule'}
                  </p>
                  <p className={`text-sm ${policy.feeRequired ? 'text-amber-800' : 'text-green-800'}`}>
                    {policy.feeRequired 
                      ? `This class is in ${policy.hoursUntilClass} hours (within the ${policy.restrictedWindowHours}-hour policy window). A $${policy.feeAmount.toFixed(2)} fee applies.`
                      : `This class is in ${policy.hoursUntilClass} hours. You can reschedule for free!`
                    }
                  </p>
                </div>
              </div>
            </div>

            {!clientSecret && (
              <>
                <div>
                  <h4 className="font-semibold mb-2">Select New Class Time:</h4>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {availableSlots.length === 0 ? (
                      <p className="text-sm text-gray-500 p-4 text-center">No available slots found</p>
                    ) : (
                      availableSlots.map((slot: any) => (
                        <button
                          key={slot.id}
                          onClick={() => setSelectedNewClassId(slot.id)}
                          className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                            selectedNewClassId === slot.id
                              ? 'border-[#ECC462] bg-[#ECC462]/10'
                              : 'border-gray-200 hover:border-[#ECC462]/50'
                          }`}
                        >
                          <div className="flex justify-between items-center">
                            <div>
                              <p className="font-medium">
                                {new Date(`${slot.date}T${slot.time}`).toLocaleDateString('en-US', {
                                  weekday: 'short',
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </p>
                              <p className="text-sm text-gray-600">
                                {new Date(`${slot.date}T${slot.time}`).toLocaleTimeString('en-US', {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                              </p>
                            </div>
                            {selectedNewClassId === slot.id && (
                              <CheckCircle className="h-5 w-5 text-[#ECC462]" />
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={policy.feeRequired ? handlePaidReschedule : handleFreeReschedule}
                    disabled={!selectedNewClassId || freeRescheduleMutation.isPending}
                  >
                    {policy.feeRequired ? 'Continue to Payment' : 'Confirm Reschedule'}
                  </Button>
                </DialogFooter>
              </>
            )}

            {clientSecret && stripePromise && selectedNewClassId && (
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <ReschedulePaymentForm
                  enrollmentId={enrollmentId}
                  newClassId={selectedNewClassId}
                  onSuccess={handlePaymentSuccess}
                  onCancel={() => {
                    setClientSecret(null);
                    setSelectedNewClassId(null);
                  }}
                />
              </Elements>
            )}
          </div>
        ) : (
          <div className="py-8 text-center text-red-600">Failed to load policy</div>
        )}
          </>
        ) : (
          <div className="py-8 text-center text-gray-500">Loading class details...</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CancelModal({ 
  enrollmentId,
  classDetails, 
  open, 
  onOpenChange 
}: { 
  enrollmentId: number;
  classDetails: ClassWithDetails | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  const { data: policyData, isLoading: policyLoading } = useQuery({
    queryKey: [`/api/student/classes/${enrollmentId}/cancel-check`],
    enabled: open && !!enrollmentId && !!classDetails,
  });

  const policy = (policyData as any)?.policy;

  const freeCancelMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/student/classes/${enrollmentId}/cancel`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/classes"] });
      toast({
        title: "Class Cancelled!",
        description: "Your class has been successfully cancelled.",
      });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Cancellation Failed",
        description: error?.message || "Failed to cancel class",
        variant: "destructive",
      });
    },
  });

  const handlePaidCancel = async () => {
    try {
      const response = await apiRequest("POST", `/api/student/classes/${enrollmentId}/create-cancel-payment`, {});
      setClientSecret(response.clientSecret);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Failed to create payment",
        variant: "destructive",
      });
    }
  };

  const handlePaymentSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/student/classes"] });
    onOpenChange(false);
    setClientSecret(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {classDetails ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <AlertCircle className="h-5 w-5" />
                Cancel Class
              </DialogTitle>
              <DialogDescription>
                {classDetails.courseType.toUpperCase()} - Class {classDetails.classNumber}
              </DialogDescription>
            </DialogHeader>

        {policyLoading ? (
          <div className="py-8 text-center">Loading policy...</div>
        ) : policy ? (
          <div className="space-y-4">
            <div className={`p-4 rounded-lg ${policy.feeRequired ? 'bg-red-50' : 'bg-green-50'}`}>
              <div className="flex items-start gap-2">
                {policy.feeRequired ? (
                  <DollarSign className="h-5 w-5 text-red-600 mt-0.5" />
                ) : (
                  <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                )}
                <div className="flex-1">
                  <p className={`font-semibold ${policy.feeRequired ? 'text-red-900' : 'text-green-900'}`}>
                    {policy.feeRequired
                      ? `$${policy.feeAmount.toFixed(2)}${policy.taxApplicable ? " + tax" : ""} Cancellation Fee`
                      : 'Free Cancellation'}
                  </p>
                  <p className={`text-sm ${policy.feeRequired ? 'text-red-800' : 'text-green-800'}`}>
                    {policy.feeRequired 
                      ? policy.canonicalIncar1213
                        ? `This In-Car 12/13 session starts in less than 24 hours. $${policy.feeAmount.toFixed(2)} plus applicable taxes will be charged to your saved card after cancellation. If payment fails, the invoice remains due.`
                        : `This class is in ${policy.hoursUntilClass} hours (within the ${policy.restrictedWindowHours}-hour policy window). A $${policy.feeAmount.toFixed(2)} cancellation fee applies.`
                      : `This class is in ${policy.hoursUntilClass} hours. You can cancel for free!`
                    }
                  </p>
                </div>
              </div>
            </div>

            {!clientSecret ? (
              <DialogFooter className="flex-row gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Keep Class
                </Button>
                <Button
                  variant="destructive"
                  onClick={policy.feeRequired && !policy.canonicalIncar1213
                    ? handlePaidCancel
                    : () => freeCancelMutation.mutate()}
                  disabled={freeCancelMutation.isPending}
                >
                  {policy.feeRequired && !policy.canonicalIncar1213
                    ? 'Continue to Payment'
                    : 'Confirm Cancellation'}
                </Button>
              </DialogFooter>
            ) : (
              stripePromise && (
                <Elements stripe={stripePromise} options={{ clientSecret }}>
                  <CancelPaymentForm
                    enrollmentId={enrollmentId}
                    onSuccess={handlePaymentSuccess}
                    onCancel={() => setClientSecret(null)}
                  />
                </Elements>
              )
            )}
          </div>
        ) : (
          <div className="py-8 text-center text-red-600">Failed to load policy</div>
        )}
          </>
        ) : (
          <div className="py-8 text-center text-gray-500">Loading class details...</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const PAGE_SIZE = 10;

export default function StudentClasses() {
  const { data: policySettings } = useQuery<{ cancelWindowHours: number }>({
    queryKey: ["/api/student/policy-settings"],
  });
  const cancelWindowHours = policySettings?.cancelWindowHours ?? 24;
  const [, setLocation] = useLocation();
  const { student, isLoading: authLoading, isAuthenticated } = useStudentAuth();
  const { toast } = useToast();
  const now = useNow();

  const [selectedClass, setSelectedClass] = useState<ClassWithDetails | null>(null);
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<number | null>(null);
  const [rescheduleModalOpen, setRescheduleModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);

  const [bookingWizardOpen, setBookingWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<2 | 3 | 4>(2);
  const [targetClass, setTargetClass] = useState<PhaseClassProgress | null>(null);
  const [selectedBookingClass, setSelectedBookingClass] = useState<AvailableClass | null>(null);
  const [selectedPairSecondClass, setSelectedPairSecondClass] = useState<AvailableClass | null>(null);
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [isCardDrawerOpen, setIsCardDrawerOpen] = useState(false);
  const [pendingCardClass, setPendingCardClass] = useState<AvailableClass | null>(null);
  const [pendingCardPairSecondClass, setPendingCardPairSecondClass] = useState<AvailableClass | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  // Task 272: remember whether the last confirmed booking entered the In-Car
  // 12/13 pairing flow so the success step shows the pairing copy.
  const [lastBookingPaired, setLastBookingPaired] = useState(false);

  const { data: classes = [], isLoading: classesLoading } = useQuery<ClassWithDetails[]>({
    queryKey: ["/api/student/classes"],
    enabled: isAuthenticated,
  });

  const { data: phaseProgressData, isLoading: phaseProgressLoading } = useQuery<PhaseProgressData>({
    queryKey: ["/api/student/phase-progress"],
    enabled: isAuthenticated,
  });

  const { data: classesResponse, isLoading: availableClassesLoading } = useQuery<AvailableClassesResponse>({
    queryKey: ["/api/student/classes/available"],
    enabled: isAuthenticated,
  });

  const availableClasses = classesResponse?.classes || [];
  const phaseInfo = classesResponse?.phaseInfo;

  const { data: paymentMethods = [] } = useQuery<StudentPaymentMethodSummary[]>({
    queryKey: ["/api/student/billing/methods"],
    enabled: isAuthenticated,
  });
  const hasSavedCard = paymentMethods.length > 0;

  // Task 272: In-Car 12/13 pairing status. Auto students may queue for and be
  // paired into the combined 2-hour session.
  const { data: pairingStatus } = useQuery<PairingStatusResponse>({
    queryKey: ["/api/student/lesson-pairing/status"],
    enabled: isAuthenticated,
  });

  const bookClassMutation = useMutation({
    mutationFn: async (classId: number) => {
      return await apiRequest("POST", `/api/student/classes/${classId}/book`);
    },
    onSuccess: (response: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/classes/available"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/classes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/phase-progress"] });
      const isPaired = response?.pairedLesson === true;
      setLastBookingPaired(isPaired);
      if (isPaired) {
        queryClient.invalidateQueries({ queryKey: ["/api/student/lesson-pairing/status"] });
      }
      setWizardStep(4);
    },
    onError: (error: any) => {
      // Server-side card enforcement: open the card drawer instead of a toast
      // so the student can add a card and resume the booking.
      if (error?.data?.policyViolation === "card_required" && selectedBookingClass) {
        setBookingWizardOpen(false);
        setPendingCardClass(selectedBookingClass);
        setPendingCardPairSecondClass(selectedPairSecondClass);
        setIsCardDrawerOpen(true);
        return;
      }
      toast({
        title: "Booking Failed",
        description: error?.message || "Failed to book class. Please try again.",
        variant: "destructive",
      });
    },
  });

  const bookInCar56PairMutation = useMutation({
    mutationFn: async ({ first, second }: { first: AvailableClass; second: AvailableClass }) =>
      await apiRequest("POST", "/api/student/classes/book-incar-5-6-pair", {
        inCar5ClassId: first.id,
        inCar6ClassId: second.id,
      }),
    onSuccess: () => {
      ["/api/student/classes/available", "/api/student/classes", "/api/student/me", "/api/student/history", "/api/student/phase-progress"].forEach(queryKey =>
        queryClient.invalidateQueries({ queryKey: [queryKey] }));
      setLastBookingPaired(false);
      setWizardStep(4);
    },
    onError: (error: any) => toast({
      title: "Two-hour booking failed",
      description: error?.message || "Neither In-Car #5 nor #6 was booked. Please try again.",
      variant: "destructive",
    }),
  });

  // ── Task 272: In-Car 12/13 pairing mutations ─────────────────────────────
  const invalidatePairing = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/student/lesson-pairing/status"] });
    queryClient.invalidateQueries({ queryKey: ["/api/student/classes"] });
    queryClient.invalidateQueries({ queryKey: ["/api/student/classes/available"] });
  };

  const joinQueueMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/student/lesson-pairing/queue");
    },
    onSuccess: () => {
      invalidatePairing();
      toast({
        title: "Joined the pairing queue",
        description: "We're finding you a partner for your In-Car 12/13 session.",
        variant: "success",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't join the queue",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const leaveQueueMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("DELETE", "/api/student/lesson-pairing/queue");
    },
    onSuccess: () => {
      invalidatePairing();
      toast({
        title: "Left the pairing queue",
        description: "You've been removed from the In-Car 12/13 pairing queue.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't leave the queue",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const confirmPairingCancellation = async (confirmationId?: number) => {
    const suffix = confirmationId ? `?confirmationId=${confirmationId}` : "";
    const check = await apiRequest("GET", `/api/student/lesson-pairing/cancellation-check${suffix}`) as PairingCancellationCheck;
    return window.confirm(check.policy.feeRequired
      ? "This session starts in less than 24 hours. Cancelling now will charge $100.00 plus applicable taxes to your saved card. If the charge cannot be completed, the invoice will remain due. Continue?"
      : "This cancellation is at least 24 hours before the session, so there is no cancellation fee. Continue?");
  };

  const respondOfferMutation = useMutation({
    mutationFn: async ({ offerId, action }: { offerId: number; action: "accept" | "decline" }) => {
      return await apiRequest("POST", `/api/student/lesson-pairing/offers/${offerId}/respond`, { action });
    },
    onSuccess: (_data, { action }) => {
      invalidatePairing();
      toast({
        title: action === "accept" ? "Offer accepted" : "Offer declined",
        description: action === "accept"
          ? "You're paired for your In-Car 12/13 session."
          : "You'll remain in the queue for another partner.",
        variant: "success",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Action failed",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const respondConfirmationMutation = useMutation({
    mutationFn: async ({ confirmationId, action }: { confirmationId: number; action: "confirm" | "decline" }) => {
      return await apiRequest("POST", `/api/student/lesson-pairing/confirmations/${confirmationId}/respond`, { action });
    },
    onSuccess: (_data, { action }) => {
      invalidatePairing();
      toast({
        title: action === "confirm" ? "Session confirmed" : "Session declined",
        description: action === "confirm"
          ? "Your paired In-Car 12/13 session is confirmed. See you there!"
          : "Your spot will be re-offered to another student.",
        variant: "success",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Confirmation failed",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const isPairingActionPending =
    joinQueueMutation.isPending ||
    leaveQueueMutation.isPending ||
    respondOfferMutation.isPending ||
    respondConfirmationMutation.isPending;

  const isAutoCourse = (student?.courseType || "").toLowerCase() === "auto";

  // Sessions matching the specific class the student clicked "Book" on.
  const bookableClasses = useMemo(() => {
    if (!targetClass || !availableClasses.length) return [];
    return availableClasses.filter(c => {
      const isTheory = c.classType
        ? c.classType === 'theory'
        : c.classNumber <= 5;
      const sessionType = isTheory ? 'theory' : 'driving';
      return sessionType === targetClass.classType && c.classNumber === targetClass.classNumber;
    });
  }, [availableClasses, targetClass]);

  // The server's availability rows are authoritative. Pair only rows that are
  // currently bookable/capacious and exactly adjacent on the same instructor.
  const inCar56Pairs = useMemo(() => {
    if (!isAutoCourse || targetClass?.classType !== "driving" || ![5, 6].includes(targetClass.classNumber)) return [];
    const fives = availableClasses.filter(c => c.classType === "driving" && c.classNumber === 5 && c.duration === 60 && c.bookingAllowed !== false && c.spotsRemaining > 0);
    const sixes = availableClasses.filter(c => c.classType === "driving" && c.classNumber === 6 && c.duration === 60 && c.bookingAllowed !== false && c.spotsRemaining > 0);
    return fives.flatMap(first => sixes.filter(second =>
      first.date === second.date && first.instructorId === second.instructorId &&
      new Date(`${second.date}T${second.time}`).getTime() === new Date(`${first.date}T${first.time}`).getTime() + 60 * 60 * 1000,
    ).map(second => ({ first, second })));
  }, [availableClasses, isAutoCourse, targetClass]);

  const totalPages = Math.max(1, Math.ceil(bookableClasses.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedBookableClasses = bookableClasses.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setCurrentPage(1);
  }, [targetClass]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      setLocation("/student/login");
    }
  }, [authLoading, isAuthenticated, setLocation]);

  // Do not return before the hooks below. The student auth query resolves
  // before the class query, so an early loading return here caused the next
  // render to reach useMemo for the first time and crash with a hook-order
  // error.
  const loadingScreen = (authLoading || classesLoading) ? (
      <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50">
        <div className="bg-white/80 backdrop-blur-lg shadow-lg border-b border-[#ECC462]/20">
          <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
            <Skeleton className="h-8 w-48" />
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
          <div className="space-y-4">
            <PhaseProgressTrackerSkeleton />
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      </div>
    ) : null;

  // A class row's Book button was clicked — open the per-class session picker.
  const handleBookPhaseClass = (classItem: PhaseClassProgress) => {
    setTargetClass(classItem);
    setSelectedBookingClass(null);
    setSelectedPairSecondClass(null);
    setPolicyAccepted(false);
    setCurrentPage(1);
    setWizardStep(2);
    setBookingWizardOpen(true);
  };

  const handleSelectClass = (classItem: AvailableClass) => {
    // Classes beyond #1 require a card on file (also enforced server-side).
    if (classItem.classNumber > 1 && !hasSavedCard) {
      setPendingCardClass(classItem);
      setPendingCardPairSecondClass(null);
      setBookingWizardOpen(false);
      setIsCardDrawerOpen(true);
      return;
    }
    setSelectedBookingClass(classItem);
    setSelectedPairSecondClass(null);
    setPolicyAccepted(false);
    setWizardStep(3);
  };

  const handleCardSaved = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/student/billing/methods"] });
    setIsCardDrawerOpen(false);
    toast({
      title: "Card saved",
      description: "Your card is securely on file. You can now book this class.",
      variant: "success",
    });
    // Resume the booking the student was attempting.
    if (pendingCardClass) {
      setSelectedBookingClass(pendingCardClass);
      setSelectedPairSecondClass(pendingCardPairSecondClass);
      setPolicyAccepted(false);
      setWizardStep(3);
      setBookingWizardOpen(true);
      setPendingCardClass(null);
      setPendingCardPairSecondClass(null);
    }
  };

  // ── Task 272: pairing eligibility & helpers ──────────────────────────────
  // Theory 11 must be attended before the combined In-Car 12/13 session opens.
  const hasAttendedTheory11 = useMemo(() => {
    if (!phaseProgressData) return false;
    for (const phase of phaseProgressData.phases) {
      for (const c of phase.classes) {
        if (c.classType === "theory" && c.classNumber === 11 && c.isCompleted) {
          return true;
        }
      }
    }
    return false;
  }, [phaseProgressData]);

  if (loadingScreen) return loadingScreen;

  // Look up scheduled class info by id from the booked-classes query so pairing
  // offer/session cards can show date, time, and instructor.
  const findClassInfo = (classId: number | null | undefined): ClassWithDetails | undefined => {
    if (classId == null) return undefined;
    return classes.find((c) => c.id === classId);
  };

  const formatClassSchedule = (classId: number | null | undefined): string | null => {
    const info = findClassInfo(classId);
    if (!info) return null;
    const when = new Date(`${info.date}T${info.time}`);
    return when.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
      " · " +
      when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  const pairingQueueEntries = pairingStatus?.queueEntries ?? [];
  const pairingOffers = pairingStatus?.pendingOffers ?? [];
  const pairingConfirmations = pairingStatus?.pendingConfirmations ?? [];
  const pairingSessions = pairingStatus?.activeSessions ?? [];

  // An "active" queue entry keeps the student in the pairing flow. completed,
  // cancelled, converted, and deferred entries are historical.
  const activeQueueEntry = pairingQueueEntries.find((e) =>
    e.status === "waiting" ||
    e.status === "offered" ||
    e.status === "booked_first" ||
    e.status === "paired" ||
    e.status === "confirmed",
  );

  const hasPairingActivity =
    activeQueueEntry != null ||
    pairingOffers.length > 0 ||
    pairingConfirmations.length > 0 ||
    pairingSessions.length > 0;

  // Show the panel to auto students who either qualify (attended Theory 11) or
  // already have some pairing activity to act on.
  const showPairingPanel = isAutoCourse && (hasAttendedTheory11 || hasPairingActivity);

  // Only offer the Join button when the student is eligible and has no active
  // entry. Any server-side gate still surfaces as an error toast.
  const canJoinQueue = isAutoCourse && hasAttendedTheory11 && !activeQueueEntry;

  // Derive per-class Book button state for the phase tracker rows.
  const getBookState = (classItem: PhaseClassProgress, phase: PhaseProgress): ClassBookState => {
    // Task 272: In-Car #13 is never bookable on its own for auto students — it
    // is awarded together with the combined In-Car 12/13 session.
    if (isAutoCourse && classItem.classType === "driving" && classItem.classNumber === 13 && !classItem.isCompleted) {
      return { status: "blocked", reason: "Included with lesson 12 (paired In-Car 12/13 session)." };
    }
    return getPhaseClassBookState(classItem, phase, classes, availableClasses);
  };

  const confirmBooking = () => {
    if (selectedBookingClass) {
      if (selectedPairSecondClass) {
        bookInCar56PairMutation.mutate({ first: selectedBookingClass, second: selectedPairSecondClass });
      } else {
        bookClassMutation.mutate(selectedBookingClass.id);
      }
    }
  };

  const handleBackNavigation = () => {
    const currentUrl = window.location.href;
    window.history.back();

    // Direct visits may not have an in-app history entry. If the browser
    // remains on this page, take the student to their Dashboard instead.
    window.setTimeout(() => {
      if (window.location.href === currentUrl) {
        setLocation("/student/dashboard");
      }
    }, 200);
  };

  const renderClassCard = (classItem: ClassWithDetails, isUpcoming: boolean) => {
    const classDate = new Date(`${classItem.date}T${classItem.time}`);
    const formattedDate = classDate.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
    const formattedTime = classDate.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit' 
    });
    
    const liveStatus = getLiveClassStatus(classItem, now);
    const isCompleted = liveStatus === 'completed';
    const isCancelled = liveStatus === 'cancelled';
    const isMissed = liveStatus === 'missed';
    const canModify = !classActionsLocked(classItem, now);
    
    const getCardStyles = () => {
      if (isCompleted) {
        return 'border-l-4 border-l-green-500';
      }
      if (isCancelled) {
        return 'border-l-4 border-l-gray-400 opacity-75';
      }
      if (isMissed) {
        return 'border-l-4 border-l-red-500';
      }
      if (isUpcoming) {
        return 'border-l-4 border-l-[#ECC462]';
      }
      return 'border-l-4 border-l-gray-300';
    };

    return (
      <Card 
        key={classItem.id}
        className={`bg-white border border-gray-200 rounded-md shadow-sm hover:border-gray-300 transition-colors ${getCardStyles()}`}
        data-testid={`card-class-${classItem.id}`}
      >
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-md bg-gray-50 border border-gray-100`}>
                  {getCourseIcon(classItem.courseType)}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className={`font-semibold text-lg text-gray-900`} data-testid={`text-class-title-${classItem.id}`}>
                      {classItem.courseType.toUpperCase()} - Class {classItem.classNumber}
                    </h3>
                    {getStatusBadge(classItem, now)}
                  </div>
                  <p className={`text-sm text-gray-500 mt-1`}>
                    {classItem.instructorName && (
                      <span className="flex items-center gap-1" data-testid={`text-instructor-${classItem.id}`}>
                        <User className="h-3 w-3" />
                        {classItem.instructorName}
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-600">
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  <span data-testid={`text-date-${classItem.id}`}>{formattedDate}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <span data-testid={`text-time-${classItem.id}`}>{formattedTime}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Timer className="h-4 w-4 text-gray-400" />
                  <span data-testid={`text-duration-${classItem.id}`}>{classItem.duration} min</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                {classItem.room && (
                  <div className="flex items-center gap-1 text-sm bg-[#ECC462]/10 px-3 py-1 rounded-full" data-testid={`badge-room-${classItem.id}`}>
                    <MapPin className="h-3 w-3 text-[#ECC462]" />
                    <span className="text-[#111111]">Room {classItem.room}</span>
                  </div>
                )}
                
                {classItem.zoomLink && (
                  <a 
                    href={classItem.zoomLink} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-sm bg-amber-50 px-3 py-1 rounded-full hover:bg-amber-100 transition-colors"
                    data-testid={`link-zoom-${classItem.id}`}
                  >
                    <Video className="h-3 w-3 text-amber-600" />
                    <span className="text-amber-700">Join Zoom</span>
                  </a>
                )}
                
                {classItem.hasTest && (
                  <div className="flex items-center gap-1 text-sm bg-amber-50 px-3 py-1 rounded-full" data-testid={`badge-test-${classItem.id}`}>
                    <FileText className="h-3 w-3 text-amber-600" />
                    <span className="text-amber-700">Test Included</span>
                    {classItem.testScore !== null && classItem.testScore !== undefined && (
                      <span className="ml-1 font-semibold" data-testid={`text-test-score-${classItem.id}`}>
                        ({classItem.testScore}%)
                      </span>
                    )}
                  </div>
                )}
                
                {classItem.isExtra && (
                  <div className="flex items-center gap-1 text-sm bg-purple-50 px-3 py-1 rounded-full" data-testid={`badge-extra-${classItem.id}`}>
                    <DollarSign className="h-3 w-3 text-purple-600" />
                    <span className="text-purple-700">Extra Lesson</span>
                    {classItem.paymentStatus === 'paid' && (
                      <CheckCircle className="h-3 w-3 text-green-600 ml-1" />
                    )}
                    {classItem.paymentStatus === 'pending' && (
                      <AlertCircle className="h-3 w-3 text-amber-600 ml-1" />
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col items-end gap-3">
              {getStatusBadge(classItem, now)}
              
              {isUpcoming && classItem.status === 'scheduled' && canModify && (
                <>
                  <CountdownTimer targetDate={classDate} durationMinutes={classItem.duration} />
                  
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedClass(classItem);
                        setSelectedEnrollmentId(classItem.enrollmentId || null);
                        setRescheduleModalOpen(true);
                      }}
                      className="hover:bg-[#ECC462]/10 hover:border-[#ECC462]"
                      data-testid={`button-reschedule-${classItem.id}`}
                      disabled={!classItem.enrollmentId}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Reschedule
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedClass(classItem);
                        setSelectedEnrollmentId(classItem.enrollmentId || null);
                        setCancelModalOpen(true);
                      }}
                      className="hover:bg-red-50 hover:border-red-300 hover:text-red-600"
                      data-testid={`button-cancel-${classItem.id}`}
                      disabled={!classItem.enrollmentId}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Cancel
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-lg shadow-lg border-b border-[#ECC462]/20">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={handleBackNavigation}
              className="hover:bg-[#ECC462]/10"
              data-testid="button-back"
              aria-label="Go back"
              title="Back"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-[#111111] to-amber-900 bg-clip-text text-transparent">
                My Classes
              </h1>
              <p className="mt-1 text-sm sm:text-base text-gray-600">
                Course breakdown, booking & schedule management
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8 space-y-8">

        {/* Section 1: Course Progress (Phase Tracker) */}
        <section>
          <h2 className="text-xl font-bold text-[#111111] mb-4">Course Progress</h2>
          {phaseProgressLoading ? (
            <PhaseProgressTrackerSkeleton />
          ) : phaseProgressData ? (
            <PhaseProgressTracker
              phaseData={phaseProgressData}
              courseType={student?.courseType}
              getBookState={getBookState}
              onBookClass={handleBookPhaseClass}
            />
          ) : (
            <Card className="border-0 shadow-lg">
              <CardContent className="p-6 text-center text-gray-500">
                <p>Phase progress data is not available yet.</p>
              </CardContent>
            </Card>
          )}
        </section>

        {/* Section: In-Car 12/13 pairing (auto students) — Task 272 */}
        {showPairingPanel && (
          <section data-testid="section-incar-pairing">
            <h2 className="text-xl font-bold text-[#111111] mb-4 flex items-center gap-2">
              <Users className="h-5 w-5 text-[#ECC462]" />
              In-Car 12/13 Pairing
            </h2>
            <Card className="border border-gray-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Car className="h-4 w-4 text-amber-600" />
                  In-Car 12/13
                  <Badge className="bg-amber-100 text-amber-800 border-amber-200">Paired session</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
                  data-testid="disclaimer-incar-1213-pairing-panel"
                >
                  <p className="font-semibold">Important information about In-Car 12/13</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs sm:text-sm">
                    <li>This lesson requires two students. Your booking remains tentative until a second student is matched and both students confirm.</li>
                    <li>The lesson lasts two consecutive hours in a shared vehicle: one hour driving and one hour sitting in the back seat observing and evaluating.</li>
                    <li>If your partner unexpectedly does not show up, the lesson may be adjusted to Sessions 11 and 14.</li>
                  </ul>
                </div>
                {/* Pending offers — highest priority to act on */}
                {pairingOffers.map((offer) => {
                  const schedule = formatClassSchedule(offer.classId);
                  const info = findClassInfo(offer.classId);
                  return (
                    <div
                      key={`offer-${offer.id}`}
                      className="p-4 rounded-lg border border-purple-200 bg-purple-50"
                      data-testid={`card-pairing-offer-${offer.id}`}
                    >
                      <div className="flex items-start gap-2 mb-2">
                        <Users className="h-4 w-4 text-purple-600 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-semibold text-purple-900 text-sm">Pairing offer available</p>
                          <p className="text-xs text-purple-800 mt-0.5">
                            {schedule
                              ? <>In-Car 12/13 session on {schedule}{info?.instructorName ? ` with ${info.instructorName}` : ""}.</>
                              : "A partner has been found for your In-Car 12/13 session."}
                          </p>
                          <p className="text-[11px] text-purple-700 mt-1">
                            Respond before {new Date(offer.expiresAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="h-8 bg-green-600 hover:bg-green-700 text-white"
                          disabled={isPairingActionPending}
                          onClick={() => respondOfferMutation.mutate({ offerId: offer.id, action: "accept" })}
                          data-testid={`button-offer-accept-${offer.id}`}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-red-200 text-red-600 hover:bg-red-50"
                          disabled={isPairingActionPending}
                          onClick={() => respondOfferMutation.mutate({ offerId: offer.id, action: "decline" })}
                          data-testid={`button-offer-decline-${offer.id}`}
                        >
                          <XCircle className="h-3.5 w-3.5 mr-1" />
                          Decline
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {/* Pending confirmations */}
                {pairingConfirmations.map((confirmation) => {
                  const session = pairingSessions.find((s) => s.id === confirmation.pairedSessionId);
                  const schedule = session ? formatClassSchedule(session.classId) : null;
                  const info = session ? findClassInfo(session.classId) : undefined;
                  return (
                    <div
                      key={`confirmation-${confirmation.id}`}
                      className="p-4 rounded-lg border border-green-200 bg-green-50"
                      data-testid={`card-pairing-confirmation-${confirmation.id}`}
                    >
                      <div className="flex items-start gap-2 mb-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-semibold text-green-900 text-sm">Confirm your paired session</p>
                          <p className="text-xs text-green-800 mt-0.5">
                            {schedule
                              ? <>In-Car 12/13 session on {schedule}{info?.instructorName ? ` with ${info.instructorName}` : ""}.</>
                              : "Please confirm you'll attend your paired In-Car 12/13 session."}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="h-8 bg-green-600 hover:bg-green-700 text-white"
                          disabled={isPairingActionPending}
                          onClick={() => respondConfirmationMutation.mutate({ confirmationId: confirmation.id, action: "confirm" })}
                          data-testid={`button-confirmation-confirm-${confirmation.id}`}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-red-200 text-red-600 hover:bg-red-50"
                          disabled={isPairingActionPending}
                          onClick={async () => {
                            if (await confirmPairingCancellation(confirmation.id)) {
                              respondConfirmationMutation.mutate({ confirmationId: confirmation.id, action: "decline" });
                            }
                          }}
                          data-testid={`button-confirmation-decline-${confirmation.id}`}
                        >
                          <XCircle className="h-3.5 w-3.5 mr-1" />
                          Can't attend
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {/* Active queue-entry status */}
                {activeQueueEntry && (activeQueueEntry.status === "waiting") && (
                  <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 flex items-start justify-between gap-3" data-testid="card-pairing-waiting">
                    <div className="flex items-start gap-2">
                      <Timer className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-semibold text-amber-900 text-sm">You're in the queue</p>
                        <p className="text-xs text-amber-800 mt-0.5">We're finding you a partner for your In-Car 12/13 session.</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 border-red-200 text-red-600 hover:bg-red-50 flex-shrink-0"
                      disabled={isPairingActionPending}
                      onClick={async () => {
                        if (await confirmPairingCancellation()) leaveQueueMutation.mutate();
                      }}
                      data-testid="button-leave-queue"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      Leave
                    </Button>
                  </div>
                )}

                {activeQueueEntry && activeQueueEntry.status === "offered" && (
                  <div className="p-4 rounded-lg border border-purple-200 bg-purple-50 flex items-start gap-2" data-testid="card-pairing-offered">
                    <Users className="h-4 w-4 text-purple-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-purple-900 text-sm">Pairing offer sent</p>
                      <p className="text-xs text-purple-800 mt-0.5">Respond to the offer above to lock in your paired session.</p>
                    </div>
                  </div>
                )}

                {activeQueueEntry && activeQueueEntry.status === "booked_first" && (
                  <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 flex items-start justify-between gap-3" data-testid="card-pairing-booked-first">
                    <div className="flex items-start gap-2">
                      <Timer className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-semibold text-amber-900 text-sm">Waiting for a partner</p>
                        <p className="text-xs text-amber-800 mt-0.5">
                          You've reserved your In-Car 12/13 session
                          {formatClassSchedule(activeQueueEntry.bookedClassId) ? ` on ${formatClassSchedule(activeQueueEntry.bookedClassId)}` : ""}.
                          We'll match a second student with you.
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 border-red-200 text-red-600 hover:bg-red-50 flex-shrink-0"
                      disabled={isPairingActionPending}
                      onClick={async () => {
                        if (await confirmPairingCancellation()) leaveQueueMutation.mutate();
                      }}
                      data-testid="button-leave-queue"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      Leave
                    </Button>
                  </div>
                )}

                {activeQueueEntry && (activeQueueEntry.status === "paired" || activeQueueEntry.status === "confirmed") && pairingConfirmations.length === 0 && (
                  <div className="p-4 rounded-lg border border-green-200 bg-green-50 flex items-start gap-2" data-testid="card-pairing-paired">
                    <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-green-900 text-sm">
                        {activeQueueEntry.status === "confirmed" ? "Session confirmed" : "You're paired!"}
                      </p>
                      <p className="text-xs text-green-800 mt-0.5">
                        {activeQueueEntry.status === "confirmed"
                          ? "Your paired In-Car 12/13 session is confirmed. See you there!"
                          : "You've been matched with a partner for your In-Car 12/13 session."}
                        {formatClassSchedule(activeQueueEntry.bookedClassId) ? ` (${formatClassSchedule(activeQueueEntry.bookedClassId)})` : ""}
                      </p>
                    </div>
                  </div>
                )}

                {/* Join queue — only when eligible with no active entry */}
                {canJoinQueue && pairingOffers.length === 0 && pairingConfirmations.length === 0 && (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-gray-600">
                      Ready to be matched for your paired In-Car 12/13 session?
                    </p>
                    <Button
                      size="sm"
                      className="h-8 bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] flex-shrink-0"
                      disabled={isPairingActionPending}
                      onClick={() => joinQueueMutation.mutate()}
                      data-testid="button-join-queue"
                    >
                      <Users className="h-3.5 w-3.5 mr-1" />
                      Join pairing queue
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        )}

        {/* SAAQ Important Dates */}
        <section>
          <h2 className="text-xl font-bold text-[#111111] mb-4 flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-[#ECC462]" />
            SAAQ Important Dates
          </h2>
          {student?.learnerPermitValidDate ? (() => {
            const permitDate = new Date(student.learnerPermitValidDate as string);
            const knowledgeTestDue = new Date(permitDate);
            knowledgeTestDue.setMonth(knowledgeTestDue.getMonth() + 10);
            const roadTestDue = new Date(permitDate);
            roadTestDue.setMonth(roadTestDue.getMonth() + 12);
            const fmt = (d: Date) => {
              const dd = d.getDate().toString().padStart(2, '0');
              const mm = (d.getMonth() + 1).toString().padStart(2, '0');
              return `${dd}/${mm}/${d.getFullYear()}`;
            };
            const today = new Date();
            const kOverdue = knowledgeTestDue < today;
            const rOverdue = roadTestDue < today;
            return (
              <div className="grid sm:grid-cols-2 gap-4">
                <div className={`bg-white rounded-xl shadow-md p-6 border-l-4 ${kOverdue ? 'border-l-red-500' : 'border-l-[#ECC462]'}`}>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Knowledge Test Due</p>
                  <p className={`text-2xl font-bold ${kOverdue ? 'text-red-600' : 'text-[#111111]'}`}>{fmt(knowledgeTestDue)}</p>
                  <p className="text-xs text-gray-400 mt-1">10 months from learner's permit date</p>
                  {kOverdue && <p className="text-xs text-red-500 font-medium mt-1">Past due — contact your school</p>}
                </div>
                <div className={`bg-white rounded-xl shadow-md p-6 border-l-4 ${rOverdue ? 'border-l-red-500' : 'border-l-[#ECC462]'}`}>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Road Test Due</p>
                  <p className={`text-2xl font-bold ${rOverdue ? 'text-red-600' : 'text-[#111111]'}`}>{fmt(roadTestDue)}</p>
                  <p className="text-xs text-gray-400 mt-1">12 months from learner's permit date</p>
                  {rOverdue && <p className="text-xs text-red-500 font-medium mt-1">Past due — contact your school</p>}
                </div>
              </div>
            );
          })() : (
            <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-l-gray-300">
              <p className="text-sm text-gray-600">
                Your learner's permit date has not been recorded yet. Add your permit details to keep your SAAQ dates accurate and book driving classes.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 border-[#ECC462] text-[#111111] hover:bg-[#ECC462]/10"
                onClick={() => setLocation("/student/profile#learner-permit")}
                data-testid="button-add-permit-info"
              >
                Add Permit Info
              </Button>
            </div>
          )}
        </section>

        {/* Booking is now per-class: each row in the phase cards above has its
            own Book button, so the generic "Book a Class" entry point is gone. */}

        {/* Section 3: My Schedule */}
        <section>
          <h2 className="text-xl font-bold text-[#111111] mb-4">My Schedule</h2>
          <Card className="border-0 shadow-lg">
            <CardContent className="p-6">
              <CalendarView classes={classes} renderClassCard={renderClassCard} isUpcoming={true} />
            </CardContent>
          </Card>
        </section>
      </div>

      {/* Reschedule Modal */}
      {selectedEnrollmentId && (
        <RescheduleModal
          enrollmentId={selectedEnrollmentId}
          classDetails={selectedClass}
          open={rescheduleModalOpen}
          onOpenChange={setRescheduleModalOpen}
        />
      )}

      {/* Cancel Modal */}
      {selectedEnrollmentId && (
        <CancelModal
          enrollmentId={selectedEnrollmentId}
          classDetails={selectedClass}
          open={cancelModalOpen}
          onOpenChange={setCancelModalOpen}
        />
      )}

      {/* Booking Wizard Dialog */}
      <Dialog open={bookingWizardOpen} onOpenChange={(open) => {
        if (!open) {
          if (wizardStep === 4) {
            if (lastBookingPaired) {
              toast({
                title: "In-Car 12/13 reserved",
                description: "We're finding you a partner for your paired session.",
                variant: "success",
              });
            } else {
              toast({
                title: "Class Booked!",
                description: "Your class has been added to your schedule.",
                variant: "success",
              });
            }
          }
          setBookingWizardOpen(false);
          setWizardStep(2);
          setTargetClass(null);
          setSelectedBookingClass(null);
          setSelectedPairSecondClass(null);
          setPolicyAccepted(false);
          setLastBookingPaired(false);
        }
      }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-[#ECC462]" />
              Book {targetClass ? targetClass.label : "a Class"}
            </DialogTitle>
            <DialogDescription>
              {wizardStep === 2 && "Pick an available session for this class"}
              {wizardStep === 3 && "Review the booking policy before confirming"}
              {wizardStep === 4 && "Your class has been booked!"}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-1 mb-4">
            {[2, 3, 4].map((step) => (
              <div key={step} className="flex items-center flex-1">
                <div className={`h-1.5 w-full rounded-full transition-colors ${wizardStep >= step ? 'bg-[#ECC462]' : 'bg-gray-200'}`} />
              </div>
            ))}
          </div>

          {wizardStep === 2 && (
            <div>
              {isAutoCourse && targetClass?.classType === 'driving' && targetClass?.classNumber === 12 && (
                <div className="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200" data-testid="banner-combined-1213">
                  <div className="flex items-start gap-2">
                    <Users className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-amber-900 text-sm">Important information about In-Car 12/13</p>
                      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-amber-900">
                        <li>This lesson requires two students. Your booking remains tentative until a second student is matched and both students confirm.</li>
                        <li>The lesson lasts two consecutive hours in a shared vehicle: one hour driving and one hour sitting in the back seat observing and evaluating.</li>
                        <li>If your partner unexpectedly does not show up, the lesson may be adjusted to Sessions 11 and 14.</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {targetClass?.classType === 'driving' && student && (
                (!student.learnerPermitNumber || !student.learnerPermitExpiryDate || 
                 (student.learnerPermitExpiryDate && isPermitExpired(student.learnerPermitExpiryDate))) && (
                  <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200" data-testid="card-permit-warning">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-semibold text-red-800 text-sm">
                          {!student.learnerPermitNumber ? "Learner's Permit Required" : !student.learnerPermitExpiryDate ? "Permit Expiry Date Missing" : "Learner's Permit Expired"}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-1.5 h-7 text-xs border-red-300 text-red-700 hover:bg-red-50"
                          onClick={() => {
                            setBookingWizardOpen(false);
                            setLocation("/student/profile#learner-permit");
                          }}
                          data-testid="button-update-permit-required"
                        >
                          Update Permit Info
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              )}

              {targetClass?.classType === 'driving' && student &&
                student.learnerPermitNumber && student.learnerPermitExpiryDate &&
                !isPermitExpired(student.learnerPermitExpiryDate) &&
                isPermitExpiringSoon(student.learnerPermitExpiryDate) && (
                  <div className="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200" data-testid="card-permit-expiring-soon">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-semibold text-amber-800 text-sm">Permit Expiring Soon</p>
                        <p className="text-xs text-amber-700 mt-0.5">
                          Your learner's permit expires on {formatDate(student.learnerPermitExpiryDate)}. Renew it soon to keep booking driving classes.
                        </p>
                        <Button size="sm" variant="outline" className="mt-1.5 h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50" onClick={() => { setBookingWizardOpen(false); setLocation("/student/profile#learner-permit"); }} data-testid="button-update-permit-expiring">
                          Update Permit Info
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

              {availableClassesLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : bookableClasses.length === 0 ? (
                <div className="py-8 text-center">
                  <AlertCircle className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                  <p className="font-medium text-gray-600 text-sm">No sessions available right now</p>
                  <p className="text-xs text-gray-400 mt-1">Check back later for new openings.</p>
                </div>
              ) : (
                <>
                    {inCar56Pairs.length > 0 && (
                      <div className="mb-3 space-y-2" data-testid="list-incar-5-6-pairs">
                        <p className="text-xs font-medium text-gray-600">Available two-hour appointments</p>
                        {inCar56Pairs.map(({ first, second }) => (
                          <button
                            key={`${first.id}-${second.id}`}
                            type="button"
                            onClick={() => {
                              if (!hasSavedCard) {
                                setPendingCardClass(first);
                                setPendingCardPairSecondClass(second);
                                setBookingWizardOpen(false);
                                setIsCardDrawerOpen(true);
                                return;
                              }
                              setSelectedBookingClass(first);
                              setSelectedPairSecondClass(second);
                              setPolicyAccepted(false);
                              setWizardStep(3);
                            }}
                            className="w-full text-left p-3 rounded-lg border border-[#ECC462] bg-[#ECC462]/10 hover:bg-[#ECC462]/20 transition-colors"
                            data-testid={`button-book-incar-5-6-pair-${first.id}-${second.id}`}
                          >
                            <p className="font-semibold text-sm text-gray-900">Book In-Car 5 &amp; 6 together (2 hours)</p>
                            <p className="text-xs text-gray-600 mt-1">
                              {new Date(`${first.date}T${first.time}`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                              {" · "}{new Date(`${first.date}T${first.time}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                              {" – "}{new Date(`${second.date}T${second.time}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                              {" · "}{first.instructorName}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  <p className="text-xs text-gray-400 mb-2">
                    {bookableClasses.length} {bookableClasses.length === 1 ? 'session' : 'sessions'} available for {targetClass?.label}
                  </p>
                  <div className="space-y-2 max-h-[50vh] overflow-y-auto" data-testid="list-available-classes">
                    {paginatedBookableClasses.map((classItem) => {
                      const classDate = new Date(`${classItem.date}T${classItem.time}`);
                      const isFull = classItem.spotsRemaining <= 0;
                      const isBlocked = classItem.bookingAllowed === false;
                      const isDisabled = isFull || isBlocked;
                      const isLow = classItem.spotsRemaining <= 3 && classItem.spotsRemaining > 0;
                      return (
                        <button
                          key={classItem.id}
                          onClick={() => !isDisabled && handleSelectClass(classItem)}
                          disabled={isDisabled}
                          title={isBlocked ? classItem.blockingReason : undefined}
                          className={`w-full text-left p-3 rounded-lg border transition-all ${
                            isDisabled ? 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-60' : 'border-gray-200 bg-white hover:border-[#ECC462] hover:bg-[#ECC462]/5'
                          }`}
                          data-testid={`card-available-class-${classItem.id}`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex-shrink-0 text-center w-10">
                                <p className="text-xs font-medium text-gray-400 uppercase leading-tight">{classDate.toLocaleDateString("en-US", { weekday: "short" })}</p>
                                <p className="text-base font-bold text-gray-900 leading-tight">{classDate.toLocaleDateString("en-US", { day: "numeric" })}</p>
                                <p className="text-xs text-gray-500 leading-tight">{classDate.toLocaleDateString("en-US", { month: "short" })}</p>
                              </div>
                              <div className="min-w-0">
                                <p className="font-semibold text-sm text-gray-900 truncate" data-testid={`text-class-title-${classItem.id}`}>
                                  {classItem.pairedLesson
                                    ? `${classItem.courseType.toUpperCase()} - ${classItem.pairedLabel || 'In-Car 12/13'}`
                                    : `${classItem.courseType.toUpperCase()} - ${classItem.classType === 'driving' ? 'In-Car' : 'Theory'} #${classItem.classNumber}`}
                                </p>
                                {classItem.pairedLesson && (
                                  <span
                                    className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200"
                                    data-testid={`badge-paired-${classItem.id}`}
                                  >
                                    <Users className="h-2.5 w-2.5" />
                                    Paired · counts as 12 &amp; 13
                                  </span>
                                )}
                                <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{classDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                                  <span>{classItem.duration}min</span>
                                  {classItem.room && <span><MapPin className="h-3 w-3 inline" /> {classItem.room}</span>}
                                </div>
                                <p className="text-xs text-gray-400" data-testid={`text-instructor-${classItem.id}`}>{classItem.instructorName}</p>
                              </div>
                            </div>
                            <div className="flex-shrink-0 flex items-center gap-2">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                isFull ? 'bg-red-50 text-red-600' : isLow ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'
                              }`} data-testid={`badge-availability-${classItem.id}`}>
                                {isFull ? 'Full' : `${classItem.spotsRemaining} spots`}
                              </span>
                              {!isFull && <ChevronRight className="h-4 w-4 text-gray-300" />}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 mt-3">
                      <Button variant="outline" size="sm" className="h-7" disabled={safePage === 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))}>
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                      <span className="text-xs text-gray-500">{safePage} / {totalPages}</span>
                      <Button variant="outline" size="sm" className="h-7" disabled={safePage === totalPages} onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {wizardStep === 3 && selectedBookingClass && (
            <div>
              <button onClick={() => setWizardStep(2)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-3">
                <ChevronLeft className="h-4 w-4" /> Back
              </button>

              <div className="p-4 rounded-lg bg-[#ECC462]/10 border border-[#ECC462]/30 mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[#ECC462]/20">
                    <span className="text-[#ECC462]">{getCourseIcon(selectedBookingClass.courseType)}</span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900">
                      {selectedPairSecondClass
                        ? `${selectedBookingClass.courseType.toUpperCase()} - In-Car #5 & #6`
                        : selectedBookingClass.pairedLesson
                        ? `${selectedBookingClass.courseType.toUpperCase()} - ${selectedBookingClass.pairedLabel || 'In-Car 12/13'}`
                        : `${selectedBookingClass.courseType.toUpperCase()} - ${selectedBookingClass.classType === 'driving' ? 'In-Car' : 'Theory'} #${selectedBookingClass.classNumber}`}
                    </h4>
                    <p className="text-sm text-gray-600">{selectedBookingClass.instructorName}</p>
                  </div>
                </div>
                {selectedBookingClass.pairedLesson && (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900" data-testid="note-paired-confirm">
                    <p className="font-semibold">In-Car 12/13 booking disclaimer</p>
                    <ul className="mt-1.5 list-disc space-y-1 pl-4">
                      <li>This lesson requires two students and remains tentative until a second student is matched and both students confirm.</li>
                      <li>It lasts two consecutive hours: one hour driving and one hour observing and evaluating from the back seat.</li>
                      <li>If your partner unexpectedly does not show up, the lesson may be adjusted to Sessions 11 and 14.</li>
                    </ul>
                  </div>
                )}
                {selectedPairSecondClass && (
                  <p className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5" data-testid="note-incar-5-6-pair-confirm">
                    Two separate 60-minute lessons booked back-to-back: In-Car #5 at {new Date(`${selectedBookingClass.date}T${selectedBookingClass.time}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}, then In-Car #6 at {new Date(`${selectedPairSecondClass.date}T${selectedPairSecondClass.time}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.
                  </p>
                )}
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-gray-600">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-gray-400" />
                    {new Date(`${selectedBookingClass.date}T${selectedBookingClass.time}`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-gray-400" />
                    {new Date(`${selectedBookingClass.date}T${selectedBookingClass.time}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} ({selectedBookingClass.duration}min)
                  </div>
                  {selectedBookingClass.room && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-gray-400" />
                      Room {selectedBookingClass.room}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-gray-400" />
                    {selectedBookingClass.spotsRemaining} spots remaining
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-blue-50 border border-blue-200 mb-4">
                <h4 className="font-semibold text-gray-900 text-sm mb-3">Booking & Cancellation Policy</h4>
                <ul className="space-y-2 text-sm text-gray-700">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>Classes can be booked up to 30 days in advance with at least 24 hours notice</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>Maximum 2 classes per day</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                    <span>Free cancellation up to {cancelWindowHours} hours before class</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <span>Cancellation within {cancelWindowHours} hours incurs a fee</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                    <span>No-shows: $50 theory / $50 single in-car / $100 double in-car (charged automatically)</span>
                  </li>
                </ul>
              </div>

              <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:border-[#ECC462] cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={policyAccepted}
                  onChange={(e) => setPolicyAccepted(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#ECC462] focus:ring-[#ECC462]"
                />
                <span className="text-sm text-gray-700">I have read and understand the booking and cancellation policy</span>
              </label>

              <DialogFooter className="mt-4">
                <Button variant="outline" onClick={() => setWizardStep(2)}>Back</Button>
                <Button
                  onClick={confirmBooking}
                  disabled={!policyAccepted || bookClassMutation.isPending || bookInCar56PairMutation.isPending}
                  className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111]"
                  data-testid="button-confirm-booking"
                >
                  {(bookClassMutation.isPending || bookInCar56PairMutation.isPending) ? "Booking..." : "Confirm Booking"}
                </Button>
              </DialogFooter>
            </div>
          )}

          {wizardStep === 4 && selectedBookingClass && (
            <div className="text-center py-4">
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-1">
                {lastBookingPaired ? "In-Car 12/13 Reserved!" : "You're All Set!"}
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                {lastBookingPaired
                  ? "We're finding you a partner for your paired session."
                  : "Your class has been added to your schedule."}
              </p>

              <div className="p-4 rounded-lg bg-green-50 border border-green-200 text-left mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-100">
                    <span className="text-green-600">{getCourseIcon(selectedBookingClass.courseType)}</span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900">
                      {selectedBookingClass.pairedLesson || lastBookingPaired
                        ? `${selectedBookingClass.courseType.toUpperCase()} - ${selectedBookingClass.pairedLabel || 'In-Car 12/13'}`
                        : `${selectedBookingClass.courseType.toUpperCase()} - ${selectedBookingClass.classType === 'driving' ? 'In-Car' : 'Theory'} #${selectedBookingClass.classNumber}`}
                    </h4>
                    <p className="text-sm text-gray-600">{selectedBookingClass.instructorName}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-sm text-gray-600">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-gray-400" />
                    {new Date(`${selectedBookingClass.date}T${selectedBookingClass.time}`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-gray-400" />
                    {new Date(`${selectedBookingClass.date}T${selectedBookingClass.time}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </div>
                </div>
              </div>

              <Button
                onClick={() => setBookingWizardOpen(false)}
                className="w-full bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111]"
              >
                Done
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Card capture drawer — required before booking classes beyond #1 */}
      <Sheet open={isCardDrawerOpen} onOpenChange={(open) => {
        setIsCardDrawerOpen(open);
        if (!open) {
          setPendingCardClass(null);
          setPendingCardPairSecondClass(null);
        }
      }}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" data-testid="sheet-card-required">
          <SheetHeader>
            <SheetTitle className="text-[#111111]">Add a Payment Card</SheetTitle>
            <SheetDescription>
              A card on file is required to book classes beyond Class #1
              {pendingCardPairSecondClass
                ? " (you're booking In-Car #5 and #6 together)"
                : pendingCardClass
                  ? ` (you're booking Class #${pendingCardClass.classNumber})`
                  : ""}.
              You won't be charged now — your booking will continue once the card is saved.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            <CardCaptureForm onSaved={handleCardSaved} saveLabel="Save Card & Continue Booking" />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
