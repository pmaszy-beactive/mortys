import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Edit, Phone, Mail, MapPin, Calendar, FileText, Users, Clock, Award, AlertTriangle, Car, CheckCircle2, GraduationCap, Star, TrendingUp, BarChart3, Eye } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import InstructorForm from "@/components/instructor-form";
import InstructorAvailability from "@/components/instructor-availability";
import type { Instructor, Class, Evaluation, Student, Vehicle } from "@shared/schema";

export default function InstructorProfile() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const [editingInstructor, setEditingInstructor] = useState<Instructor | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: instructor, isLoading } = useQuery<Instructor>({
    queryKey: [`/api/instructors/${id}`],
    enabled: !!id,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
  });

  const { data: classes = [] } = useQuery<Class[]>({
    queryKey: [`/api/classes`],
    select: (data) => data.filter(c => c.instructorId === parseInt(id!)),
    enabled: !!id,
  });

  const { data: evaluations = [] } = useQuery<Evaluation[]>({
    queryKey: [`/api/evaluations`],
    select: (data) => data.filter(e => e.instructorId === parseInt(id!)),
    enabled: !!id,
  });

  const { data: students = [] } = useQuery<Student[]>({
    queryKey: [`/api/students`],
    select: (data: any) => data.students || [],
    enabled: !!id,
  });

  const { data: vehicles = [], isLoading: vehiclesLoading, isError: vehiclesError } = useQuery<Vehicle[]>({
    queryKey: ["/api/vehicles"],
  });

  const impersonateMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/impersonate/instructor/${id}`),
    onSuccess: () => {
      setLocation("/instructor/schedule");
    },
    onError: () => {
      toast({ title: "Error", description: "Could not open instructor portal view.", variant: "destructive" });
    },
  });

  const deleteInstructorMutation = useMutation({
    mutationFn: (instructorId: number) => apiRequest("DELETE", `/api/instructors/${instructorId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/instructors"] });
      toast({
        title: "Success",
        description: "Instructor deleted successfully",
      });
      setLocation("/instructors");
    },
    onError: () => {
      toast({
        title: "Error", 
        description: "Failed to delete instructor",
        variant: "destructive",
      });
    },
  });

  const updateVehicleMutation = useMutation({
    mutationFn: ({ instructorId, vehicleId }: { instructorId: number, vehicleId: number | null }) => 
    apiRequest("PUT", `/api/instructors/${instructorId}`, { vehicleId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/instructors/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/instructors"] });
      toast({
        title: "Success",
        description: "Vehicle assignment updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update vehicle assignment",
        variant: "destructive",
      });
    },
  });

  const handleDeleteInstructor = () => {
    if (confirm("Are you sure you want to delete this instructor? This action cannot be undone.")) {
      deleteInstructorMutation.mutate(parseInt(id!));
    }
  };

  const handleVehicleChange = (vehicleId: string) => {
    const newVehicleId = vehicleId === "unassigned" ? null : parseInt(vehicleId);
    updateVehicleMutation.mutate({ 
      instructorId: parseInt(id!), 
      vehicleId: newVehicleId 
    });
  };

  const parseSpecializations = (specializations: any): { type: string; data: any } => {
    if (!specializations) {
      return { type: 'empty', data: {} };
    }
    
    if (typeof specializations === 'string') {
      const trimmed = specializations.trim();
      if (!trimmed) return { type: 'empty', data: {} };
      try {
        const parsed = JSON.parse(trimmed);
        return parseSpecializations(parsed);
      } catch {
        return { type: 'text', data: trimmed };
      }
    }
    
    if (Array.isArray(specializations)) {
      if (specializations.length === 0) return { type: 'empty', data: {} };
      const validCourseTypes = ['auto', 'moto', 'scooter'];
      const allCourseTypes = specializations.every((item: any) => 
        typeof item === 'string' && validCourseTypes.includes(item.toLowerCase())
      );
      if (allCourseTypes) {
        const structured: Record<string, { theory: boolean; practical: boolean }> = {};
        specializations.forEach((item: string) => {
          structured[item.toLowerCase()] = { theory: true, practical: true };
        });
        return { type: 'structured', data: structured };
      }
      return { type: 'text', data: specializations.join(', ') };
    }
    
    if (typeof specializations === 'object' && specializations !== null) {
      const keys = Object.keys(specializations);
      if (keys.length === 0) return { type: 'empty', data: {} };
      
      const hasStructuredFormat = keys.some(key => 
        typeof specializations[key] === 'object' && 
        (specializations[key]?.theory !== undefined || specializations[key]?.practical !== undefined)
      );
      if (hasStructuredFormat || keys.some((k: string) => ['auto', 'moto', 'scooter'].includes(k))) {
        return { type: 'structured', data: specializations };
      }
      return { type: 'text', data: Object.values(specializations).join(', ') };
    }
    
    return { type: 'empty', data: {} };
  };

  const parseSecondaryLocations = (locations: any) => {
    if (typeof locations === 'string') {
      try {
        return JSON.parse(locations);
      } catch {
        return [];
      }
    }
    return Array.isArray(locations) ? locations : [];
  };

  const getSpecializationColor = (courseType: string) => {
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
      case "inactive": return "bg-gray-100 text-gray-800 border border-gray-200";
      case "suspended": return "bg-red-100 text-red-800 border border-red-200";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const getCourseTypeLabel = (courseType: string) => {
    switch (courseType) {
      case "auto": return "Automobile";
      case "moto": return "Motorcycle";
      case "scooter": return "Scooter";
      default: return courseType;
    }
  };

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  };

  const calculateYearsOfService = (hireDate: string | null) => {
    if (!hireDate) return 0;
    const years = new Date().getFullYear() - new Date(hireDate).getFullYear();
    return Math.max(0, years);
  };

  if (isLoading) {
    return (
      <div className="space-y-8 pb-8 bg-gray-50 min-h-screen p-4 sm:p-6">
        <div className="h-64 bg-white border border-gray-200 rounded-md shadow-sm"></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="h-32 bg-white border border-gray-200 rounded-md shadow-sm"></div>
          <div className="h-32 bg-white border border-gray-200 rounded-md shadow-sm"></div>
          <div className="h-32 bg-white border border-gray-200 rounded-md shadow-sm"></div>
        </div>
      </div>
    );
  }

  if (!instructor) {
    return (
      <div className="text-center py-20">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gray-100 mb-6">
          <Users className="h-10 w-10 text-gray-400" />
        </div>
        <h2 className="text-3xl font-bold text-gray-900 mb-2">Instructor Not Found</h2>
        <p className="text-lg text-gray-600 mb-6">The instructor you're looking for doesn't exist.</p>
        <Button onClick={() => setLocation("/instructors")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Instructors
        </Button>
      </div>
    );
  }

  const specializationsData = parseSpecializations(instructor.specializations);
  const secondaryLocations = parseSecondaryLocations(instructor.secondaryLocations);
  const yearsOfService = calculateYearsOfService(instructor.hireDate);

  const currentVehicle = instructor.vehicleId ? vehicles.find(v => v.id === instructor.vehicleId) : null;
  const hasValidVehicleAssignment = instructor.vehicleId ? !!currentVehicle : true;
  const availableVehicles = vehicles.filter(vehicle => 
    vehicle.status === 'active' || vehicle.id === instructor.vehicleId
  );

  return (
    <div className="space-y-8 pb-8 bg-gray-50 min-h-screen p-4 sm:p-6">
      {/* Back Navigation */}
      <div className="flex items-center gap-4">
        <Button 
          variant="ghost" 
          onClick={() => setLocation("/instructors")}
          className="touch-target hover:bg-white"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Instructors
        </Button>
        <div className="h-6 w-px bg-gray-300" />
        <h1 className="text-xl font-semibold text-gray-900">Instructor Profile</h1>
      </div>

      {/* Header Card */}
      <Card className="bg-white border border-gray-200 rounded-md shadow-sm border-l-4 border-l-[#ECC462]">
        <CardHeader className="pb-6">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            <div className="h-24 w-24 rounded-md bg-gray-100 flex items-center justify-center text-2xl font-bold text-gray-400 border border-gray-200">
              {getInitials(instructor.firstName, instructor.lastName)}
            </div>

            <div className="flex-1 space-y-3">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 mb-2">
                  {instructor.firstName} {instructor.lastName}
                </h1>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className={getStatusColor(instructor.status)}>
                    {instructor.status.charAt(0).toUpperCase() + instructor.status.slice(1)}
                  </Badge>
                  {instructor.permitNumber && (
                    <Badge variant="outline" className="bg-white border-gray-200 text-gray-600">
                      <Award className="mr-1.5 h-3.5 w-3.5" />
                      Permit: {instructor.permitNumber}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                <div className="flex items-center gap-1.5">
                  <Mail className="h-4 w-4 text-gray-400" />
                  {instructor.email}
                </div>
                <div className="flex items-center gap-1.5">
                  <Phone className="h-4 w-4 text-gray-400" />
                  {instructor.phone}
                </div>
                {instructor.locationAssignment && (
                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4 text-gray-400" />
                    {instructor.locationAssignment}
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="bg-[#ECC462] text-[#111111] hover:bg-[#ECC462]/90 border-none font-semibold"
                onClick={() => impersonateMutation.mutate()}
                disabled={impersonateMutation.isPending || instructor?.status !== 'active' || instructor?.accountStatus !== 'active'}
              >
                <Eye className="mr-2 h-4 w-4" />
                View Portal
              </Button>
              <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="border-gray-200">
                    <Edit className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Edit Instructor Profile</DialogTitle>
                  </DialogHeader>
                  <InstructorForm 
                    instructor={instructor} 
                    onSuccess={() => setIsEditDialogOpen(false)} 
                  />
                </DialogContent>
              </Dialog>
              <Button 
                size="sm"
                variant="destructive" 
                onClick={handleDeleteInstructor}
                disabled={deleteInstructorMutation.isPending}
              >
                <AlertTriangle className="mr-2 h-4 w-4" />
                Delete
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Quick Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="stat-card">
          <p className="text-sm font-medium text-gray-500 mb-1">Total Classes</p>
          <p className="text-3xl font-bold text-gray-900">{classes.length}</p>
        </div>
        <div className="stat-card">
          <p className="text-sm font-medium text-gray-500 mb-1">Evaluations</p>
          <p className="text-3xl font-bold text-gray-900">{evaluations.length}</p>
        </div>
        <div className="stat-card">
          <p className="text-sm font-medium text-gray-500 mb-1">Experience</p>
          <p className="text-3xl font-bold text-gray-900">
            {yearsOfService > 0 ? `${yearsOfService} ${yearsOfService === 1 ? 'Year' : 'Years'}` : "New"}
          </p>
        </div>
      </div>

      {/* Content Tabs */}
      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5 h-auto p-1 bg-gray-100 rounded-md border border-gray-200">
          <TabsTrigger 
            value="profile" 
            className="rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm py-3 text-sm font-medium"
          >
            <FileText className="mr-2 h-4 w-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger 
            value="specializations"
            className="rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm py-3 text-sm font-medium"
          >
            <Award className="mr-2 h-4 w-4" />
            Skills
          </TabsTrigger>
          <TabsTrigger 
            value="schedule"
            className="rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm py-3 text-sm font-medium"
          >
            <Calendar className="mr-2 h-4 w-4" />
            Schedule
          </TabsTrigger>
          <TabsTrigger 
            value="classes"
            className="rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm py-3 text-sm font-medium"
          >
            <Users className="mr-2 h-4 w-4" />
            Classes
          </TabsTrigger>
          <TabsTrigger 
            value="evaluations"
            className="rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm py-3 text-sm font-medium"
          >
            <BarChart3 className="mr-2 h-4 w-4" />
            Reviews
          </TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Contact Information Card */}
            <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Mail className="h-5 w-5 text-[#ECC462]" />
                  Contact Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-xs text-gray-500 font-medium uppercase">Email Address</p>
                    <p className="text-sm font-semibold text-gray-900">{instructor.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-xs text-gray-500 font-medium uppercase">Phone Number</p>
                    <p className="text-sm font-semibold text-gray-900">{instructor.phone}</p>
                  </div>
                </div>
                {instructor.emergencyContact && (
                  <div className="pt-4 border-t border-gray-100 space-y-4">
                    <p className="text-sm font-semibold text-gray-700">Emergency Contact</p>
                    <div className="flex items-center gap-3">
                      <Users className="h-4 w-4 text-gray-400" />
                      <div>
                        <p className="text-xs text-gray-500 font-medium uppercase">Contact Name</p>
                        <p className="text-sm font-semibold text-gray-900">{instructor.emergencyContact}</p>
                      </div>
                    </div>
                    {instructor.emergencyPhone && (
                      <div className="flex items-center gap-3">
                        <Phone className="h-4 w-4 text-gray-400" />
                        <div>
                          <p className="text-xs text-gray-500 font-medium uppercase">Emergency Phone</p>
                          <p className="text-sm font-semibold text-gray-900">{instructor.emergencyPhone}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Professional Information Card */}
            <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Award className="h-5 w-5 text-[#ECC462]" />
                  Professional Info
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-gray-50 rounded-md border border-gray-100">
                    <p className="text-xs text-gray-500 font-medium uppercase mb-1">License Number</p>
                    <p className="text-sm font-bold text-gray-900">{instructor.instructorLicenseNumber || 'Not set'}</p>
                  </div>
                  {instructor.permitNumber && (
                    <div className="p-4 bg-gray-50 rounded-md border border-gray-100">
                      <p className="text-xs text-gray-500 font-medium uppercase mb-1">Gov. Permit</p>
                      <p className="text-sm font-bold text-gray-900">{instructor.permitNumber}</p>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {instructor.hireDate && (
                    <div className="p-4 bg-gray-50 rounded-md border border-gray-100">
                      <p className="text-xs text-gray-500 font-medium uppercase mb-1">Hire Date</p>
                      <p className="text-sm font-bold text-gray-900">{new Date(instructor.hireDate).toLocaleDateString()}</p>
                    </div>
                  )}
                  {instructor.certificationExpiry && (
                    <div className="p-4 bg-gray-50 rounded-md border border-gray-100">
                      <p className="text-xs text-gray-500 font-medium uppercase mb-1">Cert. Expiry</p>
                      <p className="text-sm font-bold text-gray-900">{new Date(instructor.certificationExpiry).toLocaleDateString()}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Location Assignment Card */}
            <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-[#ECC462]" />
                  Location Assignment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-gray-50 rounded-md border border-gray-100">
                  <p className="text-xs text-gray-500 font-medium uppercase mb-1">Primary Location</p>
                  <p className="text-sm font-bold text-gray-900">{instructor.locationAssignment || 'Not assigned'}</p>
                </div>
                {secondaryLocations.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 font-medium uppercase mb-2">Secondary Locations</p>
                    <div className="flex flex-wrap gap-2">
                      {secondaryLocations.map((location: string, index: number) => (
                        <Badge key={index} variant="outline" className="bg-white text-gray-700">
                          {location}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Vehicle Assignment Card */}
            <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Car className="h-5 w-5 text-[#ECC462]" />
                  Vehicle Assignment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {currentVehicle ? (
                  <div className="p-4 bg-gray-50 rounded-md border border-gray-100">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-gray-500 font-medium uppercase">Current Vehicle</p>
                      <Badge className={currentVehicle.status === 'active' ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                        {currentVehicle.status}
                      </Badge>
                    </div>
                    <p className="text-sm font-bold text-gray-900">{currentVehicle.make} {currentVehicle.model} ({currentVehicle.year})</p>
                    <p className="text-xs text-gray-500">Plate: {currentVehicle.licensePlate}</p>
                  </div>
                ) : (
                  <div className="p-4 bg-yellow-50 rounded-md border border-yellow-100 flex items-center gap-3">
                    <AlertTriangle className="h-5 w-5 text-yellow-600" />
                    <p className="text-sm font-medium text-yellow-800">No vehicle assigned</p>
                  </div>
                )}

                <div className="space-y-2">
                  <p className="text-xs text-gray-500 font-medium uppercase">Change Assignment</p>
                  <Select 
                    onValueChange={handleVehicleChange} 
                    defaultValue={instructor.vehicleId?.toString() || "unassigned"}
                  >
                    <SelectTrigger className="bg-white border-gray-200">
                      <SelectValue placeholder="Assign a vehicle" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">No vehicle assigned</SelectItem>
                      {availableVehicles.map(vehicle => (
                        <SelectItem key={vehicle.id} value={vehicle.id.toString()}>
                          {vehicle.make} {vehicle.model} - {vehicle.licensePlate}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </div>
          {/* Notes section if exists */}
          {instructor.notes && (
            <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <FileText className="h-5 w-5 text-[#ECC462]" />
                  Notes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-700 leading-relaxed p-4 bg-gray-50 rounded-md border border-gray-100">{instructor.notes}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Specializations Tab */}
        <TabsContent value="specializations" className="space-y-6">
          <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Skills & Specializations</CardTitle>
            </CardHeader>
            <CardContent>
              {specializationsData.type === 'structured' ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {Object.entries(specializationsData.data).map(([courseType, skills]: [string, any]) => (
                    <div key={courseType} className="p-4 bg-gray-50 rounded-md border border-gray-200">
                      <div className="flex items-center gap-2 mb-3">
                        <Badge variant="secondary" className={getSpecializationColor(courseType)}>
                          {getCourseTypeLabel(courseType)}
                        </Badge>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          {skills.theory ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Clock className="h-4 w-4 text-gray-300" />}
                          <span className="text-sm text-gray-700">Theory Instructor</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {skills.practical ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Clock className="h-4 w-4 text-gray-300" />}
                          <span className="text-sm text-gray-700">Practical Instructor</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : specializationsData.type === 'text' ? (
                <p className="text-sm text-gray-700">{specializationsData.data}</p>
              ) : (
                <div className="p-8 text-center bg-gray-50 rounded-md border border-dashed border-gray-300">
                  <p className="text-sm text-gray-500">No specializations recorded</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schedule" className="space-y-6">
          <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Weekly Availability</CardTitle>
            </CardHeader>
            <CardContent>
              <InstructorAvailability instructorId={parseInt(id!)} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="classes" className="space-y-6">
          <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Assigned Classes</CardTitle>
            </CardHeader>
            <CardContent>
              {classes.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {classes.map((cls) => (
                    <div key={cls.id} className="p-4 border border-gray-100 rounded-md bg-gray-50 hover:bg-gray-100 transition-colors">
                      <div className="flex items-center justify-between mb-2">
                        <Badge variant="outline" className="bg-white">{cls.courseType.toUpperCase()}</Badge>
                        <span className="text-xs text-gray-500 font-medium">{new Date(cls.date).toLocaleDateString()}</span>
                      </div>
                      <p className="text-sm font-semibold text-gray-900">{cls.title || `Class #${cls.id}`}</p>
                      <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                        <Clock className="h-3 w-3" />
                        {cls.time} ({cls.duration} mins)
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center bg-gray-50 rounded-md border border-dashed border-gray-300">
                  <p className="text-sm text-gray-500">No classes assigned</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="evaluations" className="space-y-6">
          <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Student Reviews</CardTitle>
            </CardHeader>
            <CardContent>
              {evaluations.length > 0 ? (
                <div className="space-y-4">
                  {evaluations.map((evalItem) => (
                    <div key={evalItem.id} className="p-4 border border-gray-100 rounded-md bg-gray-50">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-1">
                          {[...Array(5)].map((_, i) => (
                            <Star 
                              key={i} 
                              className={`h-4 w-4 ${i < (evalItem.rating || 0) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}`} 
                            />
                          ))}
                        </div>
                        <span className="text-xs text-gray-500">{new Date(evalItem.date).toLocaleDateString()}</span>
                      </div>
                      <p className="text-sm text-gray-700 italic">"{evalItem.notes || 'No comments provided'}"</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center bg-gray-50 rounded-md border border-dashed border-gray-300">
                  <p className="text-sm text-gray-500">No reviews yet</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
