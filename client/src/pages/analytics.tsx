import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  TrendingUp, TrendingDown, Users, GraduationCap, Calendar, Clock, 
  BookOpen, Car, AlertTriangle, CheckCircle, XCircle, UserX
} from "lucide-react";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks, subMonths } from "date-fns";

interface SummaryAnalytics {
  students: {
    total: number;
    active: number;
    completed: number;
    onHold: number;
    byCourse: {
      auto: number;
      moto: number;
      scooter: number;
    };
  };
  classes: {
    total: number;
    completed: number;
    scheduled: number;
    cancelled: number;
    theory: number;
    driving: number;
    completedTheory: number;
    completedDriving: number;
  };
  attendance: {
    totalEnrollments: number;
    attended: number;
    noShows: number;
    absences: number;
    attendanceRate: number;
    noShowRate: number;
  };
  instructorHours: {
    totalTheory: number;
    totalDriving: number;
    total: number;
    byInstructor: Array<{
      instructorId: number;
      instructorName: string;
      theoryHours: number;
      drivingHours: number;
      totalHours: number;
    }>;
  };
}

interface CompletionAnalytics {
  enrollmentYear: number;
  completionYear: number | null;
  studentsStarted: number;
  studentsCompleted: number;
  courseType: string;
  completionRate: number;
}

