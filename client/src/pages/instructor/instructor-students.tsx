import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Search, Phone, Mail, Calendar, ArrowLeft, UserCheck, Filter, LogOut } from "lucide-react";
import { useInstructorAuth } from "@/hooks/useInstructorAuth";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import type { Student } from "@shared/schema";

export default function InstructorStudents() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [courseFilter, setCourseFilter] = useState("all");
  const { instructor, isLoading: authLoading, isAuthenticated } = useInstructorAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: students = [], isLoading } = useQuery<Student[]>({
    queryKey: ["/api/instructor/students"],
    enabled: !!instructor,
    staleTime: 0,
    refetchOnMount: "always",
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      setLocation("/instructor/login");
    }
  }, [authLoading, isAuthenticated, setLocation]);

  // Filter students based on search and filters
  const filteredStudents = students.filter(student => {
    const matchesSearch = searchTerm === "" || 
      `${student.firstName} ${student.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
      student.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      student.phone?.includes(searchTerm);

    const matchesStatus = statusFilter === "all" || student.status === statusFilter;
    const matchesCourse = courseFilter === "all" || student.courseType === courseFilter;

    return matchesSearch && matchesStatus && matchesCourse;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'default';
      case 'completed':
        return 'secondary';
      case 'on-hold':
        return 'destructive';
      default:
        return 'secondary';
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
      toast({
        title: "Logged out successfully",
        description: "You have been logged out of your account.",
      });
      window.location.href = '/instructor-login';
    } catch (error) {
      console.error('Logout error:', error);
      window.location.href = '/instructor-login';
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-[#ECC462] mx-auto mb-4"></div>
          <p className="text-gray-700 font-medium">Loading students...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-2 sm:space-y-0 sm:space-x-4">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setLocation('/instructor/dashboard')}
                className="hover:bg-gray-100 transition-colors"
              >
                <ArrowLeft className="flex-shrink-0 h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
                  My Students
                </h1>
                <p className="mt-1 text-sm sm:text-base text-gray-600">
                  Manage and track your assigned students
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <div className="flex items-center space-x-2 bg-gray-100 px-4 py-2 rounded-md">
                <UserCheck className="flex-shrink-0 h-5 w-5 text-[#ECC462]" />
                <span className="text-sm font-medium text-gray-900">
                  {filteredStudents.length} student{filteredStudents.length !== 1 ? 's' : ''}
                </span>
              </div>
              <Button 
                variant="ghost"
                onClick={handleLogout}
                className="text-gray-600 hover:text-[#111111] hover:bg-gray-100"
                data-testid="button-logout"
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Filters */}
        <Card className="mb-6 border border-gray-200 rounded-md shadow-sm bg-white overflow-hidden">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search students by name, email, or phone..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462] rounded-md"
                />
              </div>
              <div className="flex items-center gap-2">
                <div className="bg-gray-100 rounded-md p-2">
                  <Filter className="h-4 w-4 text-gray-600" />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full md:w-48 border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462] rounded-md">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="on-hold">On Hold</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={courseFilter} onValueChange={setCourseFilter}>
                  <SelectTrigger className="w-full md:w-48 border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462] rounded-md">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Courses</SelectItem>
                    <SelectItem value="auto">Automobile</SelectItem>
                    <SelectItem value="moto">Motorcycle</SelectItem>
                    <SelectItem value="scooter">Scooter</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Students List */}
        <Card className="border border-gray-200 rounded-md shadow-sm bg-white overflow-hidden">
          <CardHeader className="border-b bg-gray-50">
            <CardTitle className="flex items-center text-gray-900 text-xl font-semibold">
              <div className="bg-gray-100 rounded-md p-2 mr-3">
                <Users className="h-5 w-5 text-[#ECC462]" />
              </div>
              Students List
            </CardTitle>
            <CardDescription className="text-gray-500">
              Students currently assigned to you for instruction
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {filteredStudents.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Course</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Enrollment</TableHead>
                      <TableHead>Progress</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredStudents.map((student) => (
                      <TableRow 
                        key={student.id}
                        className="cursor-pointer transition-colors duration-150 hover:bg-gray-50"
                        onClick={() => setLocation(`/instructor/students/${student.id}`)}
                      >
                        <TableCell>
                          <div>
                            <p className="font-medium text-gray-900">
                              {student.firstName} {student.lastName}
                            </p>
                            {student.dateOfBirth && (
                              <p className="text-sm text-gray-500">
                                Age: {new Date().getFullYear() - new Date(student.dateOfBirth).getFullYear()}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="rounded-md">
                            {student.courseType?.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={getStatusColor(student.status) as any} className="rounded-md">
                            {student.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {student.email && (
                              <div className="flex items-center text-sm text-gray-600">
                                <div className="bg-gray-100 rounded p-1 mr-2 flex-shrink-0">
                                  <Mail className="h-3 w-3 text-gray-400" />
                                </div>
                                <span className="truncate" title={student.email}>{student.email}</span>
                              </div>
                            )}
                            {student.phone && (
                              <div className="flex items-center text-sm text-gray-600">
                                <div className="bg-gray-100 rounded p-1 mr-2 flex-shrink-0">
                                  <Phone className="h-3 w-3 text-gray-400" />
                                </div>
                                <span className="truncate" title={student.phone}>{student.phone}</span>
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {student.enrollmentDate && (
                            <div className="flex items-center text-sm text-gray-600">
                              <div className="bg-gray-100 rounded p-1 mr-2 flex-shrink-0">
                                <Calendar className="h-3 w-3 text-gray-400" />
                              </div>
                              {new Date(student.enrollmentDate).toLocaleDateString()}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {student.theoryHoursCompleted !== undefined && (
                              <p className="text-sm text-gray-600">
                                Theory: <span className="font-medium text-gray-900">{student.theoryHoursCompleted}h</span>
                              </p>
                            )}
                            {student.practicalHoursCompleted !== undefined && (
                              <p className="text-sm text-gray-600">
                                Driving: <span className="font-medium text-gray-900">{student.practicalHoursCompleted}h</span>
                              </p>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="bg-gray-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                  <Users className="h-10 w-10 text-gray-300" />
                </div>
                <h3 className="text-lg font-medium text-gray-900">
                  No students found
                </h3>
                <p className="mt-2 text-gray-500">
                  {searchTerm || statusFilter !== "all" || courseFilter !== "all"
                    ? "Try adjusting your filters to see more students."
                    : "You don't have any students assigned yet."}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
