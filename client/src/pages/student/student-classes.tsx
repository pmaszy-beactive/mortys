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
} from "lucide-react";
import { useLocation } from "wouter";
import { useStudentAuth } from "@/hooks/useStudentAuth";
import { useState, useMemo, useEffect } from "react";
import type { Class } from "@shared/schema";
import type { PhaseProgressData } from "@shared/phaseConfig";
import PhaseProgressTracker, { PhaseProgressTrackerSkeleton } from "@/components/phase-progress-tracker";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

if (!import.meta.env.VITE_STRIPE_PUBLIC_KEY) {
  console.warn('Missing VITE_STRIPE_PUBLIC_KEY - payment features will not work');
}
const stripePromise = import.meta.env.VITE_STRIPE_PUBLIC_KEY 
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY)
  : null;

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

const getStatusBadge = (classItem: ClassWithDetails) => {
  const classDate = new Date(`${classItem.date}T${classItem.time}`);
  const now = new Date();
  
  if (classItem.status === 'cancelled') {
    return <Badge variant="destructive" data-testid={`badge-status-${classItem.id}`}><XCircle className="mr-1 h-3 w-3" />Cancelled</Badge>;
  }
  
  if (classItem.attendanceStatus === 'attended') {
    return <Badge className="bg-green-500 hover:bg-green-600" data-testid={`badge-status-${classItem.id}`}><CheckCircle2 className="mr-1 h-3 w-3" />Completed</Badge>;
  }
  
  if (classItem.attendanceStatus === 'absent' || classItem.attendanceStatus === 'no-show') {
    return <Badge variant="destructive" data-testid={`badge-status-${classItem.id}`}><XCircle className="mr-1 h-3 w-3" />Missed</Badge>;
  }
  
  if (classDate < now && classItem.status === 'scheduled') {
    return <Badge variant="secondary" data-testid={`badge-status-${classItem.id}`}>Pending Review</Badge>;
  }
  
  return <Badge className="bg-[#ECC462] text-[#111111] hover:bg-[#d4ad4f]" data-testid={`badge-status-${classItem.id}`}><Timer className="mr-1 h-3 w-3" />Upcoming</Badge>;
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
        <div className="flex-1 overflow-y-auto space-y-1.5 max-h-28 scrollbar-thin">
          {dayClasses.map((classItem, index) => {
            const isTheory = classItem.classNumber && classItem.classNumber <= 5;
            const hasOverlap = dayClasses.length > 1;
            return (
              <div 
                key={classItem.id}
                className={`text-xs p-1.5 rounded-md border-l-2 shadow-sm ${
                  isTheory 
                    ? 'bg-blue-50 text-blue-800 border-l-blue-500' 
                    : 'bg-amber-50 text-amber-800 border-l-amber-500'
                } ${hasOverlap ? 'relative z-' + (10 - index) : ''}`}
                title={`${classItem.courseType} - Class ${classItem.classNumber} at ${classItem.time}`}
              >
                <div className="font-medium leading-tight">
                  {classItem.time.slice(0, 5)}
                </div>
                <div className="leading-tight opacity-80">
                  {isTheory ? 'Theory' : 'Driving'} {classItem.classNumber}
                </div>
              </div>
            );
          })}
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

const CountdownTimer = ({ targetDate }: { targetDate: Date }) => {
  const [timeLeft, setTimeLeft] = useState("");
  
  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date();
      const diff = targetDate.getTime() - now.getTime();
      
      if (diff <= 0) {
        setTimeLeft("Starting soon!");
        return;
      }
      
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      
      if (days > 0) {
        setTimeLeft(`${days}d ${hours}h`);
      } else if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes}m`);
      } else {
        setTimeLeft(`${minutes}m`);
      }
    };
    
    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 60000);
    
    return () => clearInterval(interval);
  }, [targetDate]);
  
  return <span className="text-sm font-medium text-[#ECC462]">{timeLeft}</span>;
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
        description: error.response?.data?.message || "Failed to process reschedule",
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
        description: error.response?.data?.message || "Failed to process cancellation",
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
        description: error.response?.data?.message || "Failed to reschedule class",
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
        description: error.response?.data?.message || "Failed to create payment",
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
        description: error.response?.data?.message || "Failed to cancel class",
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
        description: error.response?.data?.message || "Failed to create payment",
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
                    {policy.feeRequired ? `$${policy.feeAmount.toFixed(2)} Cancellation Fee` : 'Free Cancellation'}
                  </p>
                  <p className={`text-sm ${policy.feeRequired ? 'text-red-800' : 'text-green-800'}`}>
                    {policy.feeRequired 
                      ? `This class is in ${policy.hoursUntilClass} hours (within the ${policy.restrictedWindowHours}-hour policy window). A $${policy.feeAmount.toFixed(2)} cancellation fee applies.`
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
                  onClick={policy.feeRequired ? handlePaidCancel : () => freeCancelMutation.mutate()}
                  disabled={freeCancelMutation.isPending}
                >
                  {policy.feeRequired ? 'Continue to Payment' : 'Confirm Cancellation'}
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
  const [, setLocation] = useLocation();
  const { student, isLoading: authLoading, isAuthenticated } = useStudentAuth();
  const { toast } = useToast();

  const [selectedClass, setSelectedClass] = useState<ClassWithDetails | null>(null);
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<number | null>(null);
  const [rescheduleModalOpen, setRescheduleModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);

  const [bookingWizardOpen, setBookingWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [activeBookingType, setActiveBookingType] = useState<'theory' | 'driving' | null>(null);
  const [selectedBookingClass, setSelectedBookingClass] = useState<AvailableClass | null>(null);
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

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

  const bookClassMutation = useMutation({
    mutationFn: async (classId: number) => {
      return await apiRequest("POST", `/api/student/classes/${classId}/book`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/classes/available"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/classes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/phase-progress"] });
      setWizardStep(4);
    },
    onError: (error: any) => {
      toast({
        title: "Booking Failed",
        description: error.response?.data?.message || "Failed to book class. Please try again.",
        variant: "destructive",
      });
    },
  });

  const bookableClasses = useMemo(() => {
    if (!activeBookingType || !availableClasses.length) return [];
    return availableClasses.filter(c => {
      const isTheory = c.classNumber <= 5;
      return activeBookingType === 'theory' ? isTheory : !isTheory;
    });
  }, [availableClasses, activeBookingType]);

  const totalPages = Math.max(1, Math.ceil(bookableClasses.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedBookableClasses = bookableClasses.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeBookingType]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      setLocation("/student/login");
    }
  }, [authLoading, isAuthenticated, setLocation]);

  if (authLoading || classesLoading) {
    return (
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
    );
  }

  const openBookingWizard = () => {
    setWizardStep(1);
    setActiveBookingType(null);
    setSelectedBookingClass(null);
    setPolicyAccepted(false);
    setCurrentPage(1);
    setBookingWizardOpen(true);
  };

  const handleSelectClassType = (type: 'theory' | 'driving') => {
    setActiveBookingType(type);
    setCurrentPage(1);
    setWizardStep(2);
  };

  const handleSelectClass = (classItem: AvailableClass) => {
    setSelectedBookingClass(classItem);
    setPolicyAccepted(false);
    setWizardStep(3);
  };

  const confirmBooking = () => {
    if (selectedBookingClass) {
      bookClassMutation.mutate(selectedBookingClass.id);
    }
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
    
    const isCompleted = classItem.attendanceStatus === 'attended' || classItem.status === 'completed';
    const isCancelled = classItem.status === 'cancelled';
    const isMissed = classItem.attendanceStatus === 'absent' || classItem.attendanceStatus === 'no-show';
    
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
                    {getStatusBadge(classItem)}
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
              {getStatusBadge(classItem)}
              
              {isUpcoming && classItem.status === 'scheduled' && (
                <>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 mb-1">Starts in</p>
                    <CountdownTimer targetDate={classDate} />
                  </div>
                  
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

  const drivingLocked = phaseInfo ? !phaseInfo.theoryComplete : true;

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-lg shadow-lg border-b border-[#ECC462]/20">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => setLocation("/student/classes")}
              className="hover:bg-[#ECC462]/10"
              data-testid="button-back"
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
            <PhaseProgressTracker phaseData={phaseProgressData} />
          ) : (
            <Card className="border-0 shadow-lg">
              <CardContent className="p-6 text-center text-gray-500">
                <p>Phase progress data is not available yet.</p>
              </CardContent>
            </Card>
          )}
        </section>

        {/* Book a Class Button */}
        <section>
          <Button
            onClick={openBookingWizard}
            className="w-full py-6 text-lg font-semibold bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] rounded-xl shadow-lg hover:shadow-xl transition-all"
            data-testid="button-book-class"
          >
            <BookOpen className="h-5 w-5 mr-2" />
            Book a Class
          </Button>
        </section>

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
            toast({
              title: "Class Booked!",
              description: "Your class has been added to your schedule.",
              variant: "success",
            });
          }
          setBookingWizardOpen(false);
          setWizardStep(1);
          setActiveBookingType(null);
          setSelectedBookingClass(null);
          setPolicyAccepted(false);
        }
      }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-[#ECC462]" />
              Book a Class
            </DialogTitle>
            <DialogDescription>
              {wizardStep === 1 && "Choose the type of class you'd like to book"}
              {wizardStep === 2 && `Select an available ${activeBookingType} class`}
              {wizardStep === 3 && "Review the booking policy before confirming"}
              {wizardStep === 4 && "Your class has been booked!"}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-1 mb-4">
            {[1, 2, 3, 4].map((step) => (
              <div key={step} className="flex items-center flex-1">
                <div className={`h-1.5 w-full rounded-full transition-colors ${wizardStep >= step ? 'bg-[#ECC462]' : 'bg-gray-200'}`} />
              </div>
            ))}
          </div>

          {wizardStep === 1 && (
            <div className="space-y-3">
              <button
                onClick={() => handleSelectClassType('theory')}
                className="w-full group text-left p-5 rounded-xl border-2 border-gray-200 bg-white hover:border-blue-400 hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-blue-100 group-hover:bg-blue-200 transition-colors">
                    <BookOpen className="h-6 w-6 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-gray-900">Theory Classes</h3>
                    {phaseInfo && <p className="text-sm text-gray-500">{phaseInfo.completedTheory}/{phaseInfo.theoryRequired} completed</p>}
                  </div>
                  <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-blue-400" />
                </div>
              </button>

              <button
                onClick={() => { if (!drivingLocked) handleSelectClassType('driving'); }}
                disabled={drivingLocked}
                className={`w-full group text-left p-5 rounded-xl border-2 transition-all ${
                  drivingLocked ? 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-60' : 'border-gray-200 bg-white hover:border-amber-400 hover:shadow-md'
                }`}
              >
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-xl transition-colors ${drivingLocked ? 'bg-gray-200' : 'bg-amber-100 group-hover:bg-amber-200'}`}>
                    {drivingLocked ? <Lock className="h-6 w-6 text-gray-400" /> : <Car className="h-6 w-6 text-amber-600" />}
                  </div>
                  <div className="flex-1">
                    <h3 className={`font-bold ${drivingLocked ? 'text-gray-400' : 'text-gray-900'}`}>Driving Classes</h3>
                    {drivingLocked ? (
                      <p className="text-sm text-gray-400">Complete theory classes first</p>
                    ) : phaseInfo ? (
                      <p className="text-sm text-gray-500">{phaseInfo.completedDriving}/{phaseInfo.drivingRequired} completed</p>
                    ) : null}
                  </div>
                  {drivingLocked ? <Lock className="h-5 w-5 text-gray-300" /> : <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-amber-400" />}
                </div>
              </button>
            </div>
          )}

          {wizardStep === 2 && (
            <div>
              <button onClick={() => setWizardStep(1)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-3">
                <ChevronLeft className="h-4 w-4" /> Back
              </button>

              {activeBookingType === 'driving' && student && (
                (!student.learnerPermitNumber || !student.learnerPermitExpiryDate || 
                 (student.learnerPermitExpiryDate && new Date(student.learnerPermitExpiryDate) < new Date())) && (
                  <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200" data-testid="card-permit-warning">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-semibold text-red-800 text-sm">
                          {!student.learnerPermitNumber ? "Learner's Permit Required" : !student.learnerPermitExpiryDate ? "Permit Expiry Date Missing" : "Learner's Permit Expired"}
                        </p>
                        <Button size="sm" variant="outline" className="mt-1.5 h-7 text-xs border-red-300 text-red-700 hover:bg-red-50" onClick={() => { setBookingWizardOpen(false); setLocation("/student/profile"); }}>
                          Update Permit Info
                        </Button>
                      </div>
                    </div>
                  </div>
                )
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
                  <p className="font-medium text-gray-600 text-sm">No classes available right now</p>
                  <p className="text-xs text-gray-400 mt-1">Check back later for new openings.</p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-gray-400 mb-2">
                    {bookableClasses.length} {activeBookingType} {bookableClasses.length === 1 ? 'class' : 'classes'} available
                  </p>
                  <div className="space-y-2 max-h-[50vh] overflow-y-auto" data-testid="list-available-classes">
                    {paginatedBookableClasses.map((classItem) => {
                      const classDate = new Date(`${classItem.date}T${classItem.time}`);
                      const isFull = classItem.spotsRemaining <= 0;
                      const isLow = classItem.spotsRemaining <= 3 && classItem.spotsRemaining > 0;
                      return (
                        <button
                          key={classItem.id}
                          onClick={() => !isFull && handleSelectClass(classItem)}
                          disabled={isFull}
                          className={`w-full text-left p-3 rounded-lg border transition-all ${
                            isFull ? 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-60' : 'border-gray-200 bg-white hover:border-[#ECC462] hover:bg-[#ECC462]/5'
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
                                  {classItem.courseType.toUpperCase()} - Class {classItem.classNumber}
                                </p>
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
                    <h4 className="font-semibold text-gray-900">{selectedBookingClass.courseType.toUpperCase()} - Class {selectedBookingClass.classNumber}</h4>
                    <p className="text-sm text-gray-600">{selectedBookingClass.instructorName}</p>
                  </div>
                </div>
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
                    <span>Free cancellation up to 48 hours before class</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <span>Cancellation within 48 hours incurs a fee</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                    <span>No-shows are charged the full class fee</span>
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
                  disabled={!policyAccepted || bookClassMutation.isPending}
                  className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111]"
                  data-testid="button-confirm-booking"
                >
                  {bookClassMutation.isPending ? "Booking..." : "Confirm Booking"}
                </Button>
              </DialogFooter>
            </div>
          )}

          {wizardStep === 4 && selectedBookingClass && (
            <div className="text-center py-4">
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-1">You're All Set!</h3>
              <p className="text-sm text-gray-600 mb-4">Your class has been added to your schedule.</p>

              <div className="p-4 rounded-lg bg-green-50 border border-green-200 text-left mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-100">
                    <span className="text-green-600">{getCourseIcon(selectedBookingClass.courseType)}</span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900">{selectedBookingClass.courseType.toUpperCase()} - Class {selectedBookingClass.classNumber}</h4>
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
    </div>
  );
}
