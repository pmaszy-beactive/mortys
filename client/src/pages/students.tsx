import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Search, Eye, Edit, Trash2, User, RefreshCw, ChevronDown, ChevronUp, Users, Sparkles, ArrowRightLeft } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import TransferStudentForm from "@/components/transfer-student-form";
import type { Student, Location } from "@shared/schema";

export default function Students() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("all");

  // All Students tab state
  const [searchTerm, setSearchTerm] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [hasSearched, setHasSearched] = useState(false);
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [selectedStudents, setSelectedStudents] = useState<Set<number>>(new Set());
  const [phoneNumber, setPhoneNumber] = useState("");
  const [attestationNumber, setAttestationNumber] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [enrollmentDate, setEnrollmentDate] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  // Transfer Students tab search state
  const [transferSearch, setTransferSearch] = useState("");

  const { toast } = useToast();

  const buildSearchParams = () => {
    const params = new URLSearchParams();
    if (searchTerm.trim()) params.append('searchTerm', searchTerm.trim());
    if (courseFilter !== 'all') params.append('courseType', courseFilter);
    if (statusFilter !== 'all') params.append('status', statusFilter);
    if (locationFilter !== 'all') params.append('locationId', locationFilter);
    if (phoneNumber.trim()) params.append('phoneNumber', phoneNumber.trim());
    if (attestationNumber.trim()) params.append('attestationNumber', attestationNumber.trim());
    if (contractNumber.trim()) params.append('contractNumber', contractNumber.trim());
    if (dateOfBirth) params.append('dateOfBirth', dateOfBirth);
    if (enrollmentDate) params.append('enrollmentDate', enrollmentDate);
    const hasAnySearch = searchTerm.trim() || courseFilter !== 'all' || statusFilter !== 'all' ||
      locationFilter !== 'all' || phoneNumber.trim() || attestationNumber.trim() ||
      contractNumber.trim() || dateOfBirth || enrollmentDate;
    params.append('limit', (!hasSearched && !hasAnySearch) ? '10' : '50');
    params.append('offset', '0');
    return params.toString();
  };

  const { data: studentsData, isLoading, refetch } = useQuery<{ students: Student[]; total: number }>({
    queryKey: ["/api/students", buildSearchParams()],
    queryFn: async () => {
      const response = await fetch(`/api/students?${buildSearchParams()}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) throw new Error('Failed to fetch students');
      return response.json();
    }
  });

  const { data: transferData, isLoading: isLoadingTransfers, refetch: refetchTransfers } = useQuery<{ students: Student[]; total: number }>({
    queryKey: ["/api/students/transfers", transferSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('isTransfer', 'true');
      params.append('limit', '200');
      params.append('offset', '0');
      if (transferSearch.trim()) params.append('searchTerm', transferSearch.trim());
      const response = await fetch(`/api/students?${params.toString()}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) throw new Error('Failed to fetch transfer students');
      return response.json();
    }
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const deleteStudentMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/students/${id}`),
    onSuccess: () => {
      refetch();
      refetchTransfers();
      toast({ title: "Success", description: "Student deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete student", variant: "destructive" });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => apiRequest("POST", `/api/students/bulk-delete`, { ids }),
    onSuccess: (data: { deletedCount: number; totalRequested: number }) => {
      setSelectedStudents(new Set());
      refetch();
      refetchTransfers();
      toast({ title: "Success", description: `Deleted ${data.deletedCount} of ${data.totalRequested} students` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete students", variant: "destructive" });
    },
  });

  const students = studentsData?.students || [];
  const totalStudents = studentsData?.total || 0;
  const transferStudents = transferData?.students || [];
  const totalTransfers = transferData?.total || 0;

  const handleSearch = () => { setHasSearched(true); refetch(); };

  const handleDeleteStudent = (id: number) => {
    if (confirm("Are you sure you want to delete this student?")) deleteStudentMutation.mutate(id);
  };

  const resetFilters = () => {
    setSearchTerm(""); setCourseFilter("all"); setStatusFilter("all"); setLocationFilter("all");
    setPhoneNumber(""); setAttestationNumber(""); setDateOfBirth(""); setEnrollmentDate("");
    setHasSearched(false); setSelectedStudents(new Set());
    setTimeout(() => refetch(), 0);
  };

  const toggleStudentSelection = (id: number) => {
    setSelectedStudents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedStudents(selectedStudents.size === students.length ? new Set() : new Set(students.map(s => s.id)));
  };

  const handleBulkDelete = () => {
    if (selectedStudents.size === 0) return;
    if (confirm(`Are you sure you want to delete ${selectedStudents.size} student(s)? This action cannot be undone.`)) {
      bulkDeleteMutation.mutate(Array.from(selectedStudents));
    }
  };

  const getCourseColor = (courseType: string) => {
    switch (courseType) {
      case "auto": return "bg-[#ECC462]/15 text-[#111111] border border-[#ECC462]/30";
      case "moto": return "bg-amber-100 text-amber-800 border border-amber-200";
      case "scooter": return "bg-gray-100 text-gray-800 border border-gray-200";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-green-100 text-green-800 border border-green-200";
      case "completed": return "bg-[#ECC462]/15 text-[#111111] border border-[#ECC462]/30";
      case "on-hold": return "bg-amber-100 text-amber-800 border border-amber-200";
      case "transferred": return "bg-gray-100 text-gray-800 border border-gray-200";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const filteredTransferStudents = transferStudents.filter(s => {
    if (!transferSearch.trim()) return true;
    const term = transferSearch.toLowerCase();
    return (
      s.firstName.toLowerCase().includes(term) ||
      s.lastName.toLowerCase().includes(term) ||
      s.email.toLowerCase().includes(term) ||
      (s.transferredFrom && s.transferredFrom.toLowerCase().includes(term))
    );
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="p-4 sm:p-6 lg:p-8">
          <div className="animate-pulse space-y-8">
            <div className="h-12 bg-gray-200 rounded-md w-1/3"></div>
            <div className="h-96 bg-gray-200 rounded-md"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex justify-between items-center">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl font-semibold text-gray-900">Students</h1>
                <Users className="h-5 w-5 text-[#ECC462]" />
              </div>
              <p className="text-sm text-gray-500">Search and manage student profiles, contracts, and progress.</p>
            </div>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] font-medium shadow-sm">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Transfer Student
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[95vh] overflow-hidden flex flex-col">
                <DialogHeader className="flex-shrink-0">
                  <DialogTitle>Add Transfer Student</DialogTitle>
                  <DialogDescription>Enter student details and check off which classes they completed at their previous school.</DialogDescription>
                </DialogHeader>
                <div className="flex-1 overflow-y-auto">
                  <TransferStudentForm
                    onSuccess={() => {
                      setIsCreateDialogOpen(false);
                      refetch();
                      refetchTransfers();
                    }}
                  />
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="stat-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-xs font-medium uppercase tracking-wide mb-1">Total Students</p>
                <p className="text-3xl font-bold text-gray-900">{totalStudents}</p>
              </div>
              <div className="p-2 bg-gray-50 rounded-md border border-gray-100">
                <Users className="h-5 w-5 text-[#ECC462]" />
              </div>
            </div>
          </div>
          <div className="stat-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-xs font-medium uppercase tracking-wide mb-1">Active Students</p>
                <p className="text-3xl font-bold text-gray-900">{students.filter(s => s.status === 'active').length}</p>
              </div>
              <div className="p-2 bg-gray-50 rounded-md border border-gray-100">
                <Sparkles className="h-5 w-5 text-[#ECC462]" />
              </div>
            </div>
          </div>
          <div className="stat-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-xs font-medium uppercase tracking-wide mb-1">Transfer Students</p>
                <p className="text-3xl font-bold text-gray-900">{totalTransfers}</p>
              </div>
              <div className="p-2 bg-gray-50 rounded-md border border-gray-100">
                <ArrowRightLeft className="h-5 w-5 text-[#ECC462]" />
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6 bg-white border border-gray-200 rounded-md p-1">
            <TabsTrigger value="all" className="rounded-sm data-[state=active]:bg-[#ECC462] data-[state=active]:text-[#111111] data-[state=active]:shadow-none text-gray-600">
              All Students
            </TabsTrigger>
            <TabsTrigger value="transfers" className="rounded-sm data-[state=active]:bg-[#ECC462] data-[state=active]:text-[#111111] data-[state=active]:shadow-none text-gray-600">
              Transfer Students
              {totalTransfers > 0 && (
                <span className="ml-2 bg-gray-100 text-gray-700 text-xs font-medium px-1.5 py-0.5 rounded">{totalTransfers}</span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* All Students Tab */}
          <TabsContent value="all" className="space-y-6">
            {/* Search Section */}
            <Card className="border border-gray-200 shadow-sm bg-white">
              <CardHeader className="border-b border-gray-100 pb-4">
                <CardTitle className="text-base font-semibold text-gray-900 flex items-center">
                  <Search className="mr-2 h-4 w-4 text-[#ECC462]" />
                  Search Students
                </CardTitle>
                <CardDescription className="text-gray-500 text-sm">
                  {!hasSearched ? "Showing 10 most recent students by default." : "Showing search results."}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-5">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Name / Email</label>
                    <Input
                      placeholder="Search by name or email..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                      className="border-gray-200"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Course Type</label>
                    <Select value={courseFilter} onValueChange={setCourseFilter}>
                      <SelectTrigger className="border-gray-200">
                        <SelectValue placeholder="All Courses" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Courses</SelectItem>
                        <SelectItem value="auto">Auto</SelectItem>
                        <SelectItem value="moto">Moto</SelectItem>
                        <SelectItem value="scooter">Scooter</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Status</label>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="border-gray-200">
                        <SelectValue placeholder="All Statuses" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="on-hold">On Hold</SelectItem>
                        <SelectItem value="transferred">Transferred</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Location</label>
                    <Select value={locationFilter} onValueChange={setLocationFilter}>
                      <SelectTrigger className="border-gray-200">
                        <SelectValue placeholder="All Locations" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Locations</SelectItem>
                        {locations.map((loc) => (
                          <SelectItem key={loc.id} value={loc.id.toString()}>{loc.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Collapsible open={showAdvancedSearch} onOpenChange={setShowAdvancedSearch} className="mt-2">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="flex items-center text-sm text-gray-600 hover:text-gray-900 p-0 h-auto">
                      {showAdvancedSearch ? <ChevronUp className="mr-1.5 h-4 w-4" /> : <ChevronDown className="mr-1.5 h-4 w-4" />}
                      Advanced Search Options
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-4">
                    <div className="border-t border-gray-100 pt-4 bg-gray-50/50 p-4 rounded-md">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {[
                          { label: "Phone Number", value: phoneNumber, setter: setPhoneNumber, placeholder: "Search by phone..." },
                          { label: "Attestation Number", value: attestationNumber, setter: setAttestationNumber, placeholder: "Search by attestation..." },
                          { label: "Contract Number", value: contractNumber, setter: setContractNumber, placeholder: "Search by contract..." },
                        ].map(({ label, value, setter, placeholder }) => (
                          <div key={label} className="space-y-1.5">
                            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{label}</label>
                            <Input
                              placeholder={placeholder}
                              value={value}
                              onChange={(e) => setter(e.target.value)}
                              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                              className="border-gray-200"
                            />
                          </div>
                        ))}
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Date of Birth</label>
                          <Input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className="border-gray-200" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Course Start Date</label>
                          <Input type="date" value={enrollmentDate} onChange={(e) => setEnrollmentDate(e.target.value)} className="border-gray-200" />
                        </div>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <div className="flex gap-2 mt-5">
                  <Button onClick={handleSearch} className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] font-medium shadow-sm">
                    <Search className="mr-2 h-4 w-4" /> Search
                  </Button>
                  <Button variant="outline" onClick={resetFilters} className="border-gray-200 hover:bg-gray-50">
                    <RefreshCw className="mr-2 h-4 w-4" /> Clear Filters
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Results Table */}
            <Card className="border border-gray-200 shadow-sm bg-white">
              <CardHeader className="border-b border-gray-100 pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold text-gray-900">
                    {hasSearched ? 'Search Results' : 'Recent Students'}
                    <span className="ml-2 text-sm font-normal text-gray-500">({students.length} of {totalStudents})</span>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {selectedStudents.size > 0 && (
                      <Button onClick={handleBulkDelete} disabled={bulkDeleteMutation.isPending} variant="destructive" size="sm" data-testid="button-bulk-delete">
                        <Trash2 className="mr-2 h-4 w-4" /> Delete Selected ({selectedStudents.size})
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {students.length === 0 ? (
                  <div className="text-center py-16">
                    <User className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 font-medium">{hasSearched ? 'No students found' : 'No recent students'}</p>
                    <p className="text-gray-400 text-sm mt-1">Try adjusting your search criteria.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gray-50/50">
                          <TableHead className="w-10">
                            <Checkbox
                              checked={selectedStudents.size === students.length && students.length > 0}
                              onCheckedChange={toggleSelectAll}
                            />
                          </TableHead>
                          <TableHead className="font-semibold text-gray-600 text-xs uppercase tracking-wide">Name</TableHead>
                          <TableHead className="font-semibold text-gray-600 text-xs uppercase tracking-wide">Email</TableHead>
                          <TableHead className="font-semibold text-gray-600 text-xs uppercase tracking-wide">Phone</TableHead>
                          <TableHead className="font-semibold text-gray-600 text-xs uppercase tracking-wide">Location</TableHead>
                          <TableHead className="font-semibold text-gray-600 text-xs uppercase tracking-wide">Course</TableHead>
                          <TableHead className="font-semibold text-gray-600 text-xs uppercase tracking-wide">Status</TableHead>
                          <TableHead className="font-semibold text-gray-600 text-xs uppercase tracking-wide">Progress</TableHead>
                          <TableHead className="font-semibold text-gray-600 text-xs uppercase tracking-wide">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {students.map((student) => (
                          <TableRow
                            key={student.id}
                            className="hover:bg-gray-50 cursor-pointer"
                            onClick={() => setLocation(`/students/${student.id}`)}
                          >
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selectedStudents.has(student.id)}
                                onCheckedChange={() => toggleStudentSelection(student.id)}
                              />
                            </TableCell>
                            <TableCell className="font-medium text-gray-900">
                              {student.firstName} {student.lastName}
                              {student.transferredFrom && (
                                <span className="ml-1.5 inline-flex items-center">
                                  <ArrowRightLeft className="h-3 w-3 text-[#ECC462]" title={`Transfer from ${student.transferredFrom}`} />
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-gray-500 text-sm">{student.email}</TableCell>
                            <TableCell className="text-gray-500 text-sm">{student.phone || '—'}</TableCell>
                            <TableCell className="text-gray-500 text-sm">
                              {locations.find(l => l.id === student.locationId)?.name || '—'}
                            </TableCell>
                            <TableCell>
                              <Badge className={`text-xs font-medium ${getCourseColor(student.courseType)}`}>
                                {student.courseType?.toUpperCase()}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge className={`text-xs font-medium capitalize ${getStatusColor(student.status)}`}>
                                {student.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="w-16 bg-gray-100 rounded-full h-1.5 border border-gray-200">
                                  <div
                                    className="bg-[#ECC462] h-1.5 rounded-full"
                                    style={{ width: `${student.progress || 0}%` }}
                                  />
                                </div>
                                <span className="text-xs text-gray-500">{student.progress || 0}%</span>
                              </div>
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="sm" onClick={() => setLocation(`/students/${student.id}`)} className="h-7 w-7 p-0 hover:bg-gray-100">
                                  <Eye className="h-4 w-4 text-gray-500" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => handleDeleteStudent(student.id)} disabled={deleteStudentMutation.isPending} className="h-7 w-7 p-0 hover:bg-red-50 hover:text-red-600">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
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

          {/* Transfer Students Tab */}
          <TabsContent value="transfers" className="space-y-6">
            <Card className="border border-gray-200 shadow-sm bg-white">
              <CardHeader className="border-b border-gray-100 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
                      <ArrowRightLeft className="h-4 w-4 text-[#ECC462]" />
                      Transfer Students
                    </CardTitle>
                    <CardDescription className="text-gray-500 text-sm mt-1">
                      Students who enrolled with credits from a previous driving school.
                    </CardDescription>
                  </div>
                  <Button
                    className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] font-medium shadow-sm"
                    onClick={() => setIsCreateDialogOpen(true)}
                  >
                    <Plus className="mr-2 h-4 w-4" /> Add Transfer Student
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="mb-4">
                  <Input
                    placeholder="Search transfer students by name, email, or previous school..."
                    value={transferSearch}
                    onChange={(e) => setTransferSearch(e.target.value)}
                    className="border-gray-200 max-w-md"
                  />
                </div>

                {isLoadingTransfers ? (
                  <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#ECC462] mx-auto"></div>
                    <p className="mt-3 text-gray-500 text-sm">Loading transfer students...</p>
                  </div>
                ) : filteredTransferStudents.length === 0 ? (
                  <div className="text-center py-16">
                    <ArrowRightLeft className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 font-medium">No transfer students found</p>
                    <p className="text-gray-400 text-sm mt-1">Use the button above to add a student transferring from another school.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gray-50/50">
                          <TableHead className="font-semibold text-gray-600 text-xs uppercase tracking-wide">Name</TableHead>
                          <TableHead className="font-semibold text-gray-600 text-xs uppercase tracking-wide">Email</TableHead>
                          <TableHead className="font-semibold text-gray-600 text-xs uppercase tracking-wide">Course</TableHead>
                          <TableHead className="font-semibold text-gray-600 text-xs uppercase tracking-wide">Status</TableHead>
                          <TableHead className="font-semibold text-gray-600 text-xs uppercase tracking-wide">Previous School</TableHead>
                          <TableHead className="font-semibold text-gray-600 text-xs uppercase tracking-wide">Credits Transferred</TableHead>
                          <TableHead className="font-semibold text-gray-600 text-xs uppercase tracking-wide">Progress</TableHead>
                          <TableHead className="font-semibold text-gray-600 text-xs uppercase tracking-wide">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredTransferStudents.map((student) => (
                          <TableRow
                            key={student.id}
                            className="hover:bg-gray-50 cursor-pointer"
                            onClick={() => setLocation(`/students/${student.id}`)}
                          >
                            <TableCell className="font-medium text-gray-900">
                              {student.firstName} {student.lastName}
                            </TableCell>
                            <TableCell className="text-gray-500 text-sm">{student.email}</TableCell>
                            <TableCell>
                              <Badge className={`text-xs font-medium ${getCourseColor(student.courseType)}`}>
                                {student.courseType?.toUpperCase()}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge className={`text-xs font-medium capitalize ${getStatusColor(student.status)}`}>
                                {student.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-gray-700 text-sm font-medium">
                              {student.transferredFrom || '—'}
                            </TableCell>
                            <TableCell className="text-gray-500 text-sm">
                              {student.transferredCredits != null ? (
                                <span className="font-medium text-gray-900">{student.transferredCredits} credits</span>
                              ) : '—'}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="w-16 bg-gray-100 rounded-full h-1.5 border border-gray-200">
                                  <div
                                    className="bg-[#ECC462] h-1.5 rounded-full"
                                    style={{ width: `${student.progress || 0}%` }}
                                  />
                                </div>
                                <span className="text-xs text-gray-500">{student.progress || 0}%</span>
                              </div>
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="sm" onClick={() => setLocation(`/students/${student.id}`)} className="h-7 w-7 p-0 hover:bg-gray-100">
                                  <Eye className="h-4 w-4 text-gray-500" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => handleDeleteStudent(student.id)} disabled={deleteStudentMutation.isPending} className="h-7 w-7 p-0 hover:bg-red-50 hover:text-red-600">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
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
