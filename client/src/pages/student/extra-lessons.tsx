import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  MapPin,
  User,
  Users,
  CheckCircle2,
  AlertCircle,
  DollarSign,
  Sparkles,
  CreditCard,
  BookOpen
} from "lucide-react";
import { useLocation } from "wouter";
import { useStudentAuth } from "@/hooks/useStudentAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { format } from "date-fns";

const stripePromise = import.meta.env.VITE_STRIPE_PUBLIC_KEY
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY)
  : null;

interface ExtraLesson {
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
  spotsAvailable: number;
  isExtra: boolean;
  price: number | null;
  topic: string | null;
  classType: string;
  alreadyBooked: boolean;
  priceDisplay: string;
}

interface BookingResponse {
  enrollmentId: number;
  paymentRequired: boolean;
  clientSecret?: string;
  amount?: number;
  amountDisplay?: string;
  message?: string;
}

const getCourseIcon = (courseType: string) => {
  switch (courseType?.toLowerCase()) {
    case "auto":
      return <Car className="h-5 w-5" />;
    case "moto":
      return <Bike className="h-5 w-5" />;
    case "scooter":
      return <Bike className="h-4 w-4" />;
    default:
      return <Car className="h-5 w-5" />;
  }
};

function PaymentForm({ 
  clientSecret, 
  enrollmentId,
  onSuccess, 
  onCancel 
}: { 
  clientSecret: string; 
  enrollmentId: number;
  onSuccess: () => void; 
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsProcessing(true);
    setError(null);

    try {
      const { error: submitError, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.origin + '/student/classes',
        },
        redirect: 'if_required',
      });

      if (submitError) {
        setError(submitError.message || 'Payment failed');
        setIsProcessing(false);
        return;
      }

      if (paymentIntent && paymentIntent.status === 'succeeded') {
        await apiRequest('POST', `/api/student/extra-lessons/${enrollmentId}/confirm-payment`, {
          paymentIntentId: paymentIntent.id
        });
        
        toast({
          title: "Payment Successful!",
          description: "Your extra lesson has been booked.",
          variant: "success",
        });
        onSuccess();
      }
    } catch (err: any) {
      setError(err.message || 'Payment failed');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {error && (
        <div className="text-red-600 text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}
      <div className="flex gap-3 justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isProcessing}>
          Cancel
        </Button>
        <Button 
          type="submit" 
          disabled={!stripe || isProcessing}
          className="bg-[#ECC462] text-black hover:bg-[#d4b055]"
        >
          {isProcessing ? 'Processing...' : 'Pay Now'}
        </Button>
      </div>
    </form>
  );
}

export default function ExtraLessons() {
  const [, setLocation] = useLocation();
  const { student, isLoading: authLoading, isAuthenticated } = useStudentAuth();
  const { toast } = useToast();
  const [selectedLesson, setSelectedLesson] = useState<ExtraLesson | null>(null);
  const [isBookingDialogOpen, setIsBookingDialogOpen] = useState(false);
  const [paymentData, setPaymentData] = useState<BookingResponse | null>(null);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);

  const { data: extraLessons = [], isLoading } = useQuery<ExtraLesson[]>({
    queryKey: ["/api/student/extra-lessons"],
    enabled: isAuthenticated,
  });

  const bookMutation = useMutation({
    mutationFn: async (classId: number) => {
      const response = await apiRequest("POST", `/api/student/extra-lessons/${classId}/book`);
      return response.json();
    },
    onSuccess: (data: BookingResponse) => {
      setIsBookingDialogOpen(false);
      
      if (data.paymentRequired && data.clientSecret) {
        setPaymentData(data);
        setIsPaymentDialogOpen(true);
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/student/extra-lessons"] });
        queryClient.invalidateQueries({ queryKey: ["/api/student/classes"] });
        queryClient.invalidateQueries({ queryKey: ["/api/student/history"] });
        toast({
          title: "Lesson Booked!",
          description: data.message || "Your extra lesson has been booked successfully.",
          variant: "success",
        });
        setSelectedLesson(null);
      }
    },
    onError: (error: any) => {
      toast({
        title: "Booking Failed",
        description: error.message || "Failed to book lesson. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handlePaymentSuccess = () => {
    setIsPaymentDialogOpen(false);
    setPaymentData(null);
    setSelectedLesson(null);
    queryClient.invalidateQueries({ queryKey: ["/api/student/extra-lessons"] });
    queryClient.invalidateQueries({ queryKey: ["/api/student/classes"] });
    queryClient.invalidateQueries({ queryKey: ["/api/student/history"] });
  };

  const handlePaymentCancel = () => {
    setIsPaymentDialogOpen(false);
    setPaymentData(null);
    toast({
      title: "Payment Cancelled",
      description: "Your booking has been cancelled. You can try again later.",
      variant: "default",
    });
  };

  if (!authLoading && !isAuthenticated) {
    setLocation("/student/login");
    return null;
  }

  if (authLoading || isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-md shadow-sm px-6 py-5">
        <Button
          variant="ghost"
          size="sm"
          className="mb-3 -ml-2"
          onClick={() => setLocation('/student/dashboard')}
          data-testid="button-back"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back to Dashboard
        </Button>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#ECC462]/15 rounded-md border-l-4 border-[#111111]">
            <Sparkles className="h-5 w-5 text-[#111111]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Extra Lessons</h1>
            <p className="text-sm text-gray-500">Book additional practice sessions beyond your course</p>
          </div>
        </div>
      </div>

      {/* Info banner */}
      <Card className="border border-blue-200 bg-blue-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-medium text-blue-900">About Extra Lessons</h3>
              <p className="text-sm text-blue-700">
                Extra lessons are optional practice sessions you can book in addition to your regular course.
                Payment is required at the time of booking.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {extraLessons.length === 0 ? (
        <Card className="border border-gray-200">
          <CardContent className="p-8 text-center">
            <BookOpen className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Extra Lessons Available</h3>
            <p className="text-gray-500">
              There are no extra lessons available at the moment. Check back later or contact the school for more information.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {extraLessons.map((lesson) => (
            <Card 
              key={lesson.id} 
              className={`border border-gray-200 shadow-sm hover:shadow-md transition-shadow bg-white ${
                lesson.alreadyBooked ? 'opacity-75' : ''
              }`}
              data-testid={`card-extra-lesson-${lesson.id}`}
            >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${
                        lesson.classType === 'theory' ? 'bg-blue-100' : 'bg-green-100'
                      }`}>
                        {lesson.classType === 'theory' 
                          ? <BookOpen className="h-5 w-5 text-blue-700" />
                          : getCourseIcon(lesson.courseType)
                        }
                      </div>
                      <div>
                        <h3 className="font-bold text-lg">
                          {lesson.topic || `${lesson.classType === 'theory' ? 'Theory' : 'Driving'} Practice`}
                        </h3>
                        <Badge variant="outline" className="capitalize">
                          {lesson.courseType}
                        </Badge>
                      </div>
                    </div>
                    <Badge className="bg-[#ECC462] text-black">
                      <DollarSign className="h-3 w-3 mr-1" />
                      {lesson.priceDisplay}
                    </Badge>
                  </div>

                  <div className="space-y-2 text-sm text-gray-600 mb-4">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      <span>{format(new Date(lesson.date), 'EEE, MMM d, yyyy')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      <span>{formatTime(lesson.time)} ({lesson.duration} min)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4" />
                      <span>{lesson.instructorName}</span>
                    </div>
                    {lesson.room && (
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        <span>Room {lesson.room}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      <span className={lesson.spotsAvailable <= 2 ? 'text-amber-600' : 'text-green-600'}>
                        {lesson.spotsAvailable} spot{lesson.spotsAvailable !== 1 ? 's' : ''} available
                      </span>
                    </div>
                  </div>

                  {lesson.alreadyBooked ? (
                    <Button disabled className="w-full bg-gray-100 text-gray-500">
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Already Booked
                    </Button>
                  ) : (
                    <Button 
                      className="w-full bg-[#ECC462] text-black hover:bg-[#d4b055]"
                      onClick={() => {
                        setSelectedLesson(lesson);
                        setIsBookingDialogOpen(true);
                      }}
                      data-testid={`button-book-${lesson.id}`}
                    >
                      <CreditCard className="h-4 w-4 mr-2" />
                      Book & Pay
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

      <Dialog open={isBookingDialogOpen} onOpenChange={setIsBookingDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Booking</DialogTitle>
            <DialogDescription>
              You're about to book an extra lesson
            </DialogDescription>
          </DialogHeader>
          
          {selectedLesson && (
            <div className="py-4">
              <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Lesson</span>
                  <span className="font-medium">
                    {selectedLesson.topic || `${selectedLesson.classType === 'theory' ? 'Theory' : 'Driving'} Practice`}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Date</span>
                  <span className="font-medium">{format(new Date(selectedLesson.date), 'MMM d, yyyy')}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Time</span>
                  <span className="font-medium">{formatTime(selectedLesson.time)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Duration</span>
                  <span className="font-medium">{selectedLesson.duration} minutes</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Instructor</span>
                  <span className="font-medium">{selectedLesson.instructorName}</span>
                </div>
                <div className="border-t pt-3 mt-3">
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-medium">Total</span>
                    <span className="text-lg font-bold text-[#111111]">{selectedLesson.priceDisplay}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBookingDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              className="bg-[#ECC462] text-black hover:bg-[#d4b055]"
              onClick={() => selectedLesson && bookMutation.mutate(selectedLesson.id)}
              disabled={bookMutation.isPending}
              data-testid="button-confirm-booking"
            >
              {bookMutation.isPending ? 'Processing...' : 'Proceed to Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Complete Payment
            </DialogTitle>
            <DialogDescription>
              {paymentData?.amountDisplay && `Amount: ${paymentData.amountDisplay}`}
            </DialogDescription>
          </DialogHeader>
          
          {paymentData?.clientSecret && stripePromise && (
            <Elements stripe={stripePromise} options={{ clientSecret: paymentData.clientSecret }}>
              <PaymentForm 
                clientSecret={paymentData.clientSecret}
                enrollmentId={paymentData.enrollmentId}
                onSuccess={handlePaymentSuccess}
                onCancel={handlePaymentCancel}
              />
            </Elements>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
