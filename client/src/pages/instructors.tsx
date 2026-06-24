import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, User, MapPin, Award, Clock, Calendar, BarChart3, Car, Timer, BookOpen, AlertTriangle, TrendingUp, UserCheck } from "lucide-react";
import InstructorForm from "@/components/instructor-form";
import type { Instructor, Class, Evaluation } from "@shared/schema";

export default function Instructors() {
  const [, setLocation] = useLocation();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const { data: instructors = [], isLoading } = useQuery<Instructor[]>({
    queryKey: ["/api/instructors"],
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
  });

  const { data: classes = [] } = useQuery<Class[]>({
    queryKey: ["/api/classes"],
  });

  const { data: evaluations = [] } = useQuery<Evaluation[]>({
    queryKey: ["/api/evaluations"],
  });

  // Calculate instructor hours for different time periods
  const calculateInstructorHours = (timeframe: 'day' | 'week' | 'month' | 'year' = 'month') => {
    const now = new Date();
    const startDate = new Date();
    
    switch (timeframe) {
      case 'day':
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'week':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(now.getMonth() - 1);
        break;
      case 'year':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
    }

    return instructors.map(instructor => {
      // Get driving hours from evaluations (in-car sessions)
      const drivingEvaluations = evaluations.filter(e => 
        e.instructorId === instructor.id &&
        e.sessionType === 'in-car' &&
        new Date(e.evaluationDate) >= startDate &&
        e.duration
      );
      const drivingHours = drivingEvaluations.reduce((sum, e) => sum + (e.duration || 0), 0) / 60;

      // Get theory hours from classes
      const theoryClasses = classes.filter(c => 
        c.instructorId === instructor.id &&
        new Date(c.date) >= startDate &&
        c.duration
      );
      const theoryHours = theoryClasses.reduce((sum, c) => sum + (c.duration || 0), 0) / 60;

      // Calculate no-shows: classes that are past their scheduled time but still marked as "scheduled" or "cancelled"
      const now = new Date();
      const instructorClasses = classes.filter(c => 
        c.instructorId === instructor.id &&
        new Date(c.date) >= startDate
      );
      
      const noShows = instructorClasses.filter(c => {
        const classDateTime = new Date(`${c.date}T${c.time}`);
        return (classDateTime < now && c.status === 'scheduled') || c.status === 'cancelled';
      }).length;

      const totalHours = drivingHours + theoryHours;

      return {
        ...instructor,
        drivingHours: Math.round(drivingHours * 10) / 10,
        theoryHours: Math.round(theoryHours * 10) / 10,
        totalHours: Math.round(totalHours * 10) / 10,
        drivingSessions: drivingEvaluations.length,
        theorySessions: theoryClasses.length,
        noShows: noShows,
      };
    }).sort((a, b) => b.totalHours - a.totalHours);
  };

  const monthlyHours = calculateInstructorHours('month');
  const weeklyHours = calculateInstructorHours('week');
  const dailyHours = calculateInstructorHours('day');
  const yearlyHours = calculateInstructorHours('year');

  const parseSpecializations = (specializations: any) => {
    if (typeof specializations === 'string') {
      try {
        return JSON.parse(specializations);
      } catch {
        return {};
      }
    }
    return specializations || {};
  };

  const formatSpecializationBadges = (specializations: any) => {
    const specs = parseSpecializations(specializations);
    const badges = [];
    
    for (const [courseType, abilities] of Object.entries(specs)) {
      if (typeof abilities === 'object' && abilities !== null) {
        const { theory, practical } = abilities as { theory?: boolean; practical?: boolean };
        if (theory || practical) {
          const types = [];
          if (theory) types.push('T');
          if (practical) types.push('D');
          badges.push({
            courseType,
            types: types.join('/'),
          });
        }
      }
    }
    
    return badges;
  };

  // Get unique locations from instructors
  const uniqueLocations = Array.from(new Set(
    instructors.map(instructor => instructor.locationAssignment).filter(Boolean)
  ));

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="p-4 sm:p-6 lg:p-8">
          <div className="animate-pulse space-y-8">
            <div className="h-12 bg-gray-200 rounded-md w-1/3"></div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-40 bg-white border border-gray-200 rounded-md"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="mb-10">
          <div className="flex justify-between items-center">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <h1 className="text-xl font-semibold text-gray-900">
                  Instructors
                </h1>
                <UserCheck className="h-6 w-6 text-[#ECC462]" />
              </div>
              <p className="text-sm text-gray-600">
                Manage instructor profiles, specializations, and assignments.
              </p>
            </div>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-[#ECC462] hover:bg-[#ECC462]/90 text-[#111111] font-semibold">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Instructor
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Add New Instructor</DialogTitle>
                  <DialogDescription>
                    Create a new instructor profile with their credentials and specializations.
                  </DialogDescription>
                </DialogHeader>
                <InstructorForm onSuccess={() => setIsCreateDialogOpen(false)} />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Instructor Selector */}
        <Card className="mb-10 bg-white border border-gray-200 rounded-md shadow-sm">
          <CardHeader className="border-b bg-white pb-4">
            <CardTitle className="text-base font-semibold text-gray-900 flex items-center">
              <UserCheck className="mr-2 h-5 w-5 text-[#ECC462]" />
              Select an Instructor
            </CardTitle>
            <CardDescription className="text-gray-500">Choose an instructor to view their profile</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <Select onValueChange={(value) => setLocation(`/instructors/${value}`)}>
              <SelectTrigger className="w-full md:w-96" data-testid="select-instructor">
                <SelectValue placeholder="Select an instructor..." />
              </SelectTrigger>
              <SelectContent>
                {instructors.map((instructor) => (
                  <SelectItem
                    key={instructor.id}
                    value={String(instructor.id)}
                    data-testid={`option-instructor-${instructor.id}`}
                  >
                    {instructor.firstName} {instructor.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <div className="stat-card">
            <div className="flex items-start justify-between mb-4">
              <div className="text-gray-500">
                <User className="h-5 w-5" />
              </div>
              <Badge variant="outline" className="text-xs font-normal">
                Total
              </Badge>
            </div>
            <div>
              <p className="text-gray-600 text-xs font-medium uppercase tracking-wider mb-1">Total Instructors</p>
              <p className="text-3xl font-bold text-gray-900">{instructors.length}</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-start justify-between mb-4">
              <div className="text-gray-500">
                <Award className="h-5 w-5" />
              </div>
              <Badge variant="outline" className="text-xs font-normal text-green-600 border-green-200 bg-green-50">
                Active
              </Badge>
            </div>
            <div>
              <p className="text-gray-600 text-xs font-medium uppercase tracking-wider mb-1">Active</p>
              <p className="text-3xl font-bold text-gray-900">
                {instructors.filter(i => i.status === 'active').length}
              </p>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-start justify-between mb-4">
              <div className="text-gray-500">
                <MapPin className="h-5 w-5" />
              </div>
              <Badge variant="outline" className="text-xs font-normal">
                Locations
              </Badge>
            </div>
            <div>
              <p className="text-gray-600 text-xs font-medium uppercase tracking-wider mb-1">Locations</p>
              <p className="text-3xl font-bold text-gray-900">{uniqueLocations.length}</p>
            </div>
          </div>

        </div>

        {/* Instructor Hours Reporting */}
        <Card className="mb-8 bg-white border border-gray-200 rounded-md shadow-sm overflow-hidden">
          <CardHeader className="border-b bg-white pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg font-semibold text-gray-900 flex items-center">
                  <Timer className="mr-2 h-5 w-5 text-[#ECC462]" />
                  Instructor Hours Report
                </CardTitle>
                <CardDescription className="text-gray-500">Track teaching hours across all instructors</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div className="stat-card">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-gray-500">
                    <Clock className="h-5 w-5" />
                  </div>
                  <Badge variant="secondary" className="text-[10px] uppercase font-bold px-2">Today</Badge>
                </div>
                <p className="text-gray-600 text-xs font-medium uppercase tracking-wider mb-1">Today's Hours</p>
                <p className="text-2xl font-bold text-gray-900">
                  {dailyHours.reduce((sum, i) => sum + i.totalHours, 0).toFixed(1)}h
                </p>
              </div>
              
              <div className="stat-card">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-gray-500">
                    <Calendar className="h-5 w-5" />
                  </div>
                  <Badge variant="secondary" className="text-[10px] uppercase font-bold px-2">Week</Badge>
                </div>
                <p className="text-gray-600 text-xs font-medium uppercase tracking-wider mb-1">This Week</p>
                <p className="text-2xl font-bold text-gray-900">
                  {weeklyHours.reduce((sum, i) => sum + i.totalHours, 0).toFixed(1)}h
                </p>
              </div>
              
              <div className="stat-card">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-gray-500">
                    <BarChart3 className="h-5 w-5" />
                  </div>
                  <Badge variant="secondary" className="text-[10px] uppercase font-bold px-2">Month</Badge>
                </div>
                <p className="text-gray-600 text-xs font-medium uppercase tracking-wider mb-1">This Month</p>
                <p className="text-2xl font-bold text-gray-900">
                  {monthlyHours.reduce((sum, i) => sum + i.totalHours, 0).toFixed(1)}h
                </p>
              </div>
              
              <div className="stat-card">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-gray-500">
                    <TrendingUp className="h-5 w-5" />
                  </div>
                  <Badge variant="secondary" className="text-[10px] uppercase font-bold px-2">Year</Badge>
                </div>
                <p className="text-gray-600 text-xs font-medium uppercase tracking-wider mb-1">This Year</p>
                <p className="text-2xl font-bold text-gray-900">
                  {yearlyHours.reduce((sum, i) => sum + i.totalHours, 0).toFixed(1)}h
                </p>
              </div>
            </div>

            {/* Monthly Hours Detail Table */}
            <div className="mt-8">
              <h3 className="text-base font-semibold text-gray-900 mb-4">Monthly Hours Breakdown</h3>
              <div className="overflow-x-auto border border-gray-200 rounded-md shadow-sm">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-bold text-gray-900 uppercase tracking-wider">
                        Instructor
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-bold text-gray-900 uppercase tracking-wider">
                        <div className="flex items-center">
                          <Car className="h-3.5 w-3.5 mr-2" />
                          Driving Hours
                        </div>
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-bold text-gray-900 uppercase tracking-wider">
                        <div className="flex items-center">
                          <BookOpen className="h-3.5 w-3.5 mr-2" />
                          Theory Hours
                        </div>
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-bold text-gray-900 uppercase tracking-wider">
                        Total Hours
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-bold text-gray-900 uppercase tracking-wider">
                        <div className="flex items-center">
                          <AlertTriangle className="h-3.5 w-3.5 mr-2" />
                          No-Shows
                        </div>
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-bold text-gray-900 uppercase tracking-wider">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {monthlyHours.map((instructor) => (
                      <tr
                        key={instructor.id}
                        className="hover:bg-gray-50 transition-colors duration-150 cursor-pointer"
                        onClick={() => setLocation(`/instructors/${instructor.id}`)}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-semibold text-gray-900">
                            {instructor.firstName} {instructor.lastName}
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {formatSpecializationBadges(instructor.specializations).map((spec, index) => (
                              <Badge key={index} variant="outline" className="text-[10px] px-1.5 py-0">
                                {spec.courseType.toUpperCase()}: {spec.types}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {instructor.drivingHours}h
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {instructor.theoryHours}h
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">
                          {instructor.totalHours}h
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <Badge variant={instructor.noShows > 2 ? "destructive" : "secondary"} className="text-[10px]">
                            {instructor.noShows} sessions
                          </Badge>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <Badge className={instructor.status === 'active' ? "bg-green-100 text-green-700 border-green-200" : "bg-gray-100 text-gray-700"}>
                            {instructor.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
