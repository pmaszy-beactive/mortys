import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart3, Users, Calendar, FileText, Download, TrendingUp, Clock, Car, BookOpen, AlertTriangle, MapPin, Loader2, UserX, Search, Lock } from "lucide-react";
import { formatCurrency, getCourseColor } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import type { Student, Instructor, Class, Contract, Evaluation, Location } from "@shared/schema";

interface AttendanceRecord {
  enrollmentId: number;
  classId: number | null;
  classDate: string;
  classTime: string;
  classNumber: number;
  classType: string;
  courseType: string;
  studentId: number | null;
  studentName: string;
  studentEmail: string;
  instructorId: number | null | undefined;
  instructorName: string;
  attendanceStatus: string;
  testScore: number | null;
}

interface PayrollRecord {
  instructorId: number;
  instructorName: string;
  email: string;
  theoryClasses: number;
  drivingClasses: number;
  theoryHours: number;
  drivingHours: number;
  totalHours: number;
}

interface StudentCreditsRecord {
  studentId: number;
  studentName: string;
  email: string;
  phone: string;
  courseType: string;
  status: string;
  totalEnrollments: number;
  totalAttended: number;
  theoryClassesAttended: number;
  drivingClassesAttended: number;
  theoryHoursCompleted: number;
  practicalHoursCompleted: number;
  progress: number;
}

