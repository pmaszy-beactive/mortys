import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar, Clock, DollarSign, TrendingUp, FileText, AlertCircle, GraduationCap, Car, RefreshCw, UserX } from "lucide-react";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays, parse } from "date-fns";

interface HoursData {
  summary: {
    totalHours: number;
    completedLessons: number;
    noShows: number;
    totalClasses: number;
    // Class type breakdown
    theoryHours: number;
    theoryClasses: number;
    drivingHours: number;
    drivingClasses: number;
    oneOffHours: number;
    oneOffClasses: number;
  };
  daily: Array<{
    date: string;
    totalHours: number;
    lessonCount: number;
    classes: any[];
  }>;
  weekly: Array<{
    weekStart: string;
    totalHours: number;
    lessonCount: number;
    classes: any[];
  }>;
  classes: any[];
  noShowStudents: Array<{
    studentId: number;
    firstName: string;
    lastName: string;
    email: string;
    classNumber: number;
    courseType: string;
    date: string;
    time: string;
    classId: number;
  }>;
}

type PeriodFilter = 'week' | 'month' | 'all';

export default function InstructorHours() {
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('month');

  // Calculate date range based on filter
  const getDateRange = () => {
    const today = new Date();
    switch (periodFilter) {
      case 'week':
        return {
          startDate: format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
          endDate: format(endOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd')
        };
      case 'month':
        return {
          startDate: format(startOfMonth(today), 'yyyy-MM-dd'),
          endDate: format(endOfMonth(today), 'yyyy-MM-dd')
        };
      case 'all':
      default:
        return {
          startDate: format(subDays(today, 365), 'yyyy-MM-dd'),
          endDate: format(today, 'yyyy-MM-dd')
        };
    }
  };

  const { startDate, endDate } = getDateRange();

  const { data: hoursData, isLoading } = useQuery<HoursData>({
    queryKey: ["/api/instructor/hours", startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams({ startDate, endDate });
      const response = await fetch(`/api/instructor/hours?${params}`, {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch hours data');
      }
      return response.json();
    }
  });

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8 bg-gray-50 min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-[#ECC462] mx-auto mb-4"></div>
          <p className="text-gray-700 font-medium">Loading hours data...</p>
        </div>
      </div>
    );
  }

  const { summary, daily, weekly, noShowStudents } = hoursData || { 
    summary: { 
      totalHours: 0, completedLessons: 0, noShows: 0, totalClasses: 0,
      theoryHours: 0, theoryClasses: 0, drivingHours: 0, drivingClasses: 0, oneOffHours: 0, oneOffClasses: 0
    }, 
    daily: [], 
    weekly: [],
    noShowStudents: []
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8 min-h-screen bg-gray-50">
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
              Hours & Payroll
            </h1>
            <p className="mt-1 text-sm sm:text-base text-gray-600">
              Track your worked hours, completed lessons, and attendance for payroll
            </p>
          </div>

          {/* Period Filter */}
          <div className="flex gap-2">
            <Button
              variant={periodFilter === 'week' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPeriodFilter('week')}
              className={periodFilter === 'week' ? 'bg-[#ECC462] hover:bg-[#d4af56] text-[#111111] rounded-md shadow-sm' : 'rounded-md'}
              data-testid="filter-week"
            >
              This Week
            </Button>
            <Button
              variant={periodFilter === 'month' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPeriodFilter('month')}
              className={periodFilter === 'month' ? 'bg-[#ECC462] hover:bg-[#d4af56] text-[#111111] rounded-md shadow-sm' : 'rounded-md'}
              data-testid="filter-month"
            >
              This Month
            </Button>
            <Button
              variant={periodFilter === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPeriodFilter('all')}
              className={periodFilter === 'all' ? 'bg-[#ECC462] hover:bg-[#d4af56] text-[#111111] rounded-md shadow-sm' : 'rounded-md'}
              data-testid="filter-all"
            >
              All Time
            </Button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="stat-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Total Hours</p>
              <p className="text-3xl font-bold text-gray-900" data-testid="text-total-hours">
                {summary.totalHours.toFixed(1)}
              </p>
            </div>
            <div className="bg-gray-100 rounded-md p-3">
              <Clock className="h-8 w-8 text-gray-600" />
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Completed Lessons</p>
              <p className="text-3xl font-bold text-gray-900" data-testid="text-completed-lessons">
                {summary.completedLessons}
              </p>
            </div>
            <div className="bg-gray-100 rounded-md p-3">
              <TrendingUp className="h-8 w-8 text-gray-600" />
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">No-Shows</p>
              <p className="text-3xl font-bold text-gray-900" data-testid="text-no-shows">
                {summary.noShows}
              </p>
            </div>
            <div className="bg-gray-100 rounded-md p-3">
              <AlertCircle className="h-8 w-8 text-gray-600" />
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Completion Rate</p>
              <p className="text-3xl font-bold text-gray-900" data-testid="text-completion-rate">
                {summary.totalClasses > 0 
                  ? Math.round((summary.completedLessons / summary.totalClasses) * 100)
                  : 0}%
              </p>
            </div>
            <div className="bg-gray-100 rounded-md p-3">
              <FileText className="h-8 w-8 text-gray-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Class Type Breakdown */}
      <Card className="mb-8 border border-gray-200 rounded-md shadow-sm bg-white overflow-hidden">
        <CardHeader className="bg-gray-50 border-b">
          <CardTitle className="flex items-center text-gray-900 text-xl font-semibold">
            <FileText className="mr-2 h-5 w-5 text-gray-600" />
            Hours by Class Type
          </CardTitle>
          <CardDescription className="text-gray-500">Breakdown of your teaching hours by class category</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Theory Classes */}
            <div className="p-5 rounded-md bg-blue-50 border border-blue-100">
              <div className="flex items-center gap-3 mb-3">
                <div className="bg-blue-100 rounded-md p-2.5">
                  <GraduationCap className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-blue-900">Theory Classes</h3>
                  <p className="text-xs text-blue-600">Classes 1-5</p>
                </div>
              </div>
              <div className="flex justify-between items-end">
                <div>
                  <p className="text-2xl font-bold text-blue-700" data-testid="text-theory-hours">
                    {(summary.theoryHours || 0).toFixed(1)}
                  </p>
                  <p className="text-xs text-blue-600 uppercase tracking-wider font-medium">hours</p>
                </div>
                <Badge className="bg-blue-100 text-blue-800 border-blue-200 rounded-md" data-testid="text-theory-classes">
                  {summary.theoryClasses || 0} classes
                </Badge>
              </div>
            </div>

            {/* Regular Driving Classes */}
            <div className="p-5 rounded-md bg-green-50 border border-green-100">
              <div className="flex items-center gap-3 mb-3">
                <div className="bg-green-100 rounded-md p-2.5">
                  <Car className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-green-900">Driving Classes</h3>
                  <p className="text-xs text-green-600">Regular course lessons</p>
                </div>
              </div>
              <div className="flex justify-between items-end">
                <div>
                  <p className="text-2xl font-bold text-green-700" data-testid="text-driving-hours">
                    {(summary.drivingHours || 0).toFixed(1)}
                  </p>
                  <p className="text-xs text-green-600 uppercase tracking-wider font-medium">hours</p>
                </div>
                <Badge className="bg-green-100 text-green-800 border-green-200 rounded-md" data-testid="text-driving-classes">
                  {summary.drivingClasses || 0} classes
                </Badge>
              </div>
            </div>

            {/* One-Off / Refresher Classes */}
            <div className="p-5 rounded-md bg-purple-50 border border-purple-100">
              <div className="flex items-center gap-3 mb-3">
                <div className="bg-purple-100 rounded-md p-2.5">
                  <RefreshCw className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-purple-900">Refresher Lessons</h3>
                  <p className="text-xs text-purple-600">One-off / non-regular students</p>
                </div>
              </div>
              <div className="flex justify-between items-end">
                <div>
                  <p className="text-2xl font-bold text-purple-700" data-testid="text-oneoff-hours">
                    {(summary.oneOffHours || 0).toFixed(1)}
                  </p>
                  <p className="text-xs text-purple-600 uppercase tracking-wider font-medium">hours</p>
                </div>
                <Badge className="bg-purple-100 text-purple-800 border-purple-200 rounded-md" data-testid="text-oneoff-classes">
                  {summary.oneOffClasses || 0} classes
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* No-Show Students */}
      {noShowStudents.length > 0 && (
        <Card className="mb-8 border border-gray-200 rounded-md shadow-sm bg-white overflow-hidden">
          <CardHeader className="bg-red-50 border-b">
            <CardTitle className="flex items-center text-gray-900 text-xl font-semibold">
              <UserX className="mr-2 h-5 w-5 text-red-500" />
              No-Show Students
            </CardTitle>
            <CardDescription className="text-gray-500">Students who did not show up for their scheduled classes</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Date & Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {noShowStudents.map((ns, idx) => (
                    <TableRow key={`${ns.studentId}-${ns.classId}-${idx}`} className="hover:bg-gray-50 transition-colors">
                      <TableCell>
                        <div>
                          <p className="font-medium text-gray-900">{ns.firstName} {ns.lastName}</p>
                          <p className="text-sm text-gray-500">{ns.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="rounded-md">
                            {ns.courseType?.toUpperCase()}
                          </Badge>
                          <span className="text-sm text-gray-700">Class {ns.classNumber}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <p className="font-medium text-gray-900">
                            {format(parse(ns.date, 'yyyy-MM-dd', new Date()), 'MMM d, yyyy')}
                          </p>
                          <p className="text-gray-500">{ns.time.slice(0, 5)}</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Weekly Breakdown */}
      <Card className="mb-8 border border-gray-200 rounded-md shadow-sm bg-white overflow-hidden">
        <CardHeader className="bg-gray-50 border-b">
          <CardTitle className="flex items-center text-gray-900 text-xl font-semibold">
            <Calendar className="mr-2 h-5 w-5 text-gray-600" />
            Weekly Breakdown
          </CardTitle>
          <CardDescription className="text-gray-500">Hours worked per week</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {weekly.length > 0 ? (
            <div className="space-y-4">
              {weekly.map((week, index) => (
                <div
                  key={week.weekStart}
                  className="flex items-center justify-between p-4 rounded-md border border-gray-200 hover:border-[#ECC462] hover:bg-gray-50 transition-all"
                  data-testid={`week-${index}`}
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-gray-100 rounded-md p-3">
                      <Calendar className="h-5 w-5 text-gray-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">
                        Week of {format(new Date(week.weekStart), 'MMM d, yyyy')}
                      </p>
                      <p className="text-sm text-gray-500">
                        {week.lessonCount} lesson{week.lessonCount !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-gray-900">
                      {week.totalHours.toFixed(1)}
                    </p>
                    <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">hours</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Calendar className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No hours logged for this period</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Daily Breakdown */}
      <Card className="border border-gray-200 rounded-md shadow-sm bg-white overflow-hidden">
        <CardHeader className="bg-gray-50 border-b">
          <CardTitle className="flex items-center text-gray-900 text-xl font-semibold">
            <Clock className="mr-2 h-5 w-5 text-gray-600" />
            Daily Breakdown
          </CardTitle>
          <CardDescription className="text-gray-500">Detailed hours per day</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {daily.length > 0 ? (
            <div className="space-y-3">
              {daily.map((day, index) => (
                <div
                  key={day.date}
                  className="flex items-center justify-between p-4 rounded-md bg-gray-50 hover:bg-gray-100 transition-colors"
                  data-testid={`day-${index}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-[#ECC462]"></div>
                    <div>
                      <p className="font-medium text-gray-900">
                        {format(new Date(day.date), 'EEEE, MMM d, yyyy')}
                      </p>
                      <p className="text-sm text-gray-500">
                        {day.lessonCount} lesson{day.lessonCount !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <Badge className="bg-gray-200 text-gray-900 hover:bg-gray-300 rounded-md">
                    {day.totalHours.toFixed(1)} hrs
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Clock className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No hours logged for this period</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
