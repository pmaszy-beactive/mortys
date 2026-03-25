import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertCircle, CheckCircle, XCircle, Calendar, Clock, User, Car, BookOpen, ExternalLink, GraduationCap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate, formatTime } from "@/lib/utils";
import type { Class, Instructor, Student, ClassEnrollment } from "@shared/schema";
import ClassForm from "@/components/class-form";
import { Link } from "wouter";

export default function ChangeRequests() {
  const { toast } = useToast();
  const [selectedClass, setSelectedClass] = useState<Class | null>(null);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showDenyDialog, setShowDenyDialog] = useState(false);

  const { data: changeRequests = [], isLoading } = useQuery<Class[]>({
    queryKey: ["/api/change-requests"],
  });

  const { data: instructors = [] } = useQuery<Instructor[]>({
    queryKey: ["/api/instructors"],
  });

  const { data: students = [] } = useQuery<Student[]>({
    queryKey: ["/api/students"],
  });

  const { data: enrollments = [] } = useQuery<ClassEnrollment[]>({
    queryKey: ["/api/class-enrollments"],
  });

  const approveMutation = useMutation({
    mutationFn: async (data: { classId: number; updateData: any }) => {
      return await apiRequest("POST", `/api/change-requests/${data.classId}/approve`, data.updateData);
    },
    onSuccess: () => {
      toast({
        title: "Change Request Approved",
        description: "The class schedule has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/change-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/classes"] });
      setShowApproveDialog(false);
      setSelectedClass(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to approve change request",
        variant: "destructive",
      });
    },
  });

  const denyMutation = useMutation({
    mutationFn: async (classId: number) => {
      return await apiRequest("POST", `/api/change-requests/${classId}/deny`);
    },
    onSuccess: () => {
      toast({
        title: "Change Request Denied",
        description: "The change request has been denied. The class remains unchanged.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/change-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/classes"] });
      setShowDenyDialog(false);
      setSelectedClass(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to deny change request",
        variant: "destructive",
      });
    },
  });

  const getInstructorName = (instructorId: number | null) => {
    if (!instructorId) return "Unassigned";
    const instructor = instructors.find((i) => i.id === instructorId);
    return instructor ? `${instructor.firstName} ${instructor.lastName}` : "Unknown";
  };

  const getStudentsForClass = (classId: number) => {
    const classEnrollments = enrollments.filter((e) => e.classId === classId);
    return classEnrollments.map((enrollment) => {
      const student = students.find((s) => s.id === enrollment.studentId);
      return student;
    }).filter(Boolean) as Student[];
  };

  const formatRequestedAt = (date: string | Date | null) => {
    if (!date) return "Unknown";
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    return formatDate(date.toString());
  };

  const handleApprove = (classItem: Class) => {
    setSelectedClass(classItem);
    setShowApproveDialog(true);
  };

  const handleDeny = (classItem: Class) => {
    setSelectedClass(classItem);
    setShowDenyDialog(true);
  };

  const handleApproveSubmit = () => {
    if (selectedClass) {
      approveMutation.mutate({
        classId: selectedClass.id,
        updateData: {},
      });
    }
  };

  const handleDenyConfirm = () => {
    if (selectedClass) {
      denyMutation.mutate(selectedClass.id);
    }
  };

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-[#111111]">Class Change Requests</h1>
        <p className="text-gray-600 mt-2">
          Review and approve or deny schedule change requests from instructors
        </p>
      </div>

      <Card className="border-0 shadow-xl">
        <CardHeader className="border-b bg-gradient-to-r from-amber-50 to-yellow-50">
          <CardTitle className="flex items-center text-[#111111]">
            <AlertCircle className="mr-2 h-5 w-5 text-[#ECC462]" />
            Pending Change Requests
          </CardTitle>
          <CardDescription>
            {changeRequests.length} {changeRequests.length === 1 ? 'request' : 'requests'} awaiting review
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {changeRequests.length === 0 ? (
            <div className="text-center py-12">
              <div className="bg-gray-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="h-10 w-10 text-green-600" />
              </div>
              <p className="text-gray-500 font-medium">No pending change requests</p>
              <p className="text-gray-400 text-sm mt-2">All class schedules are confirmed</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class Details</TableHead>
                  <TableHead>Student(s)</TableHead>
                  <TableHead>Current Schedule</TableHead>
                  <TableHead>Instructor</TableHead>
                  <TableHead>Reason & Context</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changeRequests.map((classItem) => (
                  <TableRow key={classItem.id}>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        {classItem.courseType === 'auto' ? (
                          <Car className="h-4 w-4 text-[#ECC462]" />
                        ) : (
                          <BookOpen className="h-4 w-4 text-amber-600" />
                        )}
                        <div>
                          <Link href={`/scheduling?classId=${classItem.id}`}>
                            <span className="font-semibold text-gray-900 hover:text-[#ECC462] cursor-pointer flex items-center gap-1">
                              {classItem.courseType.toUpperCase()} - Class {classItem.classNumber}
                              <ExternalLink className="h-3 w-3" />
                            </span>
                          </Link>
                          <Badge variant={classItem.hasTest ? "destructive" : "secondary"} className="text-xs mt-1">
                            {classItem.hasTest ? "Test" : "Lecture"}
                          </Badge>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const classStudents = getStudentsForClass(classItem.id);
                        if (classStudents.length === 0) {
                          return <span className="text-gray-400 text-sm">No students enrolled</span>;
                        }
                        return (
                          <div className="space-y-1">
                            {classStudents.slice(0, 3).map((student) => (
                              <Link key={student.id} href={`/students/${student.id}`}>
                                <div className="flex items-center text-sm hover:text-[#ECC462] cursor-pointer">
                                  <GraduationCap className="h-3 w-3 mr-1 text-gray-400" />
                                  <span>{student.firstName} {student.lastName}</span>
                                  <ExternalLink className="h-3 w-3 ml-1 text-gray-400" />
                                </div>
                              </Link>
                            ))}
                            {classStudents.length > 3 && (
                              <span className="text-xs text-gray-500">+{classStudents.length - 3} more</span>
                            )}
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-4 text-sm">
                        <div className="flex items-center text-gray-600">
                          <Calendar className="h-4 w-4 mr-1" />
                          {formatDate(classItem.date)}
                        </div>
                        <div className="flex items-center text-gray-600">
                          <Clock className="h-4 w-4 mr-1" />
                          {formatTime(classItem.time)}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center text-sm">
                        <User className="h-4 w-4 mr-1 text-gray-400" />
                        <span className="text-gray-900">{getInstructorName(classItem.instructorId)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-xs space-y-1">
                        <p className="text-sm text-gray-900 font-medium">
                          {classItem.changeRequestReason || "No reason provided"}
                        </p>
                        {classItem.changeRequestTime && (
                          <p className="text-xs text-gray-500">
                            <span className="font-medium">Suggested time:</span> {classItem.changeRequestTime}
                          </p>
                        )}
                        <p className="text-xs text-gray-400">
                          Requested {formatRequestedAt(classItem.changeRequestedAt)}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end space-x-2">
                        <Button
                          size="sm"
                          onClick={() => handleApprove(classItem)}
                          className="bg-green-600 text-white hover:bg-green-700"
                          data-testid={`button-approve-${classItem.id}`}
                        >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDeny(classItem)}
                          className="border-red-300 text-red-700 hover:bg-red-50"
                          data-testid={`button-deny-${classItem.id}`}
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Deny
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Approve Dialog with Class Form */}
      <Dialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Approve Change Request</DialogTitle>
            <DialogDescription>
              Update the class schedule details below and approve the change request
            </DialogDescription>
          </DialogHeader>
          {selectedClass && (
            <ClassForm
              classData={selectedClass}
              onSuccess={handleApproveSubmit}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Deny Confirmation Dialog */}
      <Dialog open={showDenyDialog} onOpenChange={setShowDenyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deny Change Request</DialogTitle>
            <DialogDescription>
              Are you sure you want to deny this change request? The class will remain on its current schedule.
            </DialogDescription>
          </DialogHeader>
          {selectedClass && (
            <div className="py-4 space-y-2">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm font-semibold text-[#111111]">Class Details</p>
                <p className="text-sm text-gray-700 mt-1">
                  {selectedClass.courseType.toUpperCase()} - Class {selectedClass.classNumber}
                </p>
                <p className="text-sm text-gray-700">
                  {formatDate(selectedClass.date)} at {formatTime(selectedClass.time)}
                </p>
                <p className="text-sm text-gray-700 mt-2">
                  <span className="font-medium">Reason:</span> {selectedClass.changeRequestReason}
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDenyDialog(false)}
              data-testid="button-cancel-deny"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDenyConfirm}
              disabled={denyMutation.isPending}
              className="bg-red-600 text-white hover:bg-red-700"
              data-testid="button-confirm-deny"
            >
              {denyMutation.isPending ? "Denying..." : "Deny Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