export default function Analytics() {
  const [period, setPeriod] = useState<"week" | "month" | "custom">("week");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [enrollmentYearFilter, setEnrollmentYearFilter] = useState<string>("all");
  const [completionYearFilter, setCompletionYearFilter] = useState<string>("all");

  const getDateRange = () => {
    const today = new Date();
    if (period === "week") {
      return {
        startDate: format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd"),
        endDate: format(endOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd")
      };
    } else if (period === "month") {
      return {
        startDate: format(startOfMonth(today), "yyyy-MM-dd"),
        endDate: format(endOfMonth(today), "yyyy-MM-dd")
      };
    } else {
      return {
        startDate: customStartDate || format(subMonths(today, 1), "yyyy-MM-dd"),
        endDate: customEndDate || format(today, "yyyy-MM-dd")
      };
    }
  };

  const dateRange = getDateRange();

  const { data: summaryData, isLoading: summaryLoading } = useQuery<SummaryAnalytics>({
    queryKey: ["/api/analytics/summary", dateRange.startDate, dateRange.endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateRange.startDate) params.append("startDate", dateRange.startDate);
      if (dateRange.endDate) params.append("endDate", dateRange.endDate);
      
      const response = await fetch(`/api/analytics/summary?${params}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch summary analytics');
      }
      
      return response.json();
    }
  });

  const { data: completionData = [], isLoading: completionLoading } = useQuery<CompletionAnalytics[]>({
    queryKey: ["/api/students/completion-analytics", enrollmentYearFilter, completionYearFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (enrollmentYearFilter !== "all") {
        params.append("enrollmentYear", enrollmentYearFilter);
      }
      if (completionYearFilter !== "all") {
        params.append("completionYear", completionYearFilter);
      }
      
      const response = await fetch(`/api/students/completion-analytics?${params}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch completion analytics');
      }
      
      return response.json();
    }
  });

  const enrollmentYears = Array.from(new Set(completionData.map(item => item.enrollmentYear))).sort((a, b) => b - a);
  const completionYears = Array.from(new Set(completionData.map(item => item.completionYear).filter(year => year !== null))).sort((a, b) => (b || 0) - (a || 0));

  const totalStudentsStarted = completionData.reduce((sum, item) => sum + item.studentsStarted, 0);
  const totalStudentsCompleted = completionData.reduce((sum, item) => sum + item.studentsCompleted, 0);
  const overallCompletionRate = totalStudentsStarted > 0 ? Math.round((totalStudentsCompleted / totalStudentsStarted) * 100) : 0;

  const getCompletionRateBadgeVariant = (rate: number): "default" | "secondary" | "destructive" => {
    if (rate >= 80) return "default";
    if (rate >= 60) return "secondary";
    return "destructive";
  };

  if (summaryLoading) {
    return (
      <div className="min-h-screen p-8">
        <div className="animate-pulse space-y-8">
          <div className="h-12 bg-gradient-to-r from-amber-200 to-yellow-200 rounded-lg w-1/3"></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 bg-white/50 backdrop-blur-sm rounded-xl"></div>
            ))}
          </div>
          <div className="h-96 bg-white/50 backdrop-blur-sm rounded-xl"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-[#111111] to-gray-800 bg-clip-text text-transparent mb-2">
            Analytics Dashboard
          </h1>
          <p className="text-gray-600 text-lg">
            View summary statistics for students, classes, instructor hours, and attendance.
          </p>
        </div>

        <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
          <CardHeader className="bg-gradient-to-r from-amber-50 to-yellow-50 border-b border-amber-100">
            <CardTitle className="text-xl font-semibold text-gray-800">Date Range</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-2">
                <Label>Period</Label>
                <Select value={period} onValueChange={(v) => setPeriod(v as "week" | "month" | "custom")}>
                  <SelectTrigger className="w-[180px]" data-testid="select-period">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="week">This Week</SelectItem>
                    <SelectItem value="month">This Month</SelectItem>
                    <SelectItem value="custom">Custom Range</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {period === "custom" && (
                <>
                  <div className="space-y-2">
                    <Label>Start Date</Label>
                    <Input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      className="w-[180px]"
                      data-testid="input-start-date"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>End Date</Label>
                    <Input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="w-[180px]"
                      data-testid="input-end-date"
                    />
                  </div>
                </>
              )}
              
              <div className="text-sm text-gray-500">
                Showing data from <span className="font-medium">{dateRange.startDate}</span> to <span className="font-medium">{dateRange.endDate}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="summary" className="space-y-6">
          <TabsList className="bg-white/80 border shadow-sm">
            <TabsTrigger value="summary" data-testid="tab-summary">Summary</TabsTrigger>
            <TabsTrigger value="instructors" data-testid="tab-instructors">Instructor Hours</TabsTrigger>
            <TabsTrigger value="completion" data-testid="tab-completion">Completion Trends</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="space-y-6">
            {/* Active Students Summary Section */}
            <Card className="border-0 shadow-xl bg-gradient-to-br from-[#ECC462] to-amber-500">
              <CardHeader className="border-b border-white/20 pb-4">
                <CardTitle className="text-xl font-bold text-white flex items-center gap-2">
                  <Users className="h-6 w-6" />
                  Active Students Overview
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div className="text-center">
                    <p className="text-5xl font-bold text-white mb-2">{summaryData?.students.active || 0}</p>
                    <p className="text-yellow-100 text-sm font-medium">Active Students</p>
                  </div>
                  <div className="text-center">
                    <p className="text-5xl font-bold text-white mb-2">{summaryData?.students.total || 0}</p>
                    <p className="text-yellow-100 text-sm font-medium">Total Enrolled</p>
                  </div>
                  <div className="text-center">
                    <p className="text-5xl font-bold text-white mb-2">{summaryData?.students.completed || 0}</p>
                    <p className="text-yellow-100 text-sm font-medium">Completed</p>
                  </div>
                  <div className="text-center">
                    <p className="text-5xl font-bold text-white mb-2">{summaryData?.students.onHold || 0}</p>
                    <p className="text-yellow-100 text-sm font-medium">On Hold</p>
                  </div>
                </div>
                <div className="mt-6 grid grid-cols-3 gap-4">
                  <div className="bg-white/20 backdrop-blur-sm rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-white">{summaryData?.students.byCourse?.auto || 0}</p>
                    <p className="text-yellow-100 text-xs font-medium">Car Students</p>
                  </div>
                  <div className="bg-white/20 backdrop-blur-sm rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-white">{summaryData?.students.byCourse?.moto || 0}</p>
                    <p className="text-yellow-100 text-xs font-medium">Motorcycle Students</p>
                  </div>
                  <div className="bg-white/20 backdrop-blur-sm rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-white">{summaryData?.students.byCourse?.scooter || 0}</p>
                    <p className="text-yellow-100 text-xs font-medium">Scooter Students</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm hover:shadow-2xl transition-all duration-300 hover:scale-105">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-600 mb-1">Total Students</p>
                      <p className="text-3xl font-bold bg-gradient-to-r from-[#ECC462] to-amber-600 bg-clip-text text-transparent">
                        {summaryData?.students.total || 0}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {summaryData?.students.active || 0} active
                      </p>
                    </div>
                    <div className="w-14 h-14 bg-gradient-to-br from-[#ECC462] to-amber-500 rounded-2xl flex items-center justify-center shadow-lg">
                      <Users className="text-white h-7 w-7" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm hover:shadow-2xl transition-all duration-300 hover:scale-105">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-600 mb-1">Classes Completed</p>
                      <p className="text-3xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
                        {summaryData?.classes.completed || 0}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        of {summaryData?.classes.total || 0} total
                      </p>
                    </div>
                    <div className="w-14 h-14 bg-gradient-to-br from-green-600 to-emerald-500 rounded-2xl flex items-center justify-center shadow-lg">
                      <CheckCircle className="text-white h-7 w-7" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm hover:shadow-2xl transition-all duration-300 hover:scale-105">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-600 mb-1">Instructor Hours</p>
                      <p className="text-3xl font-bold bg-gradient-to-r from-[#111111] to-gray-700 bg-clip-text text-transparent">
                        {summaryData?.instructorHours.total || 0}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {summaryData?.instructorHours.totalTheory || 0}h theory, {summaryData?.instructorHours.totalDriving || 0}h driving
                      </p>
                    </div>
                    <div className="w-14 h-14 bg-gradient-to-br from-[#111111] to-gray-700 rounded-2xl flex items-center justify-center shadow-lg">
                      <Clock className="text-white h-7 w-7" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm hover:shadow-2xl transition-all duration-300 hover:scale-105">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-600 mb-1">No-Shows</p>
                      <p className="text-3xl font-bold bg-gradient-to-r from-red-600 to-rose-600 bg-clip-text text-transparent">
                        {summaryData?.attendance.noShows || 0}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {summaryData?.attendance.noShowRate || 0}% rate
                      </p>
                    </div>
                    <div className="w-14 h-14 bg-gradient-to-br from-red-600 to-rose-500 rounded-2xl flex items-center justify-center shadow-lg">
                      <UserX className="text-white h-7 w-7" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
                <CardHeader className="bg-gradient-to-r from-amber-50 to-yellow-50 border-b border-amber-100">
                  <CardTitle className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                    <Users className="h-5 w-5 text-[#ECC462]" />
                    Students by Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-green-500"></div>
                        <span className="text-gray-700">Active</span>
                      </div>
                      <span className="font-semibold">{summaryData?.students.active || 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                        <span className="text-gray-700">Completed</span>
                      </div>
                      <span className="font-semibold">{summaryData?.students.completed || 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                        <span className="text-gray-700">On Hold</span>
                      </div>
                      <span className="font-semibold">{summaryData?.students.onHold || 0}</span>
                    </div>
                  </div>

                  <div className="mt-6 pt-4 border-t">
                    <p className="text-sm font-medium text-gray-600 mb-3">By Course Type</p>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div className="p-3 bg-blue-50 rounded-lg">
                        <Car className="h-5 w-5 mx-auto mb-1 text-blue-600" />
                        <p className="text-lg font-bold text-blue-600">{summaryData?.students.byCourse.auto || 0}</p>
                        <p className="text-xs text-gray-500">Auto</p>
                      </div>
                      <div className="p-3 bg-orange-50 rounded-lg">
                        <Car className="h-5 w-5 mx-auto mb-1 text-orange-600" />
                        <p className="text-lg font-bold text-orange-600">{summaryData?.students.byCourse.moto || 0}</p>
                        <p className="text-xs text-gray-500">Moto</p>
                      </div>
                      <div className="p-3 bg-purple-50 rounded-lg">
                        <Car className="h-5 w-5 mx-auto mb-1 text-purple-600" />
                        <p className="text-lg font-bold text-purple-600">{summaryData?.students.byCourse.scooter || 0}</p>
                        <p className="text-xs text-gray-500">Scooter</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
                <CardHeader className="bg-gradient-to-r from-amber-50 to-yellow-50 border-b border-amber-100">
                  <CardTitle className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-[#ECC462]" />
                    Classes Overview
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="p-4 bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl">
                      <BookOpen className="h-6 w-6 text-blue-600 mb-2" />
                      <p className="text-2xl font-bold text-blue-600">{summaryData?.classes.completedTheory || 0}</p>
                      <p className="text-sm text-gray-600">Theory Completed</p>
                    </div>
                    <div className="p-4 bg-gradient-to-br from-green-50 to-green-100 rounded-xl">
                      <Car className="h-6 w-6 text-green-600 mb-2" />
                      <p className="text-2xl font-bold text-green-600">{summaryData?.classes.completedDriving || 0}</p>
                      <p className="text-sm text-gray-600">Driving Completed</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Scheduled</span>
                      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                        {summaryData?.classes.scheduled || 0}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Cancelled</span>
                      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                        {summaryData?.classes.cancelled || 0}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
              <CardHeader className="bg-gradient-to-r from-amber-50 to-yellow-50 border-b border-amber-100">
                <CardTitle className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-[#ECC462]" />
                  Attendance Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div className="text-center p-4 bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl">
                    <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-600" />
                    <p className="text-3xl font-bold text-green-600">{summaryData?.attendance.attended || 0}</p>
                    <p className="text-sm text-gray-600">Attended</p>
                  </div>
                  <div className="text-center p-4 bg-gradient-to-br from-red-50 to-rose-50 rounded-xl">
                    <UserX className="h-8 w-8 mx-auto mb-2 text-red-600" />
                    <p className="text-3xl font-bold text-red-600">{summaryData?.attendance.noShows || 0}</p>
                    <p className="text-sm text-gray-600">No-Shows</p>
                  </div>
                  <div className="text-center p-4 bg-gradient-to-br from-yellow-50 to-amber-50 rounded-xl">
                    <XCircle className="h-8 w-8 mx-auto mb-2 text-yellow-600" />
                    <p className="text-3xl font-bold text-yellow-600">{summaryData?.attendance.absences || 0}</p>
                    <p className="text-sm text-gray-600">Absences</p>
                  </div>
                  <div className="text-center p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl">
                    <TrendingUp className="h-8 w-8 mx-auto mb-2 text-blue-600" />
                    <p className="text-3xl font-bold text-blue-600">{summaryData?.attendance.attendanceRate || 0}%</p>
                    <p className="text-sm text-gray-600">Attendance Rate</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="instructors" className="space-y-6">
            <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
              <CardHeader className="bg-gradient-to-r from-amber-50 to-yellow-50 border-b border-amber-100">
                <CardTitle className="text-xl font-semibold text-gray-800">Instructor Hours Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {summaryData?.instructorHours.byInstructor.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Clock className="h-16 w-16 mx-auto text-gray-300 mb-4" />
                    <p className="text-lg font-medium">No instructor hours recorded</p>
                    <p className="text-sm">No completed classes found in the selected date range.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-gray-200">
                          <TableHead className="font-semibold text-gray-700">Instructor</TableHead>
                          <TableHead className="text-right font-semibold text-gray-700">Theory Hours</TableHead>
                          <TableHead className="text-right font-semibold text-gray-700">Driving Hours</TableHead>
                          <TableHead className="text-right font-semibold text-gray-700">Total Hours</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {summaryData?.instructorHours.byInstructor.map((instructor) => (
                          <TableRow 
                            key={instructor.instructorId}
                            className="border-gray-100 hover:bg-gradient-to-r hover:from-amber-50 hover:to-yellow-50 transition-all duration-200"
                          >
                            <TableCell className="font-medium text-gray-900">{instructor.instructorName}</TableCell>
                            <TableCell className="text-right">
                              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                                {instructor.theoryHours}h
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                {instructor.drivingHours}h
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge className="bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111]">
                                {instructor.totalHours}h
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-gray-50 font-semibold">
                          <TableCell className="text-gray-900">Total</TableCell>
                          <TableCell className="text-right text-blue-700">{summaryData?.instructorHours.totalTheory}h</TableCell>
                          <TableCell className="text-right text-green-700">{summaryData?.instructorHours.totalDriving}h</TableCell>
                          <TableCell className="text-right text-[#111111]">{summaryData?.instructorHours.total}h</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="completion" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm hover:shadow-2xl transition-all duration-300">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-600 mb-1">Total Students Started</p>
                      <p className="text-3xl font-bold bg-gradient-to-r from-[#ECC462] to-amber-600 bg-clip-text text-transparent">
                        {totalStudentsStarted}
                      </p>
                    </div>
                    <div className="w-14 h-14 bg-gradient-to-br from-[#ECC462] to-amber-500 rounded-2xl flex items-center justify-center shadow-lg">
                      <Users className="text-white h-7 w-7" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm hover:shadow-2xl transition-all duration-300">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-600 mb-1">Total Students Completed</p>
                      <p className="text-3xl font-bold bg-gradient-to-r from-amber-600 to-yellow-700 bg-clip-text text-transparent">
                        {totalStudentsCompleted}
                      </p>
                    </div>
                    <div className="w-14 h-14 bg-gradient-to-br from-amber-600 to-yellow-700 rounded-2xl flex items-center justify-center shadow-lg">
                      <GraduationCap className="text-white h-7 w-7" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm hover:shadow-2xl transition-all duration-300">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-600 mb-1">Overall Completion Rate</p>
                      <p className="text-3xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
                        {overallCompletionRate}%
                      </p>
                    </div>
                    <div className="w-14 h-14 bg-gradient-to-br from-[#111111] to-gray-800 rounded-2xl flex items-center justify-center shadow-lg">
                      <TrendingUp className="text-white h-7 w-7" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
              <CardHeader className="bg-gradient-to-r from-amber-50 to-yellow-50 border-b border-amber-100">
                <CardTitle className="text-xl font-semibold text-gray-800">Filters</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Enrollment Year</Label>
                    <Select value={enrollmentYearFilter} onValueChange={setEnrollmentYearFilter}>
                      <SelectTrigger data-testid="select-enrollment-year">
                        <SelectValue placeholder="All years" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Enrollment Years</SelectItem>
                        {enrollmentYears.map(year => (
                          <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Completion Year</Label>
                    <Select value={completionYearFilter} onValueChange={setCompletionYearFilter}>
                      <SelectTrigger data-testid="select-completion-year">
                        <SelectValue placeholder="All years" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Completion Years</SelectItem>
                        {completionYears.map(year => (
                          <SelectItem key={year} value={year!.toString()}>{year}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
              <CardHeader className="bg-gradient-to-r from-amber-50 to-yellow-50 border-b border-amber-100">
                <CardTitle className="text-xl font-semibold text-gray-800">Completion Trends by Year and Course Type</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {completionLoading ? (
                  <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#ECC462] mx-auto"></div>
                  </div>
                ) : completionData.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <TrendingUp className="h-16 w-16 mx-auto text-gray-300 mb-4" />
                    <p className="text-lg font-medium">No data available</p>
                    <p className="text-sm">No completion data available for the selected filters.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-gray-200">
                          <TableHead className="font-semibold text-gray-700">Enrollment Year</TableHead>
                          <TableHead className="font-semibold text-gray-700">Completion Year</TableHead>
                          <TableHead className="font-semibold text-gray-700">Course Type</TableHead>
                          <TableHead className="text-right font-semibold text-gray-700">Started</TableHead>
                          <TableHead className="text-right font-semibold text-gray-700">Completed</TableHead>
                          <TableHead className="text-right font-semibold text-gray-700">Rate</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {completionData.map((item, index) => (
                          <TableRow 
                            key={index}
                            className="border-gray-100 hover:bg-gradient-to-r hover:from-amber-50 hover:to-yellow-50 transition-all duration-200"
                          >
                            <TableCell className="font-medium text-gray-900">{item.enrollmentYear}</TableCell>
                            <TableCell>
                              {item.completionYear ? (
                                <span className="font-medium">{item.completionYear}</span>
                              ) : (
                                <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                                  In Progress
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge className="capitalize bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111]">
                                {item.courseType}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-medium text-gray-900">{item.studentsStarted}</TableCell>
                            <TableCell className="text-right font-medium text-gray-900">{item.studentsCompleted}</TableCell>
                            <TableCell className="text-right">
                              <Badge variant={getCompletionRateBadgeVariant(item.completionRate)}>
                                {item.completionRate}%
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
