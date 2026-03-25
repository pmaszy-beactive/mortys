import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Search, Eye, Edit, Trash2, User, Phone, Mail, MapPin, Award, Filter, Clock, Calendar, BarChart3, Car, Timer, BookOpen, AlertTriangle, TrendingUp, Sparkles, UserCheck } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import InstructorForm from "@/components/instructor-form";
import type { Instructor, Vehicle, Class, Evaluation } from "@shared/schema";

export default function Instructors() {
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [specializationFilter, setSpecializationFilter] = useState("all");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingInstructor, setEditingInstructor] = useState<Instructor | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const { toast } = useToast();

  const { data: instructors = [], isLoading } = useQuery<Instructor[]>({
    queryKey: ["/api/instructors"],
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
  });

  const { data: vehicles = [] } = useQuery<Vehicle[]>({
    queryKey: ["/api/vehicles"],
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

  const deleteInstructorMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/instructors/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/instructors"] });
      toast({
        title: "Success",
        description: "Instructor deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete instructor",
        variant: "destructive",
      });
    },
  });

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

  const hasSpecialization = (instructor: Instructor, courseType: string) => {
    const specs = parseSpecializations(instructor.specializations);
    return specs[courseType]?.theory || specs[courseType]?.practical;
  };

  // Helper function to get vehicle info for instructor
  const getInstructorVehicle = (instructor: Instructor) => {
    if (!instructor.vehicleId) return null;
    return vehicles.find(v => v.id === instructor.vehicleId);
  };

  const filteredInstructors = instructors.filter((instructor) => {
    const matchesSearch = searchTerm === "" || 
      `${instructor.firstName} ${instructor.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
      instructor.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (instructor.phone && instructor.phone.includes(searchTerm));

    const matchesLocation = locationFilter === "all" || instructor.locationAssignment === locationFilter;
    const matchesStatus = statusFilter === "all" || instructor.status === statusFilter;
    
    const matchesSpecialization = specializationFilter === "all" || 
      hasSpecialization(instructor, specializationFilter);
    
    return matchesSearch && matchesLocation && matchesStatus && matchesSpecialization;
  });

  const handleDeleteInstructor = (id: number) => {
    if (confirm("Are you sure you want to delete this instructor?")) {
      deleteInstructorMutation.mutate(id);
    }
  };

  const resetFilters = () => {
    setSearchTerm("");
    setLocationFilter("all");
    setStatusFilter("all");
    setSpecializationFilter("all");
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

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
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

          <div className="stat-card">
            <div className="flex items-start justify-between mb-4">
              <div className="text-gray-500">
                <Filter className="h-5 w-5" />
              </div>
              <Badge variant="outline" className="text-xs font-normal">
                Results
              </Badge>
            </div>
            <div>
              <p className="text-gray-600 text-xs font-medium uppercase tracking-wider mb-1">Filtered Results</p>
              <p className="text-3xl font-bold text-gray-900">{filteredInstructors.length}</p>
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

        {/* Search and Filters */}
        <Card className="mb-8 bg-white border border-gray-200 rounded-md shadow-sm">
          <CardHeader className="border-b bg-white pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold text-gray-900 flex items-center">
                  <Search className="mr-2 h-5 w-5 text-[#ECC462]" />
                  Search & Filter Instructors
                </CardTitle>
                <CardDescription className="text-gray-500">Find instructors by name, location, status, or specialization</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search instructors..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by location" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {uniqueLocations.map((location) => (
                    <SelectItem key={location || 'no-location'} value={location || 'no-location'}>
                      {location || 'No Location'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>

              <Select value={specializationFilter} onValueChange={setSpecializationFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by specialization" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Specializations</SelectItem>
                  <SelectItem value="auto">Automobile</SelectItem>
                  <SelectItem value="moto">Motorcycle</SelectItem>
                  <SelectItem value="scooter">Scooter</SelectItem>
                </SelectContent>
              </Select>

              <Button 
                variant="outline" 
                onClick={resetFilters}
              >
                Clear Filters
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Instructors Table */}
        <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
          <CardHeader className="border-b bg-white pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold text-gray-900">
                  Instructor Directory
                </CardTitle>
                <CardDescription className="text-gray-500">Complete list of all instructors and their details</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="font-bold text-gray-900">Instructor</TableHead>
                    <TableHead className="font-bold text-gray-900">Contact</TableHead>
                    <TableHead className="font-bold text-gray-900">Vehicle</TableHead>
                    <TableHead className="font-bold text-gray-900">Specializations</TableHead>
                    <TableHead className="font-bold text-gray-900">License & Location</TableHead>
                    <TableHead className="font-bold text-gray-900">Status</TableHead>
                    <TableHead className="font-bold text-gray-900">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInstructors.map((instructor) => (
                    <TableRow 
                      key={instructor.id} 
                      className="hover:bg-gray-50 cursor-pointer transition-colors duration-150"
                      onClick={() => setLocation(`/instructors/${instructor.id}`)}
                    >
                      <TableCell>
                        <div className="flex items-center">
                          <div className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center border border-gray-200">
                            <span className="text-gray-700 font-bold text-xs">
                              {instructor.firstName.charAt(0)}{instructor.lastName.charAt(0)}
                            </span>
                          </div>
                          <div className="ml-3">
                            <div className="text-sm font-semibold text-gray-900">{instructor.firstName} {instructor.lastName}</div>
                            <div className="text-xs text-gray-500">ID: #{instructor.id}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs space-y-1">
                          <div className="flex items-center text-gray-600">
                            <Mail className="h-3 w-3 mr-1.5" />
                            {instructor.email}
                          </div>
                          <div className="flex items-center text-gray-600">
                            <Phone className="h-3 w-3 mr-1.5" />
                            {instructor.phone}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {getInstructorVehicle(instructor) ? (
                          <div className="text-xs">
                            <div className="flex items-center font-medium text-gray-900">
                              <Car className="h-3 w-3 mr-1.5 text-gray-400" />
                              {getInstructorVehicle(instructor)?.make} {getInstructorVehicle(instructor)?.model}
                            </div>
                            <div className="text-gray-500 ml-4.5">{getInstructorVehicle(instructor)?.plateNumber}</div>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">No vehicle assigned</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {formatSpecializationBadges(instructor.specializations).map((spec, index) => (
                            <Badge key={index} variant="outline" className="text-[10px] px-1.5 py-0">
                              {spec.courseType.toUpperCase()}: {spec.types}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs space-y-1">
                          <div className="flex items-center text-gray-600">
                            <Award className="h-3 w-3 mr-1.5 text-gray-400" />
                            {instructor.licenseNumber}
                          </div>
                          <div className="flex items-center text-gray-600">
                            <MapPin className="h-3 w-3 mr-1.5 text-gray-400" />
                            {instructor.locationAssignment}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={instructor.status === 'active' ? "bg-green-100 text-green-700 border-green-200" : "bg-gray-100 text-gray-700"}>
                          {instructor.status}
                        </Badge>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <Button 
                            variant="ghost" 
                            size="icon"
                            className="h-8 w-8 text-gray-500 hover:text-gray-900"
                            onClick={() => setLocation(`/instructors/${instructor.id}`)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="icon"
                                className="h-8 w-8 text-gray-500 hover:text-gray-900"
                                onClick={() => setEditingInstructor(instructor)}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                              <DialogHeader>
                                <DialogTitle>Edit Instructor</DialogTitle>
                                <DialogDescription>
                                  Update instructor profile information and specializations.
                                </DialogDescription>
                              </DialogHeader>
                              <InstructorForm 
                                instructor={editingInstructor} 
                                onSuccess={() => {
                                  setEditingInstructor(null);
                                  // The form component handles success, but we need to close our dialog
                                  const closeButton = document.querySelector('[data-radix-collection-item]') as HTMLButtonElement;
                                  closeButton?.click();
                                }} 
                              />
                            </DialogContent>
                          </Dialog>
                          <Button 
                            variant="ghost" 
                            size="icon"
                            className="h-8 w-8 text-gray-400 hover:text-red-600"
                            onClick={() => handleDeleteInstructor(instructor.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredInstructors.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center">
                        <div className="flex flex-col items-center justify-center text-gray-500">
                          <User className="h-8 w-8 mb-2 opacity-20" />
                          <p>No instructors found matching your criteria</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
