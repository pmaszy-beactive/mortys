import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, CheckCircle, Clock, UserCheck, LogIn, LogOut, User, AlertTriangle, ClipboardCheck, UserX, Undo2 } from "lucide-react";
import { useInstructorAuth } from "@/hooks/useInstructorAuth";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import SignaturePad, { SignaturePadRef } from "@/components/signature-pad";
import type { Class, ClassEnrollment } from "@shared/schema";

interface EnrollmentWithStudent extends ClassEnrollment {
  student: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  } | null;
}

export default function LessonCheckIn() {
  const [, params] = useRoute("/instructor/lesson/:classId/check-in");
  const classId = params?.classId ? parseInt(params.classId) : null;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { instructor, isLoading: authLoading, isAuthenticated } = useInstructorAuth();
  
  const [signatureDialog, setSignatureDialog] = useState<{
    enrollmentId: number;
    studentName: string;
    type: "check-in" | "check-out";
  } | null>(null);
  const [noShowConfirm, setNoShowConfirm] = useState<{
    enrollmentId: number;
    studentName: string;
  } | null>(null);
  const [undoConfirm, setUndoConfirm] = useState<{
    enrollmentId: number;
    studentName: string;
    currentStatus: string;
  } | null>(null);
  const signaturePadRef = useRef<SignaturePadRef>(null);

  const { data: classData, isLoading: classLoading } = useQuery<Class>({
    queryKey: ["/api/classes", classId],
    enabled: !!classId,
  });

  const { data: enrollments = [], isLoading: enrollmentsLoading, error: enrollmentsError, refetch } = useQuery<EnrollmentWithStudent[]>({
    queryKey: ["/api/classes", classId, "attendance"],
    queryFn: async () => {
      const res = await fetch(`/api/classes/${classId}/attendance`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch attendance");
      return res.json();
    },
    enabled: !!classId,
    refetchInterval: 5000,
    retry: 1,
  });

  const { data: evaluations = [] } = useQuery<Array<{ id: number; classId: number; signedOff: boolean; instructorSignature: string | null; studentSignature: string | null }>>({
    queryKey: ["/api/instructor/evaluations"],
    enabled: !!instructor,
  });

  const hasEvaluation = useMemo(() => {
    if (!classId) return false;
    return evaluations.some(
      e => e.classId === classId && (e.signedOff || (e.instructorSignature && e.studentSignature))
    );
  }, [evaluations, classId]);

  const checkInMutation = useMutation({
    mutationFn: ({ enrollmentId, signature }: { enrollmentId: number; signature: string }) =>
      apiRequest("POST", `/api/class-enrollments/${enrollmentId}/check-in`, { signature }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/classes", classId, "attendance"] });
      toast({ title: "Success", description: "Student checked in successfully" });
      setSignatureDialog(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to check in student", variant: "destructive" });
    },
  });

  const checkOutMutation = useMutation({
    mutationFn: ({ enrollmentId, signature }: { enrollmentId: number; signature: string }) =>
      apiRequest("POST", `/api/class-enrollments/${enrollmentId}/check-out`, { signature }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/classes", classId, "attendance"] });
      toast({ title: "Success", description: "Student checked out successfully" });
      setSignatureDialog(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to check out student", variant: "destructive" });
    },
  });

  const noShowMutation = useMutation({
    mutationFn: (enrollmentId: number) =>
      apiRequest("POST", `/api/class-enrollments/${enrollmentId}/no-show`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/classes", classId, "attendance"] });
      toast({ title: "Marked as No-Show", description: "Student has been marked as a no-show for this lesson." });
      setNoShowConfirm(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to mark student as no-show", variant: "destructive" });
    },
  });

  const resetAttendanceMutation = useMutation({
    mutationFn: async (enrollmentId: number) => {
      const res = await fetch(`/api/class-enrollments/${enrollmentId}/reset-attendance`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to reset attendance");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/classes", classId, "attendance"] });
      toast({ title: "Attendance Reset", description: "Student attendance has been reset. You can now re-do the sign-in." });
      setUndoConfirm(null);
    },
    onError: (error: Error) => {
      toast({ title: "Cannot Reset", description: error.message, variant: "destructive" });
      setUndoConfirm(null);
    },
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      setLocation("/instructor/login");
    }
  }, [authLoading, isAuthenticated, setLocation]);

  useEffect(() => {
    if (signatureDialog) {
      setTimeout(() => signaturePadRef.current?.clear(), 100);
    }
  }, [signatureDialog]);

  const handleSubmitSignature = () => {
    if (!signatureDialog) return;
    
    const signature = signaturePadRef.current?.getSignature();
    if (!signature) {
      toast({ title: "Error", description: "Please sign before submitting", variant: "destructive" });
      return;
    }

    if (signatureDialog.type === "check-in") {
      checkInMutation.mutate({ enrollmentId: signatureDialog.enrollmentId, signature });
    } else {
      checkOutMutation.mutate({ enrollmentId: signatureDialog.enrollmentId, signature });
    }
  };

  const isSameDay = useMemo(() => {
    if (!classData) return false;
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return classData.date === todayStr;
  }, [classData]);

  const getAttendanceStatus = (enrollment: EnrollmentWithStudent) => {
    if ((enrollment as any).attendanceStatus === "no-show") {
      return { status: "no-show", label: "No-Show", color: "bg-red-100 text-red-800" };
    }
    if (enrollment.checkOutAt) {
      return { status: "completed", label: "Completed", color: "bg-green-100 text-green-800" };
    }
    if (enrollment.checkInAt) {
      return { status: "checked_in", label: "Checked In", color: "bg-blue-100 text-blue-800" };
    }
    return { status: "registered", label: "Not Checked In", color: "bg-gray-100 text-gray-800" };
  };

  if (authLoading || !isAuthenticated || classLoading || enrollmentsLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#ECC462] mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (enrollmentsError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-2">Unable to load student attendance.</p>
          <p className="text-sm text-gray-400 mb-4">Please try again or go back to your schedule.</p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" className="rounded-md" onClick={() => refetch()}>
              Try Again
            </Button>
            <Button className="bg-[#ECC462] hover:bg-[#d4af56] text-[#111111] rounded-md" onClick={() => setLocation("/instructor/schedule")}>
              Back to Schedule
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!classId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Invalid class. Please go back and try again.</p>
          <Button className="mt-4 bg-[#ECC462] hover:bg-[#d4af56] text-[#111111] rounded-md" onClick={() => setLocation("/instructor/schedule")}>
            Back to Schedule
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setLocation("/instructor/schedule")}
            data-testid="button-back"
            className="rounded-md border-gray-200 hover:bg-gray-100"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900" data-testid="text-page-title">
              Lesson Check-In
            </h1>
            {classData && (
              <p className="text-gray-600" data-testid="text-class-info">
                {classData.courseType.charAt(0).toUpperCase() + classData.courseType.slice(1)} - Class {classData.classNumber} | {classData.date} at {classData.time}
              </p>
            )}
          </div>
        </div>

        {!hasEvaluation && (
          <Alert variant="destructive" className="mb-6 border-amber-200 bg-amber-50 rounded-md">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <AlertTitle className="text-gray-900 font-semibold">Evaluation Required</AlertTitle>
            <AlertDescription className="text-gray-700">
              <p className="mb-3">
                You must complete the evaluation for this class before you can sign students in. Please go to the Evaluations page to fill it out first.
              </p>
              <Button
                size="sm"
                onClick={() => setLocation("/instructor/evaluations")}
                className="bg-[#ECC462] hover:bg-[#d4af56] text-[#111111] rounded-md shadow-sm"
              >
                <ClipboardCheck className="h-4 w-4 mr-2" />
                Go to Evaluations
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <Card className="mb-6 border border-gray-200 rounded-md shadow-sm bg-white overflow-hidden">
          <CardHeader className="bg-gray-50 border-b">
            <CardTitle className="flex items-center gap-2 text-gray-900 text-xl font-semibold">
              <UserCheck className="h-5 w-5 text-[#ECC462]" />
              Enrolled Students ({enrollments.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {enrollments.length === 0 ? (
              <p className="text-gray-500 text-center py-8" data-testid="text-no-students">
                No students enrolled in this class
              </p>
            ) : (
              <div className="space-y-4">
                {enrollments.map((enrollment) => {
                  const statusInfo = getAttendanceStatus(enrollment);
                  const student = enrollment.student;
                  const isNoShow = statusInfo.status === "no-show";
                  
                  return (
                    <div
                      key={enrollment.id}
                      className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 border rounded-md shadow-sm gap-4 transition-colors ${
                        isNoShow ? 'bg-red-50 border-red-100' : 'bg-white border-gray-100'
                      }`}
                      data-testid={`card-student-${enrollment.id}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`h-12 w-12 rounded-full flex items-center justify-center ${
                          isNoShow ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-[#ECC462]'
                        }`}>
                          {isNoShow ? (
                            <UserX className="h-6 w-6" />
                          ) : (
                            <User className="h-6 w-6" />
                          )}
                        </div>
                        <div>
                          <p className={`font-semibold ${isNoShow ? 'text-red-900' : 'text-gray-900'}`} data-testid={`text-student-name-${enrollment.id}`}>
                            {student ? `${student.firstName} ${student.lastName}` : "Unknown Student"}
                          </p>
                          <p className="text-sm text-gray-500">
                            {student?.email || "No email"}
                          </p>
                          <Badge className={`${statusInfo.color} rounded-md border-none`} data-testid={`badge-status-${enrollment.id}`}>
                            {statusInfo.label}
                          </Badge>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-2">
                        {statusInfo.status === "registered" && (
                          <>
                            <Button
                              onClick={() => setSignatureDialog({
                                enrollmentId: enrollment.id,
                                studentName: student ? `${student.firstName} ${student.lastName}` : "Student",
                                type: "check-in"
                              })}
                              className="bg-[#ECC462] hover:bg-[#d4af56] text-[#111111] rounded-md shadow-sm"
                              disabled={!hasEvaluation}
                              title={!hasEvaluation ? "Complete the evaluation first" : undefined}
                              data-testid={`button-checkin-${enrollment.id}`}
                            >
                              <LogIn className="h-4 w-4 mr-2" />
                              Sign In
                            </Button>
                            <Button
                              onClick={() => setNoShowConfirm({
                                enrollmentId: enrollment.id,
                                studentName: student ? `${student.firstName} ${student.lastName}` : "Student",
                              })}
                              variant="outline"
                              className="border-gray-200 text-red-600 hover:bg-red-50 hover:border-red-100 rounded-md"
                              disabled={!hasEvaluation}
                              title={!hasEvaluation ? "Complete the evaluation first" : undefined}
                              data-testid={`button-noshow-${enrollment.id}`}
                            >
                              <UserX className="h-4 w-4 mr-2" />
                              No-Show
                            </Button>
                          </>
                        )}
                        
                        {statusInfo.status === "checked_in" && (
                          <>
                            <div className="flex items-center text-sm text-green-600 mr-2 font-medium">
                              <CheckCircle className="h-4 w-4 mr-1" />
                              In: {format(new Date(enrollment.checkInAt!), "h:mm a")}
                            </div>
                            <Button
                              onClick={() => setSignatureDialog({
                                enrollmentId: enrollment.id,
                                studentName: student ? `${student.firstName} ${student.lastName}` : "Student",
                                type: "check-out"
                              })}
                              variant="outline"
                              className="border-gray-200 text-gray-700 hover:bg-gray-50 rounded-md"
                              data-testid={`button-checkout-${enrollment.id}`}
                            >
                              <LogOut className="h-4 w-4 mr-2" />
                              Check Out
                            </Button>
                            {isSameDay && (
                              <Button
                                onClick={() => setUndoConfirm({
                                  enrollmentId: enrollment.id,
                                  studentName: student ? `${student.firstName} ${student.lastName}` : "Student",
                                  currentStatus: "checked in",
                                })}
                                variant="ghost"
                                size="sm"
                                className="text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md"
                                data-testid={`button-undo-${enrollment.id}`}
                              >
                                <Undo2 className="h-4 w-4 mr-1" />
                                Undo
                              </Button>
                            )}
                          </>
                        )}

                        {statusInfo.status === "completed" && (
                          <div className="flex items-center gap-4 text-sm font-medium">
                            <span className="text-green-600 flex items-center">
                              <CheckCircle className="h-4 w-4 mr-1" />
                              In: {format(new Date(enrollment.checkInAt!), "h:mm a")}
                            </span>
                            <span className="text-blue-600 flex items-center">
                              <Clock className="h-4 w-4 mr-1" />
                              Out: {format(new Date(enrollment.checkOutAt!), "h:mm a")}
                            </span>
                            {isSameDay && (
                              <Button
                                onClick={() => setUndoConfirm({
                                  enrollmentId: enrollment.id,
                                  studentName: student ? `${student.firstName} ${student.lastName}` : "Student",
                                  currentStatus: "checked in and out",
                                })}
                                variant="ghost"
                                size="sm"
                                className="text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md"
                                data-testid={`button-undo-${enrollment.id}`}
                              >
                                <Undo2 className="h-4 w-4 mr-1" />
                                Undo
                              </Button>
                            )}
                          </div>
                        )}

                        {isNoShow && (
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <span className="text-red-600 flex items-center">
                              <UserX className="h-4 w-4 mr-1" />
                              Marked as No-Show
                            </span>
                            {isSameDay && (
                              <Button
                                onClick={() => setUndoConfirm({
                                  enrollmentId: enrollment.id,
                                  studentName: student ? `${student.firstName} ${student.lastName}` : "Student",
                                  currentStatus: "no-show",
                                })}
                                variant="ghost"
                                size="sm"
                                className="text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md"
                                data-testid={`button-undo-${enrollment.id}`}
                              >
                                <Undo2 className="h-4 w-4 mr-1" />
                                Undo
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={!!signatureDialog} onOpenChange={() => setSignatureDialog(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-xl">
                {signatureDialog?.type === "check-in" ? "Student Check-In" : "Student Check-Out"}
              </DialogTitle>
              <DialogDescription>
                {signatureDialog?.studentName}, please sign below to confirm your {signatureDialog?.type === "check-in" ? "arrival" : "departure"}.
              </DialogDescription>
            </DialogHeader>
            
            <div className="py-4">
              <SignaturePad
                ref={signaturePadRef}
                title={`${signatureDialog?.studentName}'s Signature`}
                height={180}
              />
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={() => setSignatureDialog(null)}
                data-testid="button-cancel-signature"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmitSignature}
                disabled={checkInMutation.isPending || checkOutMutation.isPending}
                className="bg-[#ECC462] hover:bg-[#d9b456] text-black"
                data-testid="button-submit-signature"
              >
                {checkInMutation.isPending || checkOutMutation.isPending ? "Submitting..." : "Confirm"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!noShowConfirm} onOpenChange={() => setNoShowConfirm(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-xl flex items-center gap-2">
                <UserX className="h-5 w-5 text-red-500" />
                Mark as No-Show
              </DialogTitle>
              <DialogDescription>
                Are you sure you want to mark <strong>{noShowConfirm?.studentName}</strong> as a no-show for this lesson? This will record that the student did not attend.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={() => setNoShowConfirm(null)}
              >
                Cancel
              </Button>
              <Button
                onClick={() => noShowConfirm && noShowMutation.mutate(noShowConfirm.enrollmentId)}
                disabled={noShowMutation.isPending}
                variant="destructive"
              >
                {noShowMutation.isPending ? "Marking..." : "Confirm No-Show"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={!!undoConfirm} onOpenChange={() => setUndoConfirm(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-xl flex items-center gap-2">
                <Undo2 className="h-5 w-5 text-amber-500" />
                Undo Attendance
              </DialogTitle>
              <DialogDescription>
                Are you sure you want to reset the attendance for <strong>{undoConfirm?.studentName}</strong>? They are currently marked as <strong>{undoConfirm?.currentStatus}</strong>. This will clear their sign-in, sign-out, and status so you can start over.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={() => setUndoConfirm(null)}
              >
                Cancel
              </Button>
              <Button
                onClick={() => undoConfirm && resetAttendanceMutation.mutate(undoConfirm.enrollmentId)}
                disabled={resetAttendanceMutation.isPending}
                className="bg-amber-500 hover:bg-amber-600 text-white"
              >
                {resetAttendanceMutation.isPending ? "Resetting..." : "Confirm Undo"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
