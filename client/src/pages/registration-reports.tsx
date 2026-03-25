import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart3, Users, Download, TrendingUp, Calendar, MapPin, Loader2, FileText, Car, Search } from "lucide-react";
import { formatCurrency, getCourseColor } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { Student, Location } from "@shared/schema";

interface RegistrationAnalytics {
  period: string;
  count: number;
  auto: number;
  moto: number;
  scooter: number;
}

export default function RegistrationReports() {
  const [registrationPeriod, setRegistrationPeriod] = useState<'day' | 'month' | 'year'>('month');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState<string>('all');
  const [selectedCourseType, setSelectedCourseType] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  
  const { toast } = useToast();

  const { data: studentsResponse } = useQuery<{students: Student[]}>({
    queryKey: ["/api/students"],
  });
  const students = studentsResponse?.students || [];

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: registrationAnalytics = [], isLoading: analyticsLoading } = useQuery<RegistrationAnalytics[]>({
    queryKey: ["/api/students/registration-analytics", registrationPeriod, startDate, endDate, selectedLocationId],
    queryFn: async () => {
      const params = new URLSearchParams({
        period: registrationPeriod,
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
        ...(selectedLocationId && selectedLocationId !== 'all' && { locationId: selectedLocationId })
      });
      const response = await fetch(`/api/students/registration-analytics?${params}`);
      if (!response.ok) throw new Error('Failed to fetch registration analytics');
      return response.json();
    },
  });

  const filteredStudents = students.filter(student => {
    let matches = true;
    
    if (selectedLocationId && selectedLocationId !== 'all') {
      matches = matches && student.locationId?.toString() === selectedLocationId;
    }
    
    if (selectedCourseType && selectedCourseType !== 'all') {
      matches = matches && student.courseType === selectedCourseType;
    }
    
    if (startDate && student.enrollmentDate) {
      const studentDate = new Date(student.enrollmentDate);
      matches = matches && studentDate >= new Date(startDate);
    }
    
    if (endDate && student.enrollmentDate) {
      const studentDate = new Date(student.enrollmentDate);
      matches = matches && studentDate <= new Date(endDate);
    }
    
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      matches = matches && (
        student.firstName.toLowerCase().includes(search) ||
        student.lastName.toLowerCase().includes(search) ||
        student.email.toLowerCase().includes(search) ||
        student.phone.includes(search)
      );
    }
    
    return matches;
  });

  const courseStats = {
    auto: filteredStudents.filter(s => s.courseType === "auto").length,
    moto: filteredStudents.filter(s => s.courseType === "moto").length,
    scooter: filteredStudents.filter(s => s.courseType === "scooter").length,
  };

  const statusStats = {
    active: filteredStudents.filter(s => s.status === "active").length,
    completed: filteredStudents.filter(s => s.status === "completed").length,
    onHold: filteredStudents.filter(s => s.status === "on-hold").length,
  };

  const totalRegistrations = registrationAnalytics.reduce((sum, r) => sum + r.count, 0);

  const handleExportCsv = async () => {
    setIsExportingCsv(true);
    try {
      const params = new URLSearchParams({ format: 'csv' });
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      if (selectedLocationId && selectedLocationId !== 'all') params.append('locationId', selectedLocationId);
      if (selectedCourseType && selectedCourseType !== 'all') params.append('courseType', selectedCourseType);
      
      const response = await fetch(`/api/reports/registrations?${params}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Export failed');
      
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `registration-report-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
      
      toast({ title: "Export Complete", description: "Your CSV file has been downloaded." });
    } catch (error) {
      toast({ title: "Export Failed", description: "Failed to export data.", variant: "destructive" });
    } finally {
      setIsExportingCsv(false);
    }
  };

  const handleExportPdf = async () => {
    setIsGeneratingPdf(true);
    try {
      const params = new URLSearchParams({
        period: registrationPeriod,
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
        ...(selectedLocationId && selectedLocationId !== 'all' && { locationId: selectedLocationId })
      });
      
      const response = await fetch(`/api/reports/download-pdf?${params.toString()}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to generate PDF');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `registration-report-${new Date().toISOString().split('T')[0]}.pdf`;
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

  const getLocationName = (locationId: string | null | undefined) => {
    if (!locationId) return 'N/A';
    const location = locations.find(l => l.id.toString() === locationId);
    return location?.name || 'N/A';
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800">Active</Badge>;
      case 'completed':
        return <Badge className="bg-blue-100 text-blue-800">Completed</Badge>;
      case 'on-hold':
        return <Badge className="bg-yellow-100 text-yellow-800">On Hold</Badge>;
      case 'transferred':
        return <Badge className="bg-purple-100 text-purple-800">Transferred</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800">{status}</Badge>;
    }
  };

  const getCourseBadge = (courseType: string) => {
    const colors = getCourseColor(courseType);
    return <Badge className={colors}>{courseType.charAt(0).toUpperCase() + courseType.slice(1)}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2 bg-gradient-to-r from-[#111111] to-gray-800 bg-clip-text text-transparent">
            <FileText className="h-8 w-8 text-[#ECC462]" />
            Registration Reports
          </h1>
          <p className="text-muted-foreground mt-2">
            Analyze student registrations by date, location, and course type
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline"
            onClick={handleExportCsv}
            disabled={isExportingCsv}
          >
            {isExportingCsv ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Exporting...</>
            ) : (
              <><Download className="mr-2 h-4 w-4" />Export CSV</>
            )}
          </Button>
          <Button 
            className="bg-gradient-to-r from-[#ECC462] to-amber-500 hover:from-[#d4ad4f] hover:to-amber-600 text-[#111111] font-medium shadow-lg"
            onClick={handleExportPdf}
            disabled={isGeneratingPdf}
          >
            {isGeneratingPdf ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating...</>
            ) : (
              <><Download className="mr-2 h-4 w-4" />Export PDF</>
            )}
          </Button>
        </div>
      </div>

      {/* Filters Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Search className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                <SelectTrigger>
                  <SelectValue placeholder="All Locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {locations.map((location) => (
                    <SelectItem key={location.id} value={location.id.toString()}>
                      {location.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Course Type</Label>
              <Select value={selectedCourseType} onValueChange={setSelectedCourseType}>
                <SelectTrigger>
                  <SelectValue placeholder="All Courses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Courses</SelectItem>
                  <SelectItem value="auto">Car</SelectItem>
                  <SelectItem value="moto">Motorcycle</SelectItem>
                  <SelectItem value="scooter">Scooter</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Search</Label>
              <Input
                placeholder="Name, email, phone..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => {
                setStartDate('');
                setEndDate('');
                setSelectedLocationId('all');
                setSelectedCourseType('all');
                setSearchTerm('');
              }}
            >
              Clear Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-0 shadow-lg hover:shadow-xl transition-all">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Registrations</p>
                <p className="text-3xl font-bold text-[#ECC462]">{filteredStudents.length}</p>
              </div>
              <Users className="h-10 w-10 text-[#ECC462] opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg hover:shadow-xl transition-all">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Car Course</p>
                <p className="text-3xl font-bold text-blue-600">{courseStats.auto}</p>
              </div>
              <Car className="h-10 w-10 text-blue-600 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg hover:shadow-xl transition-all">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Motorcycle</p>
                <p className="text-3xl font-bold text-orange-600">{courseStats.moto}</p>
              </div>
              <TrendingUp className="h-10 w-10 text-orange-600 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg hover:shadow-xl transition-all">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Scooter</p>
                <p className="text-3xl font-bold text-green-600">{courseStats.scooter}</p>
              </div>
              <BarChart3 className="h-10 w-10 text-green-600 opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Registration Trends */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Registration Trends
            </span>
            <Select value={registrationPeriod} onValueChange={(value: 'day' | 'month' | 'year') => setRegistrationPeriod(value)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Daily</SelectItem>
                <SelectItem value="month">Monthly</SelectItem>
                <SelectItem value="year">Yearly</SelectItem>
              </SelectContent>
            </Select>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {analyticsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-[#ECC462]" />
            </div>
          ) : registrationAnalytics.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No registration data available for the selected period
            </div>
          ) : (
            <div className="space-y-3">
              {registrationAnalytics.slice(0, 12).map((item, index) => (
                <div key={index} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                  <div className="w-32 font-medium">{item.period}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div 
                        className="h-4 bg-gradient-to-r from-[#ECC462] to-amber-500 rounded"
                        style={{ width: `${Math.min((item.count / Math.max(...registrationAnalytics.map(r => r.count))) * 100, 100)}%` }}
                      />
                      <span className="font-semibold">{item.count}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <Badge variant="outline" className="bg-blue-50">Car: {item.auto}</Badge>
                    <Badge variant="outline" className="bg-orange-50">Moto: {item.moto}</Badge>
                    <Badge variant="outline" className="bg-green-50">Scooter: {item.scooter}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Student List Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Registered Students ({filteredStudents.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredStudents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No students match the selected filters
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Course</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Registered</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStudents.slice(0, 50).map((student) => (
                    <TableRow key={student.id}>
                      <TableCell className="font-medium">
                        {student.firstName} {student.lastName}
                      </TableCell>
                      <TableCell>{student.email}</TableCell>
                      <TableCell>{student.phone}</TableCell>
                      <TableCell>{getCourseBadge(student.courseType)}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {getLocationName(student.locationId?.toString())}
                        </span>
                      </TableCell>
                      <TableCell>{getStatusBadge(student.status)}</TableCell>
                      <TableCell>
                        {student.enrollmentDate 
                          ? new Date(student.enrollmentDate).toLocaleDateString()
                          : 'N/A'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filteredStudents.length > 50 && (
                <div className="text-center py-4 text-muted-foreground">
                  Showing 50 of {filteredStudents.length} students. Export to see all.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
