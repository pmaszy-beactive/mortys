import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Search, Edit, Trash2, MapPin, Phone, Mail, Building, Users, Calendar, AlertTriangle, GraduationCap, UserPlus, Eye, BookOpen, Car, Bike, Link, Lock } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import LocationForm from "@/components/location-form";
import type { Location, Student, Class, User } from "@shared/schema";

export default function Locations() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear().toString());
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [viewingLocation, setViewingLocation] = useState<Location | null>(null);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();

  // Role-based permissions: Only admins and managers can edit/delete locations
  const canEdit = user && (user.role === 'admin' || user.role === 'manager');
  const canDelete = user && user.role === 'admin';

  const { data: locations = [], isLoading } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
  });

  // Fetch students to count active students per location
  const { data: studentsData } = useQuery<{students: Student[]}>({
    queryKey: ["/api/students"],
    staleTime: 30000, // Cache for 30 seconds
  });

  const students = studentsData?.students || [];

  // Fetch classes to link to locations
  const { data: classes = [] } = useQuery<Class[]>({
    queryKey: ["/api/classes"],
    staleTime: 30000,
  });

  // Get students linked to a specific location
  const getLinkedStudents = (locationId: number) => {
    return students.filter(student => student.locationId === locationId);
  };

  // Get classes linked to a specific location (by room field matching location name)
  const getLinkedClasses = (locationName: string) => {
    return classes.filter(cls => cls.room?.toLowerCase().includes(locationName.toLowerCase()));
  };

  const deleteLocationMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/locations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({
        title: "Success",
        description: "Location deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete location",
        variant: "destructive",
      });
    },
  });

  const filteredLocations = locations.filter((location) => {
    const matchesSearch = searchTerm === "" || 
      location.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      location.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
      location.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (location.locationCode && location.locationCode.toLowerCase().includes(searchTerm.toLowerCase()));
    
    return matchesSearch;
  });

  const handleDeleteLocation = (id: number) => {
    if (confirm("Are you sure you want to delete this location? This action cannot be undone.")) {
      deleteLocationMutation.mutate(id);
    }
  };

  const parseArrayField = (field: any) => {
    if (Array.isArray(field)) return field;
    if (typeof field === 'string') {
      try {
        return JSON.parse(field);
      } catch {
        return [];
      }
    }
    return [];
  };

  const parseOperatingHours = (hours: any) => {
    if (typeof hours === 'string') {
      try {
        return JSON.parse(hours);
      } catch {
        return {};
      }
    }
    return hours || {};
  };

  // Count active students per location
  const getActiveStudentCount = (locationId: number) => {
    return students.filter(student => 
      student.locationId === locationId && student.status === 'active'
    ).length;
  };

  // Count students who started per location for selected year
  const getStartedStudentCount = (locationId: number, year: string) => {
    return students.filter(student => {
      const isAtLocation = student.locationId === locationId;
      
      // Check if student started in the selected year
      let startedInYear = false;
      if (student.started) {
        startedInYear = student.started.toString() === year;
      } else if (student.enrollmentDate) {
        // Fallback to enrollment date if started field is not set
        const enrollmentYear = new Date(student.enrollmentDate).getFullYear().toString();
        startedInYear = enrollmentYear === year;
      }
      
      return isAtLocation && startedInYear;
    }).length;
  };

  // Count completed students per location for selected year
  const getCompletedStudentCount = (locationId: number, year: string) => {
    return students.filter(student => {
      // Check if student is completed and at this location
      const isCompleted = student.status === 'completed' || student.completionDate;
      const isAtLocation = student.locationId === locationId;
      
      // Check if completion was in the selected year
      let completedInYear = false;
      if (student.completionDate) {
        const completionYear = new Date(student.completionDate).getFullYear().toString();
        completedInYear = completionYear === year;
      }
      
      return isCompleted && isAtLocation && completedInYear;
    }).length;
  };

  // Generate year options (current year and previous 4 years)
  const getYearOptions = () => {
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let i = 0; i < 5; i++) {
      years.push((currentYear - i).toString());
    }
    return years;
  };

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
                  Locations
                </h1>
                <MapPin className="h-6 w-6 text-[#ECC462]" />
              </div>
              <p className="text-gray-600 font-medium">
                Manage driving school locations, facilities, and operating hours.
              </p>
            </div>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <DialogTrigger asChild>
                        <Button 
                          className={`rounded-md transition-all duration-200 ${
                            canEdit 
                              ? "bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] font-medium" 
                              : "bg-gray-300 text-gray-500 cursor-not-allowed"
                          }`}
                          disabled={!canEdit}
                        >
                          {canEdit ? (
                            <Plus className="mr-2 h-4 w-4" />
                          ) : (
                            <Lock className="mr-2 h-4 w-4" />
                          )}
                          Add Location
                        </Button>
                      </DialogTrigger>
                    </span>
                  </TooltipTrigger>
                  {!canEdit && (
                    <TooltipContent>
                      Admin or Manager access required to add locations
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add New Location</DialogTitle>
                <DialogDescription>
                  Create a new driving school location with facilities and operating hours.
                </DialogDescription>
              </DialogHeader>
              <LocationForm onSuccess={() => setIsCreateDialogOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
          <div className="stat-card">
            <div className="flex items-start justify-between mb-4">
              <Building className="h-5 w-5 text-gray-400" />
              <Badge variant="outline" className="text-gray-600 border-gray-200">
                Total
              </Badge>
            </div>
            <div>
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide mb-1">Total Locations</p>
              <p className="text-3xl font-bold text-gray-900 mb-1">{locations.length}</p>
              <p className="text-gray-400 text-xs">across all regions</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-start justify-between mb-4">
              <MapPin className="h-5 w-5 text-gray-400" />
              <Badge variant="outline" className="text-gray-600 border-gray-200">
                Active
              </Badge>
            </div>
            <div>
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide mb-1">Active</p>
              <p className="text-3xl font-bold text-gray-900 mb-1">
                {locations.filter(l => l.isActive).length}
              </p>
              <p className="text-gray-400 text-xs">currently operating</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-start justify-between mb-4">
              <Users className="h-5 w-5 text-gray-400" />
              <Badge variant="outline" className="text-gray-600 border-gray-200">Primary</Badge>
            </div>
            <div>
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide mb-1">Primary Locations</p>
              <p className="text-3xl font-bold text-gray-900 mb-1">
                {locations.filter(l => l.isPrimary).length}
              </p>
              <p className="text-gray-400 text-xs">main facilities</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-start justify-between mb-4">
              <Calendar className="h-5 w-5 text-gray-400" />
              <Badge variant="outline" className="text-gray-600 border-gray-200">Coverage</Badge>
            </div>
            <div>
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide mb-1">Provinces</p>
              <p className="text-3xl font-bold text-gray-900 mb-1">
                {new Set(locations.map(l => l.province)).size}
              </p>
              <p className="text-gray-400 text-xs">provincial coverage</p>
            </div>
          </div>
        </div>

        {/* Search and Filters */}
        <Card className="mb-8 border border-gray-200 bg-white shadow-sm">
          <CardContent className="pt-6">
            <div className="flex gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-amber-600" />
                <Input
                  placeholder="Search locations by name, city, address, or code..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 transition-all duration-200 focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div className="w-48">
                <Select value={selectedYear} onValueChange={setSelectedYear}>
                  <SelectTrigger className="transition-all duration-200 focus:ring-2 focus:ring-amber-500">
                    <SelectValue placeholder="Select year" />
                  </SelectTrigger>
                  <SelectContent>
                    {getYearOptions().map((year) => (
                      <SelectItem key={year} value={year}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Locations Table */}
        <Card className="mb-8 border border-gray-200 bg-white shadow-sm">
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="font-bold text-gray-700">Location</TableHead>
                    <TableHead className="font-bold text-gray-700">Address</TableHead>
                    <TableHead className="font-bold text-gray-700">Contact</TableHead>
                    <TableHead className="font-bold text-gray-700">Active Students</TableHead>
                    <TableHead className="font-bold text-gray-700">Started ({selectedYear})</TableHead>
                    <TableHead className="font-bold text-gray-700">Completed ({selectedYear})</TableHead>
                    <TableHead className="font-bold text-gray-700">Status</TableHead>
                    <TableHead className="font-bold text-gray-700">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLocations.map((location) => (
                    <TableRow 
                      key={location.id} 
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-bold text-gray-900 flex items-center gap-2">
                            {location.name}
                            {location.isPrimary && (
                              <Badge className="bg-[#ECC462] text-[#111111]">
                                Primary
                              </Badge>
                            )}
                          </div>
                          {location.locationCode && (
                            <div className="text-sm font-medium text-amber-600">
                              Code: {location.locationCode}
                            </div>
                          )}
                        </div>
                      </TableCell>

                    <TableCell>
                      <div className="space-y-1">
                        <div className="text-sm text-gray-900">{location.address}</div>
                        <div className="text-sm text-gray-600">
                          {location.city}, {location.province} {location.postalCode}
                        </div>
                        <div className="text-xs text-gray-500">{location.country}</div>
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="space-y-1">
                        {location.phone && (
                          <div className="flex items-center text-sm text-gray-600">
                            <Phone className="h-3 w-3 mr-2" />
                            {location.phone}
                          </div>
                        )}
                        {location.email && (
                          <div className="flex items-center text-sm text-gray-600">
                            <Mail className="h-3 w-3 mr-2" />
                            {location.email}
                          </div>
                        )}
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <Users className="h-4 w-4 text-amber-600" />
                        <div>
                          <div className="font-bold text-sm text-gray-900">
                            {getActiveStudentCount(location.id)}
                          </div>
                          <div className="text-xs text-gray-500">
                            active
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <UserPlus className="h-4 w-4 text-amber-600" />
                        <div>
                          <div className="font-bold text-sm text-gray-900">
                            {getStartedStudentCount(location.id, selectedYear)}
                          </div>
                          <div className="text-xs text-gray-500">
                            started
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <GraduationCap className="h-4 w-4 text-green-600" />
                        <div>
                          <div className="font-bold text-sm text-gray-900">
                            {getCompletedStudentCount(location.id, selectedYear)}
                          </div>
                          <div className="text-xs text-gray-500">
                            completed
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell>
                      <Badge className={location.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}>
                        {location.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>

                    <TableCell>
                      <div className="flex space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setViewingLocation(location)}
                          className="hover:bg-blue-50 hover:border-blue-300 transition-all duration-200 shadow-sm hover:shadow-md"
                          title="View Details"
                        >
                          <Eye className="h-4 w-4 text-blue-600" />
                        </Button>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => canEdit && setEditingLocation(location)}
                                  className={`transition-all duration-200 shadow-sm hover:shadow-md ${
                                    canEdit 
                                      ? "hover:bg-amber-50 hover:border-amber-300" 
                                      : "opacity-50 cursor-not-allowed"
                                  }`}
                                  disabled={!canEdit}
                                >
                                  {canEdit ? (
                                    <Edit className="h-4 w-4" />
                                  ) : (
                                    <Lock className="h-4 w-4 text-gray-400" />
                                  )}
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {canEdit ? "Edit Location" : "Admin or Manager access required"}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => canDelete && handleDeleteLocation(location.id)}
                                  className={`transition-all duration-200 shadow-sm hover:shadow-md ${
                                    canDelete 
                                      ? "text-red-600 hover:text-red-900 hover:bg-red-50" 
                                      : "opacity-50 cursor-not-allowed text-gray-400"
                                  }`}
                                  disabled={!canDelete}
                                >
                                  {canDelete ? (
                                    <Trash2 className="h-4 w-4" />
                                  ) : (
                                    <Lock className="h-4 w-4" />
                                  )}
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {canDelete ? "Delete Location" : "Admin access required"}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredLocations.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12">
                      <div className="bg-gray-100 rounded-full p-4 w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                        <MapPin className="h-10 w-10 text-gray-400" />
                      </div>
                      <p className="text-lg font-bold text-gray-900 mb-2">
                        {searchTerm ? "No locations found" : "No locations yet"}
                      </p>
                      <p className="text-gray-600">
                        {searchTerm
                          ? "No locations match your search criteria."
                          : "Add your first location to get started."
                        }
                      </p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      {editingLocation && (
        <Dialog open={true} onOpenChange={() => setEditingLocation(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Location</DialogTitle>
              <DialogDescription>
                Update location information, facilities, and operating hours.
              </DialogDescription>
            </DialogHeader>
            <LocationForm 
              location={editingLocation} 
              onSuccess={() => setEditingLocation(null)} 
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Location Details Dialog */}
      {viewingLocation && (
        <Dialog open={true} onOpenChange={() => setViewingLocation(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-[#ECC462]" />
                {viewingLocation.name}
                {viewingLocation.locationCode && (
                  <Badge variant="outline" className="ml-2">{viewingLocation.locationCode}</Badge>
                )}
              </DialogTitle>
              <DialogDescription>
                View location details, linked students, and scheduled classes.
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-6">
              {/* Location Info */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Building className="h-4 w-4" />
                    Location Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Address</p>
                    <p className="font-medium">{viewingLocation.address}</p>
                    <p>{viewingLocation.city}, {viewingLocation.province} {viewingLocation.postalCode}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Contact</p>
                    {viewingLocation.phone && <p className="flex items-center gap-1"><Phone className="h-3 w-3" /> {viewingLocation.phone}</p>}
                    {viewingLocation.email && <p className="flex items-center gap-1"><Mail className="h-3 w-3" /> {viewingLocation.email}</p>}
                  </div>
                  <div>
                    <p className="text-gray-500">Status</p>
                    <div className="flex gap-2 mt-1">
                      <Badge className={viewingLocation.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}>
                        {viewingLocation.isActive ? "Active" : "Inactive"}
                      </Badge>
                      {viewingLocation.isPrimary && (
                        <Badge className="bg-amber-100 text-amber-800">Primary</Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Linked Students */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Linked Students ({getLinkedStudents(viewingLocation.id).length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {getLinkedStudents(viewingLocation.id).length > 0 ? (
                    <div className="max-h-48 overflow-y-auto space-y-2">
                      {getLinkedStudents(viewingLocation.id).slice(0, 10).map((student) => (
                        <div 
                          key={student.id} 
                          className="flex items-center justify-between p-2 rounded-lg bg-gray-50 hover:bg-amber-50 transition-colors cursor-pointer"
                          onClick={() => {
                            setViewingLocation(null);
                            navigate(`/students/${student.id}`);
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4 text-gray-400" />
                            <span className="font-medium">{student.firstName} {student.lastName}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {student.courseType}
                            </Badge>
                            <Badge className={student.status === 'active' ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}>
                              {student.status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                      {getLinkedStudents(viewingLocation.id).length > 10 && (
                        <p className="text-sm text-gray-500 text-center py-2">
                          +{getLinkedStudents(viewingLocation.id).length - 10} more students
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm text-center py-4">No students linked to this location</p>
                  )}
                </CardContent>
              </Card>

              {/* Linked Classes */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    Linked Classes ({getLinkedClasses(viewingLocation.name).length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {getLinkedClasses(viewingLocation.name).length > 0 ? (
                    <div className="max-h-48 overflow-y-auto space-y-2">
                      {getLinkedClasses(viewingLocation.name).slice(0, 10).map((cls) => (
                        <div 
                          key={cls.id} 
                          className="flex items-center justify-between p-2 rounded-lg bg-gray-50 hover:bg-amber-50 transition-colors cursor-pointer"
                          onClick={() => {
                            setViewingLocation(null);
                            navigate(`/scheduling?classId=${cls.id}`);
                          }}
                        >
                          <div className="flex items-center gap-2">
                            {cls.courseType === 'auto' ? <Car className="h-4 w-4 text-amber-600" /> : <Bike className="h-4 w-4 text-amber-600" />}
                            <span className="font-medium">{cls.courseType.toUpperCase()} Class #{cls.classNumber}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {cls.classType || 'theory'}
                            </Badge>
                            <span className="text-xs text-gray-500">{cls.date}</span>
                          </div>
                        </div>
                      ))}
                      {getLinkedClasses(viewingLocation.name).length > 10 && (
                        <p className="text-sm text-gray-500 text-center py-2">
                          +{getLinkedClasses(viewingLocation.name).length - 10} more classes
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm text-center py-4">No classes linked to this location</p>
                  )}
                </CardContent>
              </Card>

              {/* Quick Actions */}
              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => setViewingLocation(null)}>
                  Close
                </Button>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button 
                          onClick={() => {
                            if (canEdit) {
                              setViewingLocation(null);
                              setEditingLocation(viewingLocation);
                            }
                          }}
                          className={`${
                            canEdit 
                              ? "bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111]" 
                              : "bg-gray-300 text-gray-500 cursor-not-allowed"
                          }`}
                          disabled={!canEdit}
                        >
                          {canEdit ? (
                            <Edit className="h-4 w-4 mr-2" />
                          ) : (
                            <Lock className="h-4 w-4 mr-2" />
                          )}
                          Edit Location
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {!canEdit && (
                      <TooltipContent>
                        Admin or Manager access required to edit locations
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
      </div>
    </div>
  );
}