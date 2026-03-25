import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { 
  User, 
  Phone, 
  Mail, 
  Calendar, 
  MapPin, 
  Contact, 
  FileText, 
  ClipboardCheck, 
  GraduationCap,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Edit,
  Plus
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import StudentForm from "./student-form";
import type { Student, Contract, Evaluation, ClassEnrollment } from "@shared/schema";

interface StudentProfileProps {
  student: Student;
  onClose: () => void;
}

export default function StudentProfile({ student, onClose }: StudentProfileProps) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  // Fetch related data
  const { data: contracts = [] } = useQuery<Contract[]>({
    queryKey: ["/api/contracts", "student", student.id],
    queryFn: () => fetch(`/api/contracts?studentId=${student.id}`).then(res => res.json()),
  });

  const { data: evaluations = [] } = useQuery<Evaluation[]>({
    queryKey: ["/api/evaluations", "student", student.id],
    queryFn: () => fetch(`/api/evaluations?studentId=${student.id}`).then(res => res.json()),
  });

  const { data: enrollments = [] } = useQuery<ClassEnrollment[]>({
    queryKey: ["/api/class-enrollments", "student", student.id],
    queryFn: () => fetch(`/api/class-enrollments?studentId=${student.id}`).then(res => res.json()),
  });

  const getCourseColor = (courseType: string) => {
    switch (courseType) {
      case "auto": return "bg-blue-100 text-blue-800";
      case "moto": return "bg-green-100 text-green-800";
      case "scooter": return "bg-purple-100 text-purple-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-green-100 text-green-800";
      case "completed": return "bg-blue-100 text-blue-800";
      case "suspended": return "bg-red-100 text-red-800";
      case "pending": return "bg-yellow-100 text-yellow-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const getEvaluationIcon = (rating: number) => {
    if (rating >= 4) return <CheckCircle className="h-4 w-4 text-green-600" />;
    if (rating >= 3) return <AlertCircle className="h-4 w-4 text-yellow-600" />;
    return <XCircle className="h-4 w-4 text-red-600" />;
  };

  const progressPercentage = student.status === "completed" ? 100 : 
    student.status === "active" ? Math.min(85, (evaluations.length * 15) + 25) : 0;

  return (
    <div className="space-y-6">
      {/* Header with student basic info */}
      <Card className="mobile-card">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
            <div className="flex items-start space-x-4">
              <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center">
                <User className="h-8 w-8 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">
                  {student.firstName} {student.lastName}
                </h2>
                <p className="text-gray-600">Course ID: {student.id}</p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <Badge className={getCourseColor(student.courseType)}>
                    {student.courseType.toUpperCase()}
                  </Badge>
                  <Badge className={getStatusColor(student.status)}>
                    {student.status.charAt(0).toUpperCase() + student.status.slice(1)}
                  </Badge>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="touch-target">
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto dialog-content">
                  <DialogHeader>
                    <DialogTitle>Edit Student Profile</DialogTitle>
                  </DialogHeader>
                  <StudentForm 
                    student={student} 
                    onSuccess={() => {
                      setIsEditDialogOpen(false);
                      // Refresh data would happen automatically via React Query
                    }} 
                  />
                </DialogContent>
              </Dialog>
              <Button variant="outline" size="sm" onClick={onClose} className="touch-target">
                Close
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Personal Information and Progress */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Personal Info */}
        <Card className="lg:col-span-2 mobile-card">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Contact className="mr-2 h-5 w-5" />
              Personal Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-center space-x-3">
                <Mail className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-600">Email</p>
                  <p className="font-medium">{student.email}</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <Phone className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-600">Phone</p>
                  <p className="font-medium">{student.phone}</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <Calendar className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-600">Date of Birth</p>
                  <p className="font-medium">{formatDate(student.dateOfBirth)}</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <MapPin className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-600">Address</p>
                  <p className="font-medium">{student.address}</p>
                </div>
              </div>
            </div>
            
            <Separator />
            
            <div>
              <h4 className="font-medium mb-2">Emergency Contact</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Name</p>
                  <p className="font-medium">{student.emergencyContact}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Phone</p>
                  <p className="font-medium">{student.emergencyPhone}</p>
                </div>
              </div>
            </div>

            {student.notes && (
              <>
                <Separator />
                <div>
                  <h4 className="font-medium mb-2">Notes</h4>
                  <p className="text-sm text-gray-600">{student.notes}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Progress Summary */}
        <Card className="mobile-card">
          <CardHeader>
            <CardTitle className="flex items-center">
              <GraduationCap className="mr-2 h-5 w-5" />
              Progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span>Course Progress</span>
                  <span>{progressPercentage}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-primary h-2 rounded-full transition-all duration-500"
                    style={{ width: `${progressPercentage}%` }}
                  ></div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-center">
                <div className="p-3 bg-blue-50 rounded-lg">
                  <p className="text-2xl font-bold text-blue-600">{evaluations.length}</p>
                  <p className="text-xs text-blue-600">Evaluations</p>
                </div>
                <div className="p-3 bg-green-50 rounded-lg">
                  <p className="text-2xl font-bold text-green-600">{enrollments.length}</p>
                  <p className="text-xs text-green-600">Classes</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Enrollment Date</span>
                  <span>{formatDate(student.enrollmentDate)}</span>
                </div>
                {student.status === "completed" && (
                  <div className="flex justify-between text-sm">
                    <span>Completion Date</span>
                    <span>{formatDate(student.expectedGraduation)}</span>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Tabs */}
      <Tabs defaultValue="evaluations" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="evaluations" className="touch-target">Evaluations</TabsTrigger>
          <TabsTrigger value="contracts" className="touch-target">Contracts</TabsTrigger>
          <TabsTrigger value="classes" className="touch-target">Classes</TabsTrigger>
        </TabsList>

        <TabsContent value="evaluations">
          <Card className="mobile-card">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center">
                  <ClipboardCheck className="mr-2 h-5 w-5" />
                  Evaluation History
                </div>
                <Button size="sm" className="touch-target">
                  <Plus className="h-4 w-4 mr-2" />
                  New Evaluation
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto table-container">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Rating</TableHead>
                      <TableHead>Instructor</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {evaluations.map((evaluation) => (
                      <TableRow key={evaluation.id}>
                        <TableCell>{formatDate(evaluation.evaluationDate)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{evaluation.sessionType}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            {getEvaluationIcon(evaluation.overallRating)}
                            <span>{evaluation.overallRating}/5</span>
                          </div>
                        </TableCell>
                        <TableCell>Instructor #{evaluation.instructorId}</TableCell>
                        <TableCell>
                          {evaluation.signedOff ? (
                            <Badge className="bg-green-100 text-green-800">Signed Off</Badge>
                          ) : (
                            <Badge variant="secondary">Pending</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {evaluations.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                          No evaluations recorded yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contracts">
          <Card className="mobile-card">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center">
                  <FileText className="mr-2 h-5 w-5" />
                  Contracts & Payments
                </div>
                <Button size="sm" className="touch-target">
                  <Plus className="h-4 w-4 mr-2" />
                  New Contract
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {contracts.map((contract) => (
                  <div key={contract.id} className="border rounded-lg p-4">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
                      <div>
                        <h4 className="font-medium">Contract #{contract.id}</h4>
                        <p className="text-sm text-gray-600">
                          Started: {formatDate(contract.startDate)}
                        </p>
                        <p className="text-sm text-gray-600">
                          Type: {contract.courseType.toUpperCase()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold">${contract.totalAmount}</p>
                        <p className="text-sm text-gray-600">
                          Paid: ${contract.amountPaid}
                        </p>
                        <Badge className={
                          contract.status === "active" ? "bg-green-100 text-green-800" :
                          contract.status === "completed" ? "bg-blue-100 text-blue-800" :
                          "bg-gray-100 text-gray-800"
                        }>
                          {contract.status}
                        </Badge>
                      </div>
                    </div>
                    {contract.notes && (
                      <div className="mt-3 pt-3 border-t">
                        <p className="text-sm text-gray-600">{contract.notes}</p>
                      </div>
                    )}
                  </div>
                ))}
                {contracts.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    No contracts found.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="classes">
          <Card className="mobile-card">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Clock className="mr-2 h-5 w-5" />
                Class Schedule
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto table-container">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Class</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {enrollments.map((enrollment) => (
                      <TableRow key={enrollment.id}>
                        <TableCell>Class #{enrollment.classId}</TableCell>
                        <TableCell>{formatDate(enrollment.enrollmentDate)}</TableCell>
                        <TableCell>—</TableCell>
                        <TableCell>
                          <Badge className="bg-blue-100 text-blue-800">
                            Enrolled
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {enrollments.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-gray-500">
                          No class enrollments found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}