export default function Reports() {
  const [registrationPeriod, setRegistrationPeriod] = useState<'day' | 'month' | 'year'>('month');
  const [registrationStartDate, setRegistrationStartDate] = useState('');
  const [registrationEndDate, setRegistrationEndDate] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  
  const [attendanceStartDate, setAttendanceStartDate] = useState('');
  const [attendanceEndDate, setAttendanceEndDate] = useState('');
  const [attendanceInstructorId, setAttendanceInstructorId] = useState('');
  const [attendanceStudentId, setAttendanceStudentId] = useState('');
  const [attendanceStatus, setAttendanceStatus] = useState('all');
  const [attendanceSearch, setAttendanceSearch] = useState('');
  
  const [payrollStartDate, setPayrollStartDate] = useState('');
  const [payrollEndDate, setPayrollEndDate] = useState('');
  const [payrollInstructorId, setPayrollInstructorId] = useState('');
  
  const [creditsStudentSearch, setCreditsStudentSearch] = useState('');
  const [creditsCourseType, setCreditsCourseType] = useState('all');
  
  const { toast } = useToast();
  const { user } = useAuth();
  
  // Check if user has payroll access (owner or admin only)
  const canViewPayroll = user?.role === 'owner' || user?.role === 'admin';

  const { data: studentsResponse } = useQuery<{students: Student[]}>({
    queryKey: ["/api/students"],
  });
  const students = studentsResponse?.students || [];

  const { data: instructors = [] } = useQuery<Instructor[]>({
    queryKey: ["/api/instructors"],
  });

  const { data: classes = [] } = useQuery<Class[]>({
    queryKey: ["/api/classes"],
  });

  const { data: contracts = [] } = useQuery<Contract[]>({
    queryKey: ["/api/contracts"],
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: attendanceRecords = [], isLoading: attendanceLoading } = useQuery<AttendanceRecord[]>({
    queryKey: ["/api/reports/attendance", attendanceStartDate, attendanceEndDate, attendanceInstructorId, attendanceStudentId, attendanceStatus],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (attendanceStartDate) params.append('startDate', attendanceStartDate);
      if (attendanceEndDate) params.append('endDate', attendanceEndDate);
      if (attendanceInstructorId && attendanceInstructorId !== 'all') params.append('instructorId', attendanceInstructorId);
      if (attendanceStudentId && attendanceStudentId !== 'all') params.append('studentId', attendanceStudentId);
      if (attendanceStatus && attendanceStatus !== 'all') params.append('status', attendanceStatus);
      
      const response = await fetch(`/api/reports/attendance?${params}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch attendance');
      return response.json();
    }
  });

  const { data: payrollRecords = [], isLoading: payrollLoading } = useQuery<PayrollRecord[]>({
    queryKey: ["/api/reports/payroll", payrollStartDate, payrollEndDate, payrollInstructorId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (payrollStartDate) params.append('startDate', payrollStartDate);
      if (payrollEndDate) params.append('endDate', payrollEndDate);
      if (payrollInstructorId && payrollInstructorId !== 'all') params.append('instructorId', payrollInstructorId);
      
      const response = await fetch(`/api/reports/payroll?${params}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch payroll');
      return response.json();
    }
  });

  const { data: creditsRecords = [], isLoading: creditsLoading } = useQuery<StudentCreditsRecord[]>({
    queryKey: ["/api/reports/student-credits", creditsCourseType],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (creditsCourseType && creditsCourseType !== 'all') params.append('courseType', creditsCourseType);
      
      const response = await fetch(`/api/reports/student-credits?${params}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch student credits');
      return response.json();
    }
  });

  const registrationAnalyticsQuery = useQuery({
    queryKey: ["/api/students/registration-analytics", registrationPeriod, registrationStartDate, registrationEndDate, selectedLocationId],
    queryFn: async () => {
      const params = new URLSearchParams({
        period: registrationPeriod,
        ...(registrationStartDate && { startDate: registrationStartDate }),
        ...(registrationEndDate && { endDate: registrationEndDate }),
        ...(selectedLocationId && selectedLocationId !== 'all' && { locationId: selectedLocationId })
      });
      const response = await fetch(`/api/students/registration-analytics?${params}`);
      if (!response.ok) throw new Error('Failed to fetch registration analytics');
      return response.json();
    },
  });

  const registrationAnalytics = registrationAnalyticsQuery.data || [];
  const safeStudents = Array.isArray(students) ? students : [];

  const courseStats = {
    auto: safeStudents.filter(s => s.courseType === "auto").length,
    moto: safeStudents.filter(s => s.courseType === "moto").length,
    scooter: safeStudents.filter(s => s.courseType === "scooter").length,
  };

  const completionStats = {
    completed: safeStudents.filter(s => s.status === "completed").length,
    active: safeStudents.filter(s => s.status === "active").length,
    onHold: safeStudents.filter(s => s.status === "on-hold").length,
  };

  const revenueStats = {
    auto: contracts.filter(c => c.courseType === "auto").reduce((sum, c) => sum + parseFloat(c.amount), 0),
    moto: contracts.filter(c => c.courseType === "moto").reduce((sum, c) => sum + parseFloat(c.amount), 0),
    scooter: contracts.filter(c => c.courseType === "scooter").reduce((sum, c) => sum + parseFloat(c.amount), 0),
  };

  const totalRevenue = revenueStats.auto + revenueStats.moto + revenueStats.scooter;

  const filteredAttendance = attendanceRecords.filter(r => {
    if (!attendanceSearch) return true;
    const search = attendanceSearch.toLowerCase();
    return r.studentName.toLowerCase().includes(search) || r.instructorName.toLowerCase().includes(search);
  });

  const filteredCredits = creditsRecords.filter(r => {
    if (!creditsStudentSearch) return true;
    const search = creditsStudentSearch.toLowerCase();
    return r.studentName.toLowerCase().includes(search) || r.email.toLowerCase().includes(search);
  });

  const handleExportCsv = async (type: 'attendance' | 'payroll' | 'credits') => {
    try {
      let url = '';
      let filename = '';
      
      if (type === 'attendance') {
        const params = new URLSearchParams({ format: 'csv' });
        if (attendanceStartDate) params.append('startDate', attendanceStartDate);
        if (attendanceEndDate) params.append('endDate', attendanceEndDate);
        if (attendanceInstructorId && attendanceInstructorId !== 'all') params.append('instructorId', attendanceInstructorId);
        if (attendanceStudentId && attendanceStudentId !== 'all') params.append('studentId', attendanceStudentId);
        if (attendanceStatus && attendanceStatus !== 'all') params.append('status', attendanceStatus);
        url = `/api/reports/attendance?${params}`;
        filename = 'attendance-report';
      } else if (type === 'payroll') {
        const params = new URLSearchParams({ format: 'csv' });
        if (payrollStartDate) params.append('startDate', payrollStartDate);
        if (payrollEndDate) params.append('endDate', payrollEndDate);
        if (payrollInstructorId && payrollInstructorId !== 'all') params.append('instructorId', payrollInstructorId);
        url = `/api/reports/payroll?${params}`;
        filename = 'payroll-report';
      } else {
        const params = new URLSearchParams({ format: 'csv' });
        if (creditsCourseType && creditsCourseType !== 'all') params.append('courseType', creditsCourseType);
        url = `/api/reports/student-credits?${params}`;
        filename = 'student-credits-report';
      }
      
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Export failed');
      
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${filename}-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
      
      toast({ title: "Export Complete", description: "Your CSV file has been downloaded." });
    } catch (error) {
      toast({ title: "Export Failed", description: "Failed to export data.", variant: "destructive" });
    }
  };

  const handleExportPdf = async () => {
    setIsGeneratingPdf(true);
    try {
      const params = new URLSearchParams({
        period: registrationPeriod,
        ...(registrationStartDate && { startDate: registrationStartDate }),
        ...(registrationEndDate && { endDate: registrationEndDate }),
        ...(selectedLocationId && selectedLocationId !== 'all' && { locationId: selectedLocationId })
      });
      
      const response = await fetch(`/api/reports/download-pdf?${params.toString()}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to generate PDF');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `morty-driving-school-report-${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({ title: "Report Generated", description: "Your PDF report has been downloaded successfully." });
    } catch (error) {
      toast({ title: "Export Failed", description: "Failed to generate PDF report.", variant: "destructive" });
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'attended':
        return <Badge className="bg-green-100 text-green-800">Attended</Badge>;
      case 'no-show':
        return <Badge className="bg-red-100 text-red-800">No-Show</Badge>;
      case 'absent':
        return <Badge className="bg-yellow-100 text-yellow-800">Absent</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800">{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="mb-10">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">
              Reports & Analytics
            </h1>
            <p className="text-gray-600">
              Search, filter, and export attendance, payroll, and student credit reports.
            </p>
          </div>
          <Button 
            className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] font-medium rounded-md shadow-sm"
            onClick={handleExportPdf}
            disabled={isGeneratingPdf}
            data-testid="button-export-pdf"
          >
            {isGeneratingPdf ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating...</>
            ) : (
              <><Download className="mr-2 h-4 w-4" />Export Summary</>
            )}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
        <div className="stat-card">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600 mb-1">Total Students</p>
              <p className="text-3xl font-bold text-gray-900">{safeStudents.length}</p>
            </div>
            <Users className="text-gray-400 h-6 w-6" />
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600 mb-1">Completion Rate</p>
              <p className="text-3xl font-bold text-gray-900">
                {safeStudents.length > 0 ? Math.round((completionStats.completed / safeStudents.length) * 100) : 0}%
              </p>
            </div>
            <TrendingUp className="text-gray-400 h-6 w-6" />
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600 mb-1">Total Classes</p>
              <p className="text-3xl font-bold text-gray-900">{classes.length}</p>
            </div>
            <Calendar className="text-gray-400 h-6 w-6" />
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600 mb-1">Total Revenue</p>
              <p className="text-3xl font-bold text-gray-900">{formatCurrency(totalRevenue)}</p>
            </div>
            <FileText className="text-gray-400 h-6 w-6" />
          </div>
        </div>
      </div>

      <Tabs defaultValue="attendance" className="space-y-6">
        <TabsList className="bg-white border border-gray-200 rounded-md p-1">
          <TabsTrigger value="attendance" className="rounded-md" data-testid="tab-attendance">Attendance</TabsTrigger>
          {canViewPayroll && (
            <TabsTrigger value="payroll" className="rounded-md" data-testid="tab-payroll">Payroll / Hours</TabsTrigger>
          )}
          <TabsTrigger value="credits" className="rounded-md" data-testid="tab-credits">Student Credits</TabsTrigger>
          <TabsTrigger value="registration" className="rounded-md" data-testid="tab-registration">Registration</TabsTrigger>
        </TabsList>

        <TabsContent value="attendance" className="space-y-6">
          <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
            <CardHeader className="bg-gray-50/50 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <CardTitle className="text-xl font-semibold text-gray-900">Attendance Report</CardTitle>
                <Button onClick={() => handleExportCsv('attendance')} variant="outline" size="sm" className="rounded-md" data-testid="button-export-attendance">
                  <Download className="h-4 w-4 mr-2" />Export CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-6">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input type="date" value={attendanceStartDate} onChange={(e) => setAttendanceStartDate(e.target.value)} data-testid="input-attendance-start" />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input type="date" value={attendanceEndDate} onChange={(e) => setAttendanceEndDate(e.target.value)} data-testid="input-attendance-end" />
                </div>
                <div className="space-y-2">
                  <Label>Instructor</Label>
                  <Select value={attendanceInstructorId} onValueChange={setAttendanceInstructorId}>
                    <SelectTrigger data-testid="select-attendance-instructor"><SelectValue placeholder="All" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Instructors</SelectItem>
                      {instructors.map(i => <SelectItem key={i.id} value={i.id.toString()}>{i.firstName} {i.lastName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Student</Label>
                  <Select value={attendanceStudentId} onValueChange={setAttendanceStudentId}>
                    <SelectTrigger data-testid="select-attendance-student"><SelectValue placeholder="All" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Students</SelectItem>
                      {safeStudents.slice(0, 50).map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.firstName} {s.lastName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={attendanceStatus} onValueChange={setAttendanceStatus}>
                    <SelectTrigger data-testid="select-attendance-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="registered">Registered</SelectItem>
                      <SelectItem value="attended">Attended</SelectItem>
                      <SelectItem value="absent">Absent</SelectItem>
                      <SelectItem value="no-show">No-Show</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Search</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input placeholder="Name..." value={attendanceSearch} onChange={(e) => setAttendanceSearch(e.target.value)} className="pl-9" data-testid="input-attendance-search" />
                  </div>
                </div>
              </div>

              {attendanceLoading ? (
                <div className="text-center py-12"><Loader2 className="h-8 w-8 animate-spin mx-auto text-[#ECC462]" /></div>
              ) : filteredAttendance.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <AlertTriangle className="h-16 w-16 mx-auto text-gray-300 mb-4" />
                  <p className="text-lg font-medium">No attendance records found</p>
                  <p className="text-sm">Try adjusting your filters</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Student</TableHead>
                        <TableHead>Instructor</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAttendance.slice(0, 100).map((record) => (
                        <TableRow key={record.enrollmentId} className="hover:bg-amber-50/50">
                          <TableCell className="font-medium">{record.classDate}</TableCell>
                          <TableCell>{record.classTime}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={record.classType === 'Theory' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'}>
                              {record.classType} #{record.classNumber}
                            </Badge>
                          </TableCell>
                          <TableCell>{record.studentName}</TableCell>
                          <TableCell>{record.instructorName}</TableCell>
                          <TableCell>{getStatusBadge(record.attendanceStatus)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {filteredAttendance.length > 100 && (
                    <p className="text-sm text-gray-500 mt-4 text-center">Showing 100 of {filteredAttendance.length} records. Export CSV for full data.</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {canViewPayroll && (
          <TabsContent value="payroll" className="space-y-6">
            <Card className="border border-gray-200 bg-white shadow-sm">
              <CardHeader className="border-b border-gray-100">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-xl font-semibold text-gray-800">
                    <Lock className="inline h-4 w-4 mr-2 text-amber-600" />
                    Instructor Payroll / Hours Report
                  </CardTitle>
                  <Button onClick={() => handleExportCsv('payroll')} variant="outline" data-testid="button-export-payroll">
                    <Download className="h-4 w-4 mr-2" />Export CSV
                  </Button>
                </div>
              </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input type="date" value={payrollStartDate} onChange={(e) => setPayrollStartDate(e.target.value)} data-testid="input-payroll-start" />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input type="date" value={payrollEndDate} onChange={(e) => setPayrollEndDate(e.target.value)} data-testid="input-payroll-end" />
                </div>
                <div className="space-y-2">
                  <Label>Instructor</Label>
                  <Select value={payrollInstructorId} onValueChange={setPayrollInstructorId}>
                    <SelectTrigger data-testid="select-payroll-instructor"><SelectValue placeholder="All" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Instructors</SelectItem>
                      {instructors.map(i => <SelectItem key={i.id} value={i.id.toString()}>{i.firstName} {i.lastName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {payrollLoading ? (
                <div className="text-center py-12"><Loader2 className="h-8 w-8 animate-spin mx-auto text-[#ECC462]" /></div>
              ) : payrollRecords.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Clock className="h-16 w-16 mx-auto text-gray-300 mb-4" />
                  <p className="text-lg font-medium">No payroll data found</p>
                  <p className="text-sm">No completed classes in the selected date range</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Instructor</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead className="text-right">Theory Classes</TableHead>
                        <TableHead className="text-right">Driving Classes</TableHead>
                        <TableHead className="text-right">Theory Hours</TableHead>
                        <TableHead className="text-right">Driving Hours</TableHead>
                        <TableHead className="text-right">Total Hours</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payrollRecords.map((record) => (
                        <TableRow key={record.instructorId} className="hover:bg-amber-50/50">
                          <TableCell className="font-medium">{record.instructorName}</TableCell>
                          <TableCell className="text-gray-600">{record.email}</TableCell>
                          <TableCell className="text-right">{record.theoryClasses}</TableCell>
                          <TableCell className="text-right">{record.drivingClasses}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant="outline" className="bg-blue-50 text-blue-700">{record.theoryHours}h</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant="outline" className="bg-green-50 text-green-700">{record.drivingHours}h</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge className="bg-[#ECC462] text-[#111111]">{record.totalHours}h</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-gray-50 font-semibold">
                        <TableCell colSpan={2}>Total</TableCell>
                        <TableCell className="text-right">{payrollRecords.reduce((s, r) => s + r.theoryClasses, 0)}</TableCell>
                        <TableCell className="text-right">{payrollRecords.reduce((s, r) => s + r.drivingClasses, 0)}</TableCell>
                        <TableCell className="text-right text-blue-700">{payrollRecords.reduce((s, r) => s + r.theoryHours, 0)}h</TableCell>
                        <TableCell className="text-right text-green-700">{payrollRecords.reduce((s, r) => s + r.drivingHours, 0)}h</TableCell>
                        <TableCell className="text-right">{payrollRecords.reduce((s, r) => s + r.totalHours, 0)}h</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="credits" className="space-y-6">
          <Card className="border border-gray-200 bg-white shadow-sm">
            <CardHeader className="border-b border-gray-100">
              <div className="flex justify-between items-center">
                <CardTitle className="text-xl font-semibold text-gray-800">Student Class Credits Report</CardTitle>
                <Button onClick={() => handleExportCsv('credits')} variant="outline" data-testid="button-export-credits">
                  <Download className="h-4 w-4 mr-2" />Export CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="space-y-2">
                  <Label>Search Student</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input placeholder="Name or email..." value={creditsStudentSearch} onChange={(e) => setCreditsStudentSearch(e.target.value)} className="pl-9" data-testid="input-credits-search" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Course Type</Label>
                  <Select value={creditsCourseType} onValueChange={setCreditsCourseType}>
                    <SelectTrigger data-testid="select-credits-course"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Courses</SelectItem>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="moto">Moto</SelectItem>
                      <SelectItem value="scooter">Scooter</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {creditsLoading ? (
                <div className="text-center py-12"><Loader2 className="h-8 w-8 animate-spin mx-auto text-[#ECC462]" /></div>
              ) : filteredCredits.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Users className="h-16 w-16 mx-auto text-gray-300 mb-4" />
                  <p className="text-lg font-medium">No students found</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Student</TableHead>
                        <TableHead>Course</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Theory Classes</TableHead>
                        <TableHead className="text-right">Driving Classes</TableHead>
                        <TableHead className="text-right">Theory Hours</TableHead>
                        <TableHead className="text-right">Practical Hours</TableHead>
                        <TableHead className="text-right">Progress</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCredits.slice(0, 100).map((record) => (
                        <TableRow key={record.studentId} className="hover:bg-amber-50/50">
                          <TableCell>
                            <div>
                              <p className="font-medium">{record.studentName}</p>
                              <p className="text-sm text-gray-500">{record.email}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className="capitalize bg-[#ECC462] text-[#111111]">{record.courseType}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={record.status === 'active' ? 'bg-green-50 text-green-700' : record.status === 'completed' ? 'bg-blue-50 text-blue-700' : 'bg-yellow-50 text-yellow-700'}>
                              {record.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{record.theoryClassesAttended}</TableCell>
                          <TableCell className="text-right">{record.drivingClassesAttended}</TableCell>
                          <TableCell className="text-right">{record.theoryHoursCompleted}</TableCell>
                          <TableCell className="text-right">{record.practicalHoursCompleted}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Progress value={record.progress} className="w-16 h-2" />
                              <span className="text-sm font-medium">{record.progress}%</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {filteredCredits.length > 100 && (
                    <p className="text-sm text-gray-500 mt-4 text-center">Showing 100 of {filteredCredits.length} students. Export CSV for full data.</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="registration" className="space-y-6">
          <Card className="border border-gray-200 bg-white shadow-sm">
            <CardHeader className="border-b border-gray-100">
              <CardTitle className="flex items-center gap-3 text-xl font-semibold text-gray-800">
                <div className="w-8 h-8 bg-[#ECC462] rounded-md flex items-center justify-center">
                  <MapPin className="h-5 w-5 text-[#111111]" />
                </div>
                Student Registration Analytics
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div>
                  <Label>Time Period</Label>
                  <Select value={registrationPeriod} onValueChange={(v: 'day' | 'month' | 'year') => setRegistrationPeriod(v)}>
                    <SelectTrigger className="mt-1" data-testid="select-registration-period"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">By Day</SelectItem>
                      <SelectItem value="month">By Month</SelectItem>
                      <SelectItem value="year">By Year</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Start Date</Label>
                  <Input type="date" value={registrationStartDate} onChange={(e) => setRegistrationStartDate(e.target.value)} className="mt-1" data-testid="input-registration-start" />
                </div>
                <div>
                  <Label>End Date</Label>
                  <Input type="date" value={registrationEndDate} onChange={(e) => setRegistrationEndDate(e.target.value)} className="mt-1" data-testid="input-registration-end" />
                </div>
                <div>
                  <Label>Location</Label>
                  <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                    <SelectTrigger className="mt-1" data-testid="select-location"><SelectValue placeholder="All" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Locations</SelectItem>
                      {locations.map((l) => <SelectItem key={l.id} value={l.id.toString()}>{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {registrationAnalyticsQuery.isLoading ? (
                <div className="text-center py-12"><Loader2 className="h-8 w-8 animate-spin mx-auto text-[#ECC462]" /></div>
              ) : registrationAnalytics.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <BarChart3 className="h-16 w-16 mx-auto text-gray-300 mb-4" />
                  <p className="text-lg font-medium">No registration data found</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase">Period</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase">Location</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase">Course</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase">Registrations</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {registrationAnalytics.map((r: any, i: number) => (
                        <tr key={i} className="hover:bg-amber-50/50">
                          <TableCell className="font-medium">{r.period}</TableCell>
                          <TableCell>{r.locationName || 'No Location'}</TableCell>
                          <TableCell><Badge className="bg-[#ECC462] text-[#111111] capitalize">{r.courseType}</Badge></TableCell>
                          <TableCell className="font-semibold">{r.registrations}</TableCell>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
