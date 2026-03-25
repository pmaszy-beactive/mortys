import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
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
  Plus,
  ArrowLeft,
  Users,
  Car,
  Bike,
  BookOpen,
  Trash2,
  Lock,
  MessageSquare,
  Send,
  Eye
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import StudentForm from "@/components/student-form";
import EvaluationForm from "@/components/evaluation-form";
import ContractForm from "@/components/contract-form";
import FavoriteInstructorSection from "@/components/favorite-instructor-section";
import { StatementOfAccount } from "@/components/statement-of-account";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { Student, Contract, Evaluation, ClassEnrollment, Location, StudentCourse, StudentParent, Parent, Class, Instructor, StudentNote } from "@shared/schema";
import type { PhaseProgressData } from "@shared/phaseConfig";
import PhaseProgressTracker, { PhaseProgressTrackerSkeleton } from "@/components/phase-progress-tracker";

interface StudentProfilePageProps {
  params: { id: string };
}

export default function StudentProfilePage({ params }: StudentProfilePageProps) {
  const [, setLocation] = useLocation();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isNewEvaluationDialogOpen, setIsNewEvaluationDialogOpen] = useState(false);
  const [isNewContractDialogOpen, setIsNewContractDialogOpen] = useState(false);
  const [viewingEvaluation, setViewingEvaluation] = useState<Evaluation | null>(null);
  const [editingEvaluation, setEditingEvaluation] = useState<Evaluation | null>(null);
  const [showInternalNoteForm, setShowInternalNoteForm] = useState(false);
  const [showVisibleNoteForm, setShowVisibleNoteForm] = useState(false);
  const [internalNoteContent, setInternalNoteContent] = useState("");
  const [visibleNoteContent, setVisibleNoteContent] = useState("");
  const { toast } = useToast();
  const studentId = parseInt(params.id);

  const impersonateMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/impersonate/student/${studentId}`),
    onSuccess: () => {
      setLocation("/student/dashboard");
    },
    onError: () => {
      toast({ title: "Error", description: "Could not open student portal view.", variant: "destructive" });
    },
  });

  // Fetch student data
  const { data: student, isLoading: studentLoading } = useQuery<Student>({
    queryKey: ["/api/students", studentId],
    queryFn: () => apiRequest("GET", `/api/students/${studentId}`),
  });

  const { data: phaseProgressData, isLoading: phaseLoading } = useQuery<PhaseProgressData>({
    queryKey: ['/api/students', studentId, 'phase-progress'],
    queryFn: () => apiRequest("GET", `/api/students/${studentId}/phase-progress`),
    enabled: !!student,
  });

  // Fetch related data
  const { data: contracts = [] } = useQuery<Contract[]>({
    queryKey: ["/api/contracts", "student", studentId],
    queryFn: () => apiRequest("GET", `/api/contracts?studentId=${studentId}`),
    enabled: !!student,
  });

  const { data: evaluations = [] } = useQuery<Evaluation[]>({
    queryKey: ["/api/evaluations", "student", studentId],
    queryFn: () => apiRequest("GET", `/api/evaluations?studentId=${studentId}`),
    enabled: !!student,
  });

  const { data: enrollments = [] } = useQuery<ClassEnrollment[]>({
    queryKey: ["/api/class-enrollments", "student", studentId],
    queryFn: () => apiRequest("GET", `/api/class-enrollments?studentId=${studentId}`),
    enabled: !!student,
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: lessonNotes = [] } = useQuery<any[]>({
    queryKey: ["/api/students", studentId, "lesson-notes"],
    queryFn: () => apiRequest("GET", `/api/students/${studentId}/lesson-notes`),
    enabled: !!student,
  });

  const { data: studentCourses = [] } = useQuery<StudentCourse[]>({
    queryKey: ["/api/students", studentId, "courses"],
    queryFn: () => apiRequest("GET", `/api/students/${studentId}/courses`),
    enabled: !!student,
  });

  // Fetch classes and instructors for evaluation linking
  const { data: classes = [] } = useQuery<Class[]>({
    queryKey: ["/api/classes"],
  });

  const { data: instructors = [] } = useQuery<Instructor[]>({
    queryKey: ["/api/instructors"],
  });

  const { data: studentNotes = [] } = useQuery<StudentNote[]>({
    queryKey: ['/api/students', studentId, 'notes'],
    queryFn: () => apiRequest("GET", `/api/students/${studentId}/notes`),
    enabled: !!student,
  });

  const createNoteMutation = useMutation({
    mutationFn: (data: { noteType: string; content: string }) =>
      apiRequest("POST", `/api/students/${studentId}/notes`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/students', studentId, 'notes'] });
      setInternalNoteContent("");
      setVisibleNoteContent("");
      setShowInternalNoteForm(false);
      setShowVisibleNoteForm(false);
      toast({ title: "Note added successfully" });
    },
    onError: () => {
      toast({ title: "Failed to add note", variant: "destructive" });
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (noteId: number) =>
      apiRequest("DELETE", `/api/students/${studentId}/notes/${noteId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/students', studentId, 'notes'] });
      toast({ title: "Note deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete note", variant: "destructive" });
    },
  });

  // Helper functions for evaluations
  const getClassName = (classId: number | null) => {
    if (!classId) return "No class linked";
    const cls = classes.find(c => c.id === classId);
    if (!cls) return `Class #${classId}`;
    return `${cls.courseType.charAt(0).toUpperCase() + cls.courseType.slice(1)} - ${cls.date} @ ${cls.time}`;
  };

  const getInstructorName = (instructorId: number | null) => {
    if (!instructorId) return "Unknown Instructor";
    const instructor = instructors.find(i => i.id === instructorId);
    return instructor ? `${instructor.firstName} ${instructor.lastName}` : `Instructor #${instructorId}`;
  };

  interface ParentWithDetails extends StudentParent {
    parent?: Parent;
  }

  const { data: studentParents = [] } = useQuery<ParentWithDetails[]>({
    queryKey: ["/api/student-parents", studentId],
    queryFn: async () => {
      const relationships = await apiRequest("GET", `/api/student/${studentId}/parents`) as StudentParent[];
      const parentsWithDetails = await Promise.all(
        relationships.map(async (rel) => {
          try {
            const parent = await apiRequest("GET", `/api/parents/${rel.parentId}`) as Parent;
            return { ...rel, parent };
          } catch {
            return rel;
          }
        })
      );
      return parentsWithDetails;
    },
    enabled: !!student,
  });

  if (studentLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Loading student profile...</p>
        </div>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <p className="text-red-600 mb-4">Student not found</p>
          <Button onClick={() => setLocation("/students")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Students
          </Button>
        </div>
      </div>
    );
  }

  const getCourseColor = (courseType: string) => {
    switch (courseType) {
      case "auto": return "bg-[#ECC462]/10 text-[#111111] border border-[#ECC462]/30";
      case "moto": return "bg-amber-100 text-amber-800 border border-amber-200";
      case "scooter": return "bg-gray-100 text-gray-800 border border-gray-200";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-green-100 text-green-800 border border-green-200";
      case "completed": return "bg-[#ECC462]/10 text-[#111111] border border-[#ECC462]/30";
      case "suspended": return "bg-red-100 text-red-800 border border-red-200";
      case "pending": return "bg-yellow-100 text-yellow-800 border border-yellow-200";
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
    <div className="space-y-6 bg-gray-50 min-h-screen p-4 sm:p-6">
      {/* Back Navigation */}
      <div className="flex items-center gap-4">
        <Button 
          variant="ghost" 
          onClick={() => setLocation("/students")}
          className="touch-target hover:bg-white"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Students
        </Button>
        <div className="h-6 w-px bg-gray-300" />
        <h1 className="text-xl font-semibold text-gray-900">Student Profile</h1>
      </div>

      {/* Header with student basic info */}
      <Card className="bg-white border border-gray-200 rounded-md shadow-sm border-l-4 border-l-[#ECC462]">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
            <div className="flex items-start space-x-4">
              <div className="w-16 h-16 bg-gray-100 rounded-md flex items-center justify-center border border-gray-200">
                <User className="h-8 w-8 text-gray-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">
                  {student.firstName} {student.lastName}
                </h2>
                <p className="text-sm text-gray-500">Course ID: {student.id}</p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <Badge variant="secondary" className={getCourseColor(student.courseType)}>
                    {student.courseType.toUpperCase()}
                  </Badge>
                  <Badge variant="secondary" className={getStatusColor(student.status)}>
                    {student.status.charAt(0).toUpperCase() + student.status.slice(1)}
                  </Badge>
                  {student.locationId && (
                    <Badge variant="outline" className="bg-white text-gray-700 border-gray-200">
                      <MapPin className="h-3 w-3 mr-1" />
                      {locations.find(loc => loc.id === student.locationId)?.name || "Unknown Location"}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="touch-target border-gray-200 text-gray-700 hover:bg-gray-50"
                onClick={() => impersonateMutation.mutate()}
                disabled={impersonateMutation.isPending || student?.accountStatus !== 'active'}
                title={student?.accountStatus !== 'active' ? "Student account must be active to view portal" : "View student portal as this student"}
              >
                <Eye className="h-4 w-4 mr-2" />
                {impersonateMutation.isPending ? "Opening..." : "View Student Portal"}
              </Button>
              <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="touch-target border-gray-200 text-gray-700 hover:bg-gray-50">
                    <Edit className="h-4 w-4 mr-2" />
                    Edit Profile
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
                    }} 
                  />
                </DialogContent>
              </Dialog>
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
          <CardContent className="space-y-6">
            {/* Basic Contact Information */}
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-900">Contact Information</h4>
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
                    <p className="text-sm text-gray-600">Language Preference</p>
                    <p className="font-medium">{student.languagePreference || 'English'}</p>
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* Location Assignment */}
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-900">School Location</h4>
              <div className="flex items-center space-x-3">
                <MapPin className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-600">Assigned Location</p>
                  <p className="font-medium">
                    {student.locationId ? 
                      locations.find(loc => loc.id === student.locationId)?.name || "Unknown Location" : 
                      "Not Assigned"
                    }
                  </p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Address Information */}
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-900">Address Information</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <p className="text-sm text-gray-600">Street Address</p>
                  <p className="font-medium">{student.address}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">City</p>
                  <p className="font-medium">{student.city || 'Not specified'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Postal Code</p>
                  <p className="font-medium">{student.postalCode || 'Not specified'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Province</p>
                  <p className="font-medium">{student.province || 'QC'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Country</p>
                  <p className="font-medium">{student.country || 'Canada'}</p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Emergency Contact */}
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-900">Emergency Contact</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-center space-x-3">
                  <Contact className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-600">Emergency Contact</p>
                    <p className="font-medium">{student.emergencyContact}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <Phone className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-600">Emergency Phone</p>
                    <p className="font-medium">{student.emergencyPhone}</p>
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* Legacy Migration Data */}
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-900">Legacy System Data</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Legacy ID</p>
                  <p className="font-medium">{student.legacyId || 'Not migrated'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Enrollment Date</p>
                  <p className="font-medium">{student.enrollmentDate ? formatDate(student.enrollmentDate) : 'Not specified'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Transferred From</p>
                  <p className="font-medium">{student.transferredFrom || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Transferred Credits</p>
                  <p className="font-medium">{student.transferredCredits || 0} hours</p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Government & Compliance */}
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-900">Government & Compliance</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Government ID</p>
                  <p className="font-medium">{student.governmentId || 'Not provided'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Driver License Number</p>
                  <p className="font-medium">{student.driverLicenseNumber || 'Not provided'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">License Expiry</p>
                  <p className="font-medium">{student.licenseExpiryDate ? formatDate(student.licenseExpiryDate) : 'Not specified'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Attestation Number</p>
                  <p className="font-medium">{student.attestationNumber || 'Not assigned'}</p>
                </div>
                <div className="flex items-center space-x-2">
                  <p className="text-sm text-gray-600">Medical Certificate:</p>
                  <Badge variant={student.medicalCertificate ? "default" : "secondary"}>
                    {student.medicalCertificate ? "Valid" : "Pending"}
                  </Badge>
                </div>
                <div className="flex items-center space-x-2">
                  <p className="text-sm text-gray-600">Vision Test:</p>
                  <Badge variant={student.visionTest ? "default" : "secondary"}>
                    {student.visionTest ? "Completed" : "Pending"}
                  </Badge>
                </div>
              </div>
            </div>

            <Separator />

            {/* Academic Progress */}
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-900">Academic Progress</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Total Hours Completed</p>
                  <p className="font-medium">{student.totalHoursCompleted || 0} hours</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Total Hours Required</p>
                  <p className="font-medium">{student.totalHoursRequired || 36} hours</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Theory Hours</p>
                  <p className="font-medium">{student.theoryHoursCompleted || 0} hours</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Driving Hours</p>
                  <p className="font-medium">{student.practicalHoursCompleted || 0} hours</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Final Exam Score</p>
                  <p className="font-medium">{student.finalExamScore ? `${student.finalExamScore}%` : 'Not taken'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Road Test Date</p>
                  <p className="font-medium">{student.roadTestDate ? formatDate(student.roadTestDate) : 'Not scheduled'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Road Test Result</p>
                  <Badge variant={student.roadTestResult === 'pass' ? "default" : student.roadTestResult === 'fail' ? "destructive" : "secondary"}>
                    {student.roadTestResult || 'Pending'}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Completion Date</p>
                  <p className="font-medium">{student.completionDate ? formatDate(student.completionDate) : 'In progress'}</p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Payment Information */}
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-900">Payment Information</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Total Amount Due</p>
                  <p className="font-medium">{student.totalAmountDue ? `$${student.totalAmountDue}` : 'Not specified'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Amount Paid</p>
                  <p className="font-medium">{student.amountPaid ? `$${student.amountPaid}` : '$0.00'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Payment Plan</p>
                  <p className="font-medium">{student.paymentPlan || 'Not specified'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Last Payment</p>
                  <p className="font-medium">{student.lastPaymentDate ? formatDate(student.lastPaymentDate) : 'No payments'}</p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Special Accommodations */}
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-900">Special Accommodations</h4>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Special Needs</p>
                  <p className="font-medium">{student.specialNeeds || 'None specified'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Accommodations</p>
                  <p className="font-medium">{student.accommodations || 'None required'}</p>
                </div>
                <div className="flex items-center space-x-2">
                  <p className="text-sm text-gray-600">Digital Signature Consent:</p>
                  <Badge variant={student.signatureConsent ? "default" : "secondary"}>
                    {student.signatureConsent ? "Provided" : "Pending"}
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Progress Summary */}
        <Card className="mobile-card">
          <CardHeader>
            <CardTitle className="flex items-center">
              <GraduationCap className="mr-2 h-5 w-5" />
              Progress & Preferences
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
                <div className="p-3 bg-gradient-to-br from-[#ECC462]/20 to-amber-100 rounded-lg border border-[#ECC462]/30">
                  <p className="text-2xl font-bold text-[#111111]">{evaluations.length}</p>
                  <p className="text-xs text-gray-700 font-medium">Evaluations</p>
                </div>
                <div className="p-3 bg-gradient-to-br from-amber-100 to-[#ECC462]/20 rounded-lg border border-amber-400/30">
                  <p className="text-2xl font-bold text-[#111111]">{enrollments.length}</p>
                  <p className="text-xs text-gray-700 font-medium">Classes</p>
                </div>
              </div>

              <Separator />

              <FavoriteInstructorSection 
                student={student} 
                onUpdate={() => {
                  // Refresh student data
                  queryClient.invalidateQueries({ queryKey: ["/api/students", studentId] });
                }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Phase Progress */}
      <div className="mb-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-[#ECC462]" />
          Phase Progress
        </h2>
        {phaseLoading ? (
          <PhaseProgressTrackerSkeleton />
        ) : phaseProgressData ? (
          <PhaseProgressTracker phaseData={phaseProgressData} />
        ) : null}
      </div>

      {/* Detailed Tabs */}
      <Tabs defaultValue="evaluations" className="space-y-4">
        <TabsList className="grid w-full grid-cols-8">
          <TabsTrigger value="evaluations" className="touch-target">Evaluations</TabsTrigger>
          <TabsTrigger value="contracts" className="touch-target">Contracts</TabsTrigger>
          <TabsTrigger value="statement" className="touch-target">Statement</TabsTrigger>
          <TabsTrigger value="classes" className="touch-target">Classes</TabsTrigger>
          <TabsTrigger value="lesson-notes" className="touch-target">Notes</TabsTrigger>
          <TabsTrigger value="student-notes" className="touch-target">Student Notes</TabsTrigger>
          <TabsTrigger value="courses" className="touch-target">Courses</TabsTrigger>
          <TabsTrigger value="parents" className="touch-target">Parents</TabsTrigger>
        </TabsList>

        <TabsContent value="evaluations">
          <Card className="mobile-card">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center">
                  <ClipboardCheck className="mr-2 h-5 w-5" />
                  Evaluation History
                </div>
                <Dialog open={isNewEvaluationDialogOpen} onOpenChange={setIsNewEvaluationDialogOpen}>
                  <DialogTrigger asChild>
                    <Button 
                      size="sm" 
                      className="touch-target"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      New Evaluation
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto dialog-content">
                    <DialogHeader>
                      <DialogTitle>New Evaluation for {student.firstName} {student.lastName}</DialogTitle>
                      <DialogDescription>
                        Create a new evaluation record for this student.
                      </DialogDescription>
                    </DialogHeader>
                    <EvaluationForm 
                      evaluation={{ studentId: student.id }}
                      onSuccess={() => {
                        setIsNewEvaluationDialogOpen(false);
                      }} 
                    />
                  </DialogContent>
                </Dialog>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto table-container">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Linked Class</TableHead>
                      <TableHead>Rating</TableHead>
                      <TableHead>Instructor</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {evaluations.map((evaluation) => (
                      <TableRow key={evaluation.id} className="hover:bg-amber-50/50">
                        <TableCell className="font-medium">{formatDate(evaluation.evaluationDate)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="bg-gradient-to-r from-blue-100 to-indigo-100 text-blue-800">
                            {evaluation.sessionType === 'in-car' ? 'Driving' : evaluation.sessionType}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-gray-600">
                            {getClassName(evaluation.classId)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            {getEvaluationIcon(evaluation.overallRating)}
                            <span className="font-medium">{evaluation.overallRating || '-'}/5</span>
                          </div>
                        </TableCell>
                        <TableCell>{getInstructorName(evaluation.instructorId)}</TableCell>
                        <TableCell>
                          {evaluation.signedOff ? (
                            <Badge className="bg-green-100 text-green-800 border-green-200">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Signed Off
                            </Badge>
                          ) : (
                            <Badge className="bg-amber-100 text-amber-800 border-amber-200">
                              <Clock className="h-3 w-3 mr-1" />
                              Pending
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setViewingEvaluation(evaluation)}
                              className="hover:bg-blue-50"
                            >
                              <ClipboardCheck className="h-4 w-4 text-blue-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingEvaluation(evaluation)}
                              className="hover:bg-amber-50"
                            >
                              <Edit className="h-4 w-4 text-amber-600" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {evaluations.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-12">
                          <div className="bg-gray-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                            <ClipboardCheck className="h-8 w-8 text-gray-400" />
                          </div>
                          <p className="text-gray-600 font-medium mb-1">No evaluations recorded yet</p>
                          <p className="text-sm text-gray-500">Click "New Evaluation" to create one</p>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* View Evaluation Dialog */}
          {viewingEvaluation && (
            <Dialog open={true} onOpenChange={() => setViewingEvaluation(null)}>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <ClipboardCheck className="h-5 w-5 text-[#ECC462]" />
                    Evaluation Details
                  </DialogTitle>
                  <DialogDescription>
                    {formatDate(viewingEvaluation.evaluationDate)} - {viewingEvaluation.sessionType}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs text-gray-500 mb-1">Session Type</p>
                      <p className="font-medium">{viewingEvaluation.sessionType}</p>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs text-gray-500 mb-1">Overall Rating</p>
                      <div className="flex items-center gap-2">
                        {getEvaluationIcon(viewingEvaluation.overallRating)}
                        <span className="font-medium">{viewingEvaluation.overallRating || 'Not rated'}/5</span>
                      </div>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs text-gray-500 mb-1">Instructor</p>
                      <p className="font-medium">{getInstructorName(viewingEvaluation.instructorId)}</p>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs text-gray-500 mb-1">Linked Class</p>
                      <p className="font-medium text-sm">{getClassName(viewingEvaluation.classId)}</p>
                    </div>
                  </div>

                  {viewingEvaluation.strengths && (
                    <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                      <p className="text-xs text-green-700 font-medium mb-1">Strengths</p>
                      <p className="text-sm text-green-800">{viewingEvaluation.strengths}</p>
                    </div>
                  )}

                  {viewingEvaluation.weaknesses && (
                    <div className="p-3 bg-orange-50 rounded-lg border border-orange-100">
                      <p className="text-xs text-orange-700 font-medium mb-1">Areas for Improvement</p>
                      <p className="text-sm text-orange-800">{viewingEvaluation.weaknesses}</p>
                    </div>
                  )}

                  {viewingEvaluation.comments && (
                    <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                      <p className="text-xs text-blue-700 font-medium mb-1">Instructor Comments</p>
                      <p className="text-sm text-blue-800">{viewingEvaluation.comments}</p>
                    </div>
                  )}

                  {viewingEvaluation.recommendationsForNext && (
                    <div className="p-3 bg-purple-50 rounded-lg border border-purple-100">
                      <p className="text-xs text-purple-700 font-medium mb-1">Recommendations for Next Session</p>
                      <p className="text-sm text-purple-800">{viewingEvaluation.recommendationsForNext}</p>
                    </div>
                  )}

                  <div className="flex justify-between items-center pt-4 border-t">
                    <div>
                      {viewingEvaluation.signedOff ? (
                        <Badge className="bg-green-100 text-green-800">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Signed Off {viewingEvaluation.signatureDate && `on ${formatDate(viewingEvaluation.signatureDate)}`}
                        </Badge>
                      ) : (
                        <Badge className="bg-amber-100 text-amber-800">Pending Sign-off</Badge>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setViewingEvaluation(null)}>
                        Close
                      </Button>
                      <Button 
                        onClick={() => {
                          setViewingEvaluation(null);
                          setEditingEvaluation(viewingEvaluation);
                        }}
                        className="bg-[#ECC462] text-[#111111] hover:bg-[#ECC462]/90"
                      >
                        <Edit className="h-4 w-4 mr-2" />
                        Edit
                      </Button>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}

          {/* Edit Evaluation Dialog */}
          {editingEvaluation && (
            <Dialog open={true} onOpenChange={() => setEditingEvaluation(null)}>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Edit Evaluation</DialogTitle>
                  <DialogDescription>
                    Update the evaluation for {student?.firstName} {student?.lastName}
                  </DialogDescription>
                </DialogHeader>
                <EvaluationForm 
                  evaluation={editingEvaluation}
                  onSuccess={() => {
                    setEditingEvaluation(null);
                    queryClient.invalidateQueries({ queryKey: ["/api/evaluations", "student", studentId] });
                  }} 
                />
              </DialogContent>
            </Dialog>
          )}
        </TabsContent>

        <TabsContent value="contracts">
          <Card className="mobile-card">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center">
                  <FileText className="mr-2 h-5 w-5" />
                  Contracts & Payments
                </div>
                <Dialog open={isNewContractDialogOpen} onOpenChange={setIsNewContractDialogOpen}>
                  <DialogTrigger asChild>
                    <Button 
                      size="sm" 
                      className="touch-target"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      New Contract
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto dialog-content">
                    <DialogHeader>
                      <DialogTitle>New Contract for {student.firstName} {student.lastName}</DialogTitle>
                      <DialogDescription>
                        Create a new contract record for this student.
                      </DialogDescription>
                    </DialogHeader>
                    <ContractForm 
                      contract={{ studentId: student.id }}
                      onSuccess={() => {
                        setIsNewContractDialogOpen(false);
                      }} 
                    />
                  </DialogContent>
                </Dialog>
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
                          contract.status === "completed" ? "bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111] shadow-md" :
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

        <TabsContent value="statement">
          <StatementOfAccount studentId={studentId} />
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
                          <Badge className="bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111] shadow-md">
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

        <TabsContent value="lesson-notes">
          <Card className="mobile-card">
            <CardHeader>
              <CardTitle className="flex items-center">
                <FileText className="mr-2 h-5 w-5" />
                Lesson Notes (Internal)
              </CardTitle>
              <CardDescription>
                Internal instructor notes from completed lessons
              </CardDescription>
            </CardHeader>
            <CardContent>
              {lessonNotes.length > 0 ? (
                <div className="space-y-4" data-testid="lesson-notes-list">
                  {lessonNotes.map((note: any) => (
                    <div 
                      key={note.id}
                      data-testid={`lesson-note-${note.id}`}
                      className="p-4 bg-gradient-to-r from-yellow-50 to-amber-50 rounded-lg border border-yellow-200 hover:shadow-md transition-shadow duration-200"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="font-semibold text-gray-900">
                            {note.lessonType === 'auto' ? 'In-Car (Auto)' : note.lessonType === 'moto' ? 'In-Car (Moto)' : 'Theory Class'}
                          </p>
                          <p className="text-sm text-gray-600">
                            {formatDate(note.lessonDate)} • {note.duration} minutes
                          </p>
                        </div>
                        <Badge className="bg-[#ECC462] text-[#111111]">
                          {note.status || 'completed'}
                        </Badge>
                      </div>
                      
                      {note.instructorFirstName && (
                        <div className="mb-2">
                          <p className="text-xs text-gray-500">
                            Instructor: {note.instructorFirstName} {note.instructorLastName}
                          </p>
                        </div>
                      )}

                      {note.notes && (
                        <div className="mb-2 p-3 bg-white rounded border border-yellow-100">
                          <p className="text-xs font-medium text-gray-700 mb-1">Lesson Notes:</p>
                          <p className="text-sm text-gray-600 whitespace-pre-wrap">{note.notes}</p>
                        </div>
                      )}

                      {note.instructorFeedback && (
                        <div className="p-3 bg-white rounded border border-amber-100">
                          <p className="text-xs font-medium text-gray-700 mb-1">Instructor Feedback:</p>
                          <p className="text-sm text-gray-600 whitespace-pre-wrap">{note.instructorFeedback}</p>
                        </div>
                      )}

                      {note.createdAt && (
                        <div className="mt-2">
                          <p className="text-xs text-gray-400">
                            Recorded on {formatDate(note.createdAt)}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="bg-gray-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                    <FileText className="h-10 w-10 text-gray-400" />
                  </div>
                  <p className="text-gray-500 font-medium">No lesson notes recorded yet</p>
                  <p className="text-sm text-gray-400 mt-1">Instructors will add notes after completing lessons</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="student-notes">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="mobile-card border-amber-200">
              <CardHeader className="bg-amber-50/50">
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center">
                    <Lock className="mr-2 h-5 w-5 text-amber-600" />
                    Internal Notes (Staff Only)
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-300 text-amber-700 hover:bg-amber-50"
                    onClick={() => setShowInternalNoteForm(!showInternalNoteForm)}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Note
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                {showInternalNoteForm && (
                  <div className="mb-4 space-y-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
                    <Textarea
                      placeholder="Write an internal note..."
                      value={internalNoteContent}
                      onChange={(e) => setInternalNoteContent(e.target.value)}
                      rows={3}
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        disabled={!internalNoteContent.trim() || createNoteMutation.isPending}
                        onClick={() => createNoteMutation.mutate({ noteType: 'internal', content: internalNoteContent })}
                        className="bg-amber-600 hover:bg-amber-700"
                      >
                        <Send className="h-4 w-4 mr-1" />
                        Submit
                      </Button>
                    </div>
                  </div>
                )}
                {studentNotes.filter(n => n.noteType === 'internal').length === 0 ? (
                  <div className="text-center py-6 text-gray-400">
                    <Lock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No internal notes yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {studentNotes.filter(n => n.noteType === 'internal').map((note) => (
                      <div key={note.id} className="p-3 bg-amber-50/50 rounded-lg border border-amber-100">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{note.authorName}</span>
                            <Badge variant="outline" className="text-xs capitalize">{note.authorRole}</Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400">
                              {note.createdAt ? new Date(note.createdAt).toLocaleDateString() : ''}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 text-red-400 hover:text-red-600"
                              onClick={() => deleteNoteMutation.mutate(note.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{note.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="mobile-card border-green-200">
              <CardHeader className="bg-green-50/50">
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center">
                    <MessageSquare className="mr-2 h-5 w-5 text-green-600" />
                    Notes Shared with Student
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-green-300 text-green-700 hover:bg-green-50"
                    onClick={() => setShowVisibleNoteForm(!showVisibleNoteForm)}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Note
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                {showVisibleNoteForm && (
                  <div className="mb-4 space-y-2 p-3 bg-green-50 rounded-lg border border-green-200">
                    <Textarea
                      placeholder="Write a note visible to the student..."
                      value={visibleNoteContent}
                      onChange={(e) => setVisibleNoteContent(e.target.value)}
                      rows={3}
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        disabled={!visibleNoteContent.trim() || createNoteMutation.isPending}
                        onClick={() => createNoteMutation.mutate({ noteType: 'student_visible', content: visibleNoteContent })}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        <Send className="h-4 w-4 mr-1" />
                        Submit
                      </Button>
                    </div>
                  </div>
                )}
                {studentNotes.filter(n => n.noteType === 'student_visible').length === 0 ? (
                  <div className="text-center py-6 text-gray-400">
                    <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No student-visible notes yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {studentNotes.filter(n => n.noteType === 'student_visible').map((note) => (
                      <div key={note.id} className="p-3 bg-green-50/50 rounded-lg border border-green-100">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{note.authorName}</span>
                            <Badge variant="outline" className="text-xs capitalize">{note.authorRole}</Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400">
                              {note.createdAt ? new Date(note.createdAt).toLocaleDateString() : ''}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 text-red-400 hover:text-red-600"
                              onClick={() => deleteNoteMutation.mutate(note.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{note.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="courses">
          <Card className="mobile-card">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center">
                  <BookOpen className="mr-2 h-5 w-5" />
                  Course Enrollments
                </div>
                <Button size="sm" className="touch-target bg-[#ECC462] text-[#111111] hover:bg-[#ECC462]/90">
                  <Plus className="mr-1 h-4 w-4" />
                  Add Course
                </Button>
              </CardTitle>
              <CardDescription>
                Manage student's enrolled courses (auto, moto, scooter)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {studentCourses.length > 0 ? (
                <div className="space-y-4" data-testid="courses-list">
                  {studentCourses.map((course) => (
                    <div 
                      key={course.id}
                      data-testid={`course-${course.id}`}
                      className="p-4 rounded-lg border border-gray-200 hover:border-[#ECC462] transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className={`h-12 w-12 rounded-lg flex items-center justify-center ${
                            course.courseType === 'moto' ? 'bg-purple-100' :
                            course.courseType === 'scooter' ? 'bg-blue-100' :
                            'bg-green-100'
                          }`}>
                            {course.courseType === 'moto' || course.courseType === 'scooter' ? (
                              <Bike className={`h-6 w-6 ${course.courseType === 'moto' ? 'text-purple-600' : 'text-blue-600'}`} />
                            ) : (
                              <Car className="h-6 w-6 text-green-600" />
                            )}
                          </div>
                          <div>
                            <h4 className="font-semibold text-gray-900 capitalize">
                              {course.courseType === 'moto' ? 'Motorcycle' : 
                               course.courseType === 'scooter' ? 'Scooter' : 'Automobile'} Course
                            </h4>
                            <p className="text-sm text-gray-600">
                              {course.phase || 'Not started'} • Progress: {course.progress}%
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={
                            course.status === 'active' ? 'bg-green-100 text-green-800' :
                            course.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                            'bg-gray-100 text-gray-800'
                          }>
                            {course.status}
                          </Badge>
                          <Button size="sm" variant="ghost">
                            <Edit className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      {course.enrollmentDate && (
                        <div className="mt-2 text-xs text-gray-500">
                          Enrolled: {formatDate(course.enrollmentDate)}
                          {course.completionDate && ` • Completed: ${formatDate(course.completionDate)}`}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="bg-gray-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                    <BookOpen className="h-10 w-10 text-gray-400" />
                  </div>
                  <p className="text-gray-500 font-medium">No course enrollments yet</p>
                  <p className="text-sm text-gray-400 mt-1">Add a course to track the student's progress</p>
                  <Button className="mt-4 bg-[#ECC462] text-[#111111] hover:bg-[#ECC462]/90">
                    <Plus className="mr-1 h-4 w-4" />
                    Add First Course
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="parents">
          <Card className="mobile-card">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center">
                  <Users className="mr-2 h-5 w-5" />
                  Parents & Guardians
                </div>
                <Button size="sm" className="touch-target bg-[#ECC462] text-[#111111] hover:bg-[#ECC462]/90">
                  <Plus className="mr-1 h-4 w-4" />
                  Link Parent
                </Button>
              </CardTitle>
              <CardDescription>
                Manage linked parents and guardians with access permissions
              </CardDescription>
            </CardHeader>
            <CardContent>
              {studentParents.length > 0 ? (
                <div className="space-y-4" data-testid="parents-list">
                  {studentParents.map((link) => (
                    <div 
                      key={link.id}
                      data-testid={`parent-${link.id}`}
                      className="p-4 rounded-lg border border-gray-200 hover:border-[#ECC462] transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="h-12 w-12 rounded-full bg-[#ECC462]/20 flex items-center justify-center">
                            <User className="h-6 w-6 text-[#111111]" />
                          </div>
                          <div>
                            <h4 className="font-semibold text-gray-900">
                              {link.parent?.firstName} {link.parent?.lastName}
                            </h4>
                            <p className="text-sm text-gray-600">
                              {link.parent?.email}
                            </p>
                            {link.parent?.phone && (
                              <p className="text-sm text-gray-500">{link.parent.phone}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="font-medium">
                            {link.permissionLevel === 'view_only' && 'View Only'}
                            {link.permissionLevel === 'view_book' && 'View + Book'}
                            {link.permissionLevel === 'view_book_pay' && 'Full Access'}
                          </Badge>
                          <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700 hover:bg-red-50">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      {link.parent?.relationship && (
                        <div className="mt-2">
                          <Badge variant="secondary" className="text-xs">
                            {link.parent.relationship}
                          </Badge>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="bg-gray-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                    <Users className="h-10 w-10 text-gray-400" />
                  </div>
                  <p className="text-gray-500 font-medium">No parents or guardians linked</p>
                  <p className="text-sm text-gray-400 mt-1">Link a parent to give them access to the student's information</p>
                  <Button className="mt-4 bg-[#ECC462] text-[#111111] hover:bg-[#ECC462]/90">
                    <Plus className="mr-1 h-4 w-4" />
                    Link First Parent
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}