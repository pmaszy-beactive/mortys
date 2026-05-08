import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  MapPin,
  User,
  Users,
  CheckCircle2,
  AlertCircle,
  Filter,
  Info,
  AlertTriangle,
} from "lucide-react";
import { useLocation } from "wouter";
import { useStudentAuth } from "@/hooks/useStudentAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface AvailableClass {
  id: number;
  courseType: string;
  classNumber: number;
  classType?: string;
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

export default function BookClasses() {
  const [, setLocation] = useLocation();
  const { student, isLoading: authLoading, isAuthenticated } = useStudentAuth();
  const { toast } = useToast();
  const [courseTypeFilter, setCourseTypeFilter] = useState<string>("all");
  const [selectedClass, setSelectedClass] = useState<AvailableClass | null>(null);
  const [isBookingDialogOpen, setIsBookingDialogOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  const { data: classesResponse, isLoading: classesLoading } = useQuery<AvailableClassesResponse>({
    queryKey: ["/api/student/classes/available", { courseType: courseTypeFilter !== "all" ? courseTypeFilter : undefined }],
    enabled: isAuthenticated,
  });
  
  const availableClasses = classesResponse?.classes || [];
  const phaseInfo = classesResponse?.phaseInfo;

  const { data: instructors = [] } = useQuery({
    queryKey: ["/api/instructors"],
    enabled: isAuthenticated,
  });

  const bookClassMutation = useMutation({
    mutationFn: async (classId: number) => {
      return await apiRequest("POST", `/api/student/classes/${classId}/book`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/classes/available"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/classes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/history"] });
      setIsBookingDialogOpen(false);
      setSelectedClass(null);
      toast({
        title: "Class Booked!",
        description: "You've successfully enrolled in this class.",
        variant: "success",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Booking Failed",
        description: error.response?.data?.message || "Failed to book class. Please try again.",
        variant: "destructive",
      });
    },
  });

  const filteredClasses = useMemo(() => {
    return availableClasses.filter((classItem) => {
      if (courseTypeFilter !== "all" && classItem.courseType.toLowerCase() !== courseTypeFilter) {
        return false;
      }
      return true;
    });
  }, [availableClasses, courseTypeFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [courseTypeFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredClasses.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedClasses = filteredClasses.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Redirect to login if not authenticated
  if (!authLoading && !isAuthenticated) {
    setLocation("/student/login");
    return null;
  }

  // Loading state
  if (authLoading || classesLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  const handleBookClass = (classItem: AvailableClass) => {
    setSelectedClass(classItem);
    setIsBookingDialogOpen(true);
  };

  const confirmBooking = () => {
    if (selectedClass) {
      bookClassMutation.mutate(selectedClass.id);
    }
  };

  const renderClassCard = (classItem: AvailableClass) => {
    const classDate = new Date(`${classItem.date}T${classItem.time}`);
    const formattedDate = classDate.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const formattedTime = classDate.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });

    const isFull = classItem.spotsRemaining <= 0;
    const isLowAvailability = classItem.spotsRemaining <= 3 && classItem.spotsRemaining > 0;
    // bookingAllowed defaults to true for backward compatibility (non-auto courses etc.)
    const isBlocked = classItem.bookingAllowed === false;
    const classLabel = classItem.classType === "driving"
      ? `${classItem.courseType.toUpperCase()} - In-Car #${classItem.classNumber}`
      : `${classItem.courseType.toUpperCase()} - Theory #${classItem.classNumber}`;

    return (
      <Card
        key={classItem.id}
        className={`rounded-md shadow-sm transition-colors ${
          isBlocked
            ? "bg-gray-50 border border-gray-200 opacity-75"
            : "bg-white border border-gray-200 hover:border-[#ECC462]"
        }`}
        data-testid={`card-available-class-${classItem.id}`}
      >
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            {/* Left Section */}
            <div className="flex-1 space-y-3">
              {/* Course Type and Class Number */}
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-md border ${isBlocked ? "bg-gray-100 border-gray-200" : "bg-gray-50 border-gray-200"}`}>
                  <span className={isBlocked ? "text-gray-400" : "text-gray-600"}>
                    {getCourseIcon(classItem.courseType)}
                  </span>
                </div>
                <div>
                  <h3 className={`font-semibold text-lg ${isBlocked ? "text-gray-400" : "text-gray-900"}`} data-testid={`text-class-title-${classItem.id}`}>
                    {classLabel}
                  </h3>
                  <p className="text-sm text-gray-400">
                    <span className="flex items-center gap-1" data-testid={`text-instructor-${classItem.id}`}>
                      <User className="h-3 w-3" />
                      {classItem.instructorName}
                    </span>
                  </p>
                </div>
              </div>

              {/* Date and Time */}
              <div className={`flex flex-wrap gap-4 text-sm ${isBlocked ? "text-gray-400" : "text-gray-600"}`}>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  <span data-testid={`text-date-${classItem.id}`}>{formattedDate}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  <span data-testid={`text-time-${classItem.id}`}>{formattedTime}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  <span data-testid={`text-duration-${classItem.id}`}>{classItem.duration} min</span>
                </div>
              </div>

              {/* Additional Details */}
              <div className="flex flex-wrap gap-3">
                {classItem.room && (
                  <div className={`flex items-center gap-1 text-sm px-3 py-1 rounded-md border ${isBlocked ? "bg-gray-100 text-gray-400 border-gray-200" : "bg-gray-100 text-gray-700 border-gray-200"}`} data-testid={`badge-room-${classItem.id}`}>
                    <MapPin className="h-3 w-3" />
                    <span>Room {classItem.room}</span>
                  </div>
                )}
                {!isBlocked && (
                  <div className={`flex items-center gap-1 text-sm px-3 py-1 rounded-md border ${
                    isFull ? "bg-red-50 text-red-700 border-red-100" : isLowAvailability ? "bg-amber-50 text-amber-700 border-amber-100" : "bg-green-50 text-green-700 border-green-100"
                  }`} data-testid={`badge-availability-${classItem.id}`}>
                    <Users className="h-3 w-3" />
                    <span>
                      {classItem.spotsRemaining} {classItem.spotsRemaining === 1 ? 'spot' : 'spots'} left
                    </span>
                  </div>
                )}
              </div>

              {/* Phase blocking reason */}
              {isBlocked && classItem.blockingReason && (
                <div className="flex items-start gap-2 mt-2 p-3 bg-amber-50 border border-amber-200 rounded-md">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-amber-800">{classItem.blockingReason}</p>
                </div>
              )}
            </div>

            {/* Right Section - Booking Button */}
            <div className="flex flex-col items-end gap-2 shrink-0">
              {isBlocked ? (
                <div className="flex items-center gap-1 px-3 py-2 rounded-md bg-gray-100 border border-gray-200 text-sm text-gray-400 font-medium">
                  <AlertCircle className="h-4 w-4" />
                  Not Yet Available
                </div>
              ) : (
                <Button
                  onClick={() => handleBookClass(classItem)}
                  disabled={isFull || bookClassMutation.isPending}
                  className={`${
                    isFull
                      ? "bg-gray-100 text-gray-400 border-gray-200"
                      : "bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] shadow-none"
                  }`}
                  data-testid={`button-book-${classItem.id}`}
                >
                  {isFull ? "Class Full" : "Book Class"}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-gray-200 rounded-md shadow-sm p-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/student/classes")}
            className="hover:bg-gray-100 h-10 w-10 shrink-0"
            data-testid="button-back"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Book a Class
            </h1>
            <p className="text-sm text-gray-600">
              Browse and enroll in available classes
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="space-y-6">
        {/* Phase Info Banner */}
        {phaseInfo && (
          <Card className="border border-gray-200 rounded-md shadow-sm border-l-4 border-l-[#ECC462]" data-testid="card-phase-info">
            <CardContent className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="font-semibold text-lg text-gray-900" data-testid="text-current-phase">
                    Current Phase: {phaseInfo.currentPhase}
                  </h3>
                  <p className="text-sm text-gray-600" data-testid="text-phase-description">
                    {!phaseInfo.theoryComplete ? (
                      <>Complete your theory classes to unlock driving sessions. Progress: {phaseInfo.completedTheory}/{phaseInfo.theoryRequired} theory classes completed.</>
                    ) : (
                      <>You can book both theory and driving classes. Theory: {phaseInfo.completedTheory}/{phaseInfo.theoryRequired} | Driving: {phaseInfo.completedDriving}/{phaseInfo.drivingRequired}</>
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  {phaseInfo.allowedClassTypes.map((type) => (
                    <Badge 
                      key={type} 
                      variant="outline" 
                      className="bg-gray-50 border-gray-200 text-gray-700 rounded-sm"
                      data-testid={`badge-allowed-${type}`}
                    >
                      {type === 'theory' ? 'Theory Classes' : 'Driving Classes'}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Permit Warning Banner */}
        {student && phaseInfo?.allowedClassTypes.includes('driving') && (
          (!student.learnerPermitNumber || !student.learnerPermitExpiryDate || 
           (student.learnerPermitExpiryDate && new Date(student.learnerPermitExpiryDate) < new Date())) && (
            <Card className="border border-red-200 rounded-md shadow-sm border-l-4 border-l-red-500 bg-red-50" data-testid="card-permit-warning">
              <CardContent className="p-6">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
                  <div className="space-y-2">
                    <h3 className="font-semibold text-red-800">
                      {!student.learnerPermitNumber 
                        ? "Learner's Permit Required" 
                        : !student.learnerPermitExpiryDate
                        ? "Permit Expiry Date Missing"
                        : "Learner's Permit Expired"}
                    </h3>
                    <p className="text-sm text-red-700">
                      {!student.learnerPermitNumber 
                        ? "You need a valid learner's permit on file to book driving classes. Please update your permit information in your profile."
                        : !student.learnerPermitExpiryDate
                        ? "Please add your permit expiration date in your profile to book driving classes."
                        : `Your learner's permit expired on ${new Date(student.learnerPermitExpiryDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. Please renew your permit and update your profile.`}
                    </p>
                    <Button 
                      size="sm"
                      variant="outline"
                      className="border-red-200 text-red-700 hover:bg-white bg-white/50"
                      onClick={() => setLocation("/student/profile")}
                    >
                      Update Permit Info
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        )}

        {/* Booking Rules & Cancellation Policy */}
        <Card className="border border-blue-200 rounded-md shadow-sm bg-blue-50/30" data-testid="card-booking-rules">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="space-y-3">
                <h3 className="font-semibold text-gray-900">Booking & Cancellation Rules</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-sm">
                  <div className="space-y-2">
                    <p className="font-medium text-gray-700">Booking Policy:</p>
                    <ul className="space-y-2 text-gray-600">
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <span>Book classes up to 1 year in advance</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <span>Maximum 2 classes per day</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <span>Minimum 24 hours notice required</span>
                      </li>
                    </ul>
                  </div>
                  <div className="space-y-2">
                    <p className="font-medium text-gray-700">Cancellation Policy:</p>
                    <ul className="space-y-2 text-gray-600">
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <span>Free cancellation up to 48 hours before class</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                        <span>Cancellation fee applies within 48 hours of class</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                        <span>No-shows are charged full class fee</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Filters */}
        <Card className="border border-gray-200 rounded-md shadow-sm">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Filter by:</span>
              </div>
              <Select value={courseTypeFilter} onValueChange={setCourseTypeFilter}>
                <SelectTrigger className="w-[150px] rounded-md" data-testid="select-course-filter">
                  <SelectValue placeholder="Course Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Courses</SelectItem>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="moto">Moto</SelectItem>
                  <SelectItem value="scooter">Scooter</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Available Classes List */}
        {filteredClasses.length === 0 ? (
          <Card className="border border-gray-200 rounded-md shadow-sm">
            <CardContent className="p-12 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="bg-gray-50 rounded-full p-6 border border-gray-100">
                  <AlertCircle className="h-12 w-12 text-gray-300" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">No Available Classes</h3>
                  <p className="text-gray-600 max-w-md mx-auto">
                    There are no available classes matching your filters at the moment. Please check back later or adjust your filters.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-4 px-1">
              Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filteredClasses.length)} of {filteredClasses.length} available classes
            </p>
            <div className="space-y-4" data-testid="list-available-classes">
              {paginatedClasses.map((classItem) => renderClassCard(classItem))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-8">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={safePage === 1}
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  data-testid="button-prev-page"
                  className="rounded-md"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <div className="flex items-center gap-1">
                  {(() => {
                    const pages: (number | string)[] = [];
                    if (totalPages <= 7) {
                      for (let i = 1; i <= totalPages; i++) pages.push(i);
                    } else {
                      pages.push(1);
                      if (safePage > 3) pages.push("...");
                      for (let i = Math.max(2, safePage - 1); i <= Math.min(totalPages - 1, safePage + 1); i++) {
                        pages.push(i);
                      }
                      if (safePage < totalPages - 2) pages.push("...");
                      pages.push(totalPages);
                    }
                    return pages.map((page, idx) =>
                      typeof page === "string" ? (
                        <span key={`ellipsis-${idx}`} className="px-2 text-gray-400">...</span>
                      ) : (
                        <Button
                          key={page}
                          variant={page === safePage ? "default" : "outline"}
                          size="sm"
                          className={page === safePage ? "bg-[#ECC462] text-[#111111] hover:bg-[#d4ad4f] border-[#ECC462] rounded-md" : "rounded-md"}
                          onClick={() => setCurrentPage(page)}
                          data-testid={`button-page-${page}`}
                        >
                          {page}
                        </Button>
                      )
                    );
                  })()}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={safePage === totalPages}
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  data-testid="button-next-page"
                  className="rounded-md"
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Booking Confirmation Dialog */}
      <Dialog open={isBookingDialogOpen} onOpenChange={setIsBookingDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-[#ECC462]" />
              Confirm Class Booking
            </DialogTitle>
            <DialogDescription>
              Please confirm you want to book this class
            </DialogDescription>
          </DialogHeader>
          
          {selectedClass && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[#ECC462]/10">
                  <span className="text-[#ECC462]">
                    {getCourseIcon(selectedClass.courseType)}
                  </span>
                </div>
                <div>
                  <h4 className="font-semibold">
                    {selectedClass.courseType.toUpperCase()} - Class {selectedClass.classNumber}
                  </h4>
                  <p className="text-sm text-gray-600">{selectedClass.instructorName}</p>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-gray-500" />
                  <span>{new Date(`${selectedClass.date}T${selectedClass.time}`).toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-gray-500" />
                  <span>{new Date(`${selectedClass.date}T${selectedClass.time}`).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })} ({selectedClass.duration} minutes)</span>
                </div>
                {selectedClass.room && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-gray-500" />
                    <span>Room {selectedClass.room}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="flex-row gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsBookingDialogOpen(false)}
              disabled={bookClassMutation.isPending}
              data-testid="button-cancel-booking"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmBooking}
              disabled={bookClassMutation.isPending}
              className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111]"
              data-testid="button-confirm-booking"
            >
              {bookClassMutation.isPending ? "Booking..." : "Confirm Booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
