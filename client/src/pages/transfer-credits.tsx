import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, CreditCard, GraduationCap, FileText, CheckCircle, XCircle, Clock, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertTransferCreditSchema } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { format } from "date-fns";

type TransferCredit = {
  id: number;
  studentId: number;
  previousSchool: string;
  learnerPermitDate: string;
  currentPhase: number;
  phaseStartDate: string;
  completedCourses: string[];
  courseType: string;
  transferDate: string;
  status: 'pending' | 'approved' | 'rejected';
  equivalencyNotes?: string;
  creditValue?: string;
};

type Student = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  courseType: string;
};

// Course definitions for each phase
const PHASE_COURSES = {
  1: {
    theory: ["Theory 1", "Theory 2", "Theory 3", "Theory 4", "Theory 5", "Passed Test 5"],
    inCar: []
  },
  2: {
    theory: ["Theory 6", "Theory 7"],
    inCar: ["In Car 1", "In Car 2", "In Car 3", "In Car 4"]
  },
  3: {
    theory: ["Theory 8", "Theory 9", "Theory 10"],
    inCar: ["In Car 5", "In Car 6", "In Car 7", "In Car 8", "In Car 9", "In Car 10"]
  },
  4: {
    theory: ["Theory 11", "Theory 12"],
    inCar: ["In Car 11", "In Car 12", "In Car 13", "In Car 14", "In Car 15"]
  }
};

const transferFormSchema = insertTransferCreditSchema.extend({
  completedCourses: z.array(z.string()).default([]),
  creditValue: z.string().default("0.00")
});

export default function TransferCredits() {
  const [showNewForm, setShowNewForm] = useState(false);
  const [selectedPhase, setSelectedPhase] = useState<number | null>(null);
  const [completedCourses, setCompletedCourses] = useState<string[]>([]);
  const [studentSearchTerm, setStudentSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [showStudentDropdown, setShowStudentDropdown] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: transferCredits = [] } = useQuery<TransferCredit[]>({
    queryKey: ['/api/transfer-credits'],
  });

  // Debounced search for students
  const { data: studentSearchResults } = useQuery<{ students: Student[] }>({
    queryKey: ['/api/students', { searchTerm: debouncedSearchTerm, limit: 10, offset: 0 }],
    enabled: debouncedSearchTerm.length >= 2, // Only search when user types at least 2 characters
    staleTime: 30000, // Keep data fresh for 30 seconds
    placeholderData: (previousData) => previousData, // Keep previous results while loading new ones (v5 replacement for keepPreviousData)
  });

  const searchedStudents = studentSearchResults?.students || [];

  // Debounce search term to avoid excessive API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(studentSearchTerm);
    }, 300);

    return () => clearTimeout(timer);
  }, [studentSearchTerm]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (showStudentDropdown && !target.closest('[data-student-search]')) {
        setShowStudentDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showStudentDropdown]);

  const createMutation = useMutation({
    mutationFn: (data: z.infer<typeof transferFormSchema>) => 
      apiRequest('POST', '/api/transfer-credits', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/transfer-credits'] });
      setShowNewForm(false);
      setSelectedPhase(null);
      setCompletedCourses([]);
      setSelectedStudent(null);
      setStudentSearchTerm("");
      form.reset();
      toast({ 
        title: "Transfer credit created successfully",
        description: "The transfer credit has been saved and is pending approval."
      });
    },
    onError: (error: any) => {
      console.error('Transfer credit creation error:', error);
      toast({ 
        title: "Failed to create transfer credit",
        description: error.response?.data?.message || error.message || "Please check all required fields and try again.",
        variant: "destructive"
      });
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number, data: Partial<TransferCredit> }) => 
      apiRequest('PUT', `/api/transfer-credits/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/transfer-credits'] });
      queryClient.invalidateQueries({ queryKey: ['/api/students'] });
      toast({ title: "Transfer credit updated successfully" });
    }
  });

  const form = useForm<z.infer<typeof transferFormSchema>>({
    resolver: zodResolver(transferFormSchema),
    defaultValues: {
      studentId: undefined,
      previousSchool: '',
      learnerPermitDate: '',
      currentPhase: 2,
      phaseStartDate: '',
      courseType: '',
      status: 'pending',
      transferDate: format(new Date(), 'yyyy-MM-dd'),
      completedCourses: [],
      creditValue: "0.00"
    }
  });

  const onSubmit = (data: z.infer<typeof transferFormSchema>) => {
    console.log('Form submitted with data:', data);
    console.log('Form errors:', form.formState.errors);
    console.log('Selected phase:', selectedPhase);
    console.log('Completed courses:', completedCourses);
    console.log('Selected student:', selectedStudent);
    
    // Validate that a student is selected
    if (!data.studentId) {
      toast({
        title: "Student Required",
        description: "Please select a student before submitting.",
        variant: "destructive"
      });
      return;
    }
    
    const submitData = {
      ...data,
      completedCourses: completedCourses,
      currentPhase: selectedPhase || data.currentPhase || 2
    };
    
    console.log('Final submit data:', submitData);
    createMutation.mutate(submitData);
  };

  const approveCredit = (credit: TransferCredit) => {
    updateMutation.mutate({
      id: credit.id,
      data: {
        status: 'approved'
      }
    });
  };

  const denyCredit = (credit: TransferCredit) => {
    const notes = prompt('Enter denial reason:');
    if (notes) {
      updateMutation.mutate({
        id: credit.id,
        data: {
          status: 'rejected',
          equivalencyNotes: notes
        }
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />Approved</Badge>;
      case 'rejected':
        return <Badge className="bg-red-100 text-red-800"><XCircle className="w-3 h-3 mr-1" />Denied</Badge>;
      default:
        return <Badge className="bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111] shadow-md"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
    }
  };

  const getStudentName = (studentId: number) => {
    if (selectedStudent && selectedStudent.id === studentId) {
      return `${selectedStudent.firstName} ${selectedStudent.lastName}`;
    }
    return 'Unknown Student';
  };

  const handleCourseToggle = (course: string, checked: boolean) => {
    if (checked) {
      setCompletedCourses([...completedCourses, course]);
    } else {
      setCompletedCourses(completedCourses.filter(c => c !== course));
    }
  };

  const getAvailableCourses = () => {
    if (!selectedPhase || !(selectedPhase in PHASE_COURSES)) return [];
    const phaseData = PHASE_COURSES[selectedPhase as keyof typeof PHASE_COURSES];
    return [...phaseData.theory, ...phaseData.inCar];
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2 bg-gradient-to-r from-[#111111] to-gray-800 bg-clip-text text-transparent">
            <CreditCard className="h-8 w-8 text-[#ECC462]" />
            Course Transfer
          </h1>
          <p className="text-muted-foreground mt-2">
            Manage student course transfers from previous driving schools
          </p>
        </div>
        <Dialog open={showNewForm} onOpenChange={(open) => {
          setShowNewForm(open);
          if (!open) {
            // Reset form and state when dialog closes
            form.reset();
            setSelectedStudent(null);
            setStudentSearchTerm("");
            setDebouncedSearchTerm("");
            setSelectedPhase(null);
            setCompletedCourses([]);
            setShowStudentDropdown(false);
          }
        }}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-to-r from-[#ECC462] to-amber-500 hover:from-[#d4ad4f] hover:to-amber-600 text-[#111111] font-medium shadow-lg hover:shadow-xl transition-all duration-200" data-testid="button-new-transfer">
              <Plus className="h-4 w-4 mr-2" />
              New Course Transfer
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Transfer Course</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="studentId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Student</FormLabel>
                      <FormControl>
                        <div className="relative" data-student-search>
                          <Input
                            placeholder="Search students by name..."
                            value={selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : studentSearchTerm}
                            onChange={(e) => {
                              if (!selectedStudent) {
                                setStudentSearchTerm(e.target.value);
                                setShowStudentDropdown(true);
                              }
                            }}
                            onFocus={() => {
                              if (!selectedStudent) {
                                setShowStudentDropdown(true);
                              }
                            }}
                            data-testid="input-student-search"
                            className="pr-10"
                          />
                          <Search className="absolute right-3 top-3 h-4 w-4 text-gray-400" />
                          {selectedStudent && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="absolute right-8 top-1 h-6 w-6 p-0"
                              onClick={() => {
                                setSelectedStudent(null);
                                setStudentSearchTerm("");
                                setDebouncedSearchTerm("");
                                field.onChange(undefined);
                              }}
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          )}
                          {showStudentDropdown && debouncedSearchTerm.length >= 2 && !selectedStudent && (
                            <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto">
                              {searchedStudents.length > 0 ? (
                                searchedStudents.map((student: Student) => (
                                  <div
                                    key={student.id}
                                    className="px-3 py-2 cursor-pointer hover:bg-gray-100 border-b last:border-b-0"
                                    onClick={() => {
                                      setSelectedStudent(student);
                                      setStudentSearchTerm("");
                                      setShowStudentDropdown(false);
                                      field.onChange(student.id);
                                    }}
                                    data-testid={`student-option-${student.id}`}
                                  >
                                    <div className="font-medium">{student.firstName} {student.lastName}</div>
                                    <div className="text-sm text-gray-500">{student.email}</div>
                                    <div className="text-xs text-gray-400">{student.phone} • {student.courseType}</div>
                                  </div>
                                ))
                              ) : (
                                <div className="px-3 py-2 text-gray-500 text-sm">No students found</div>
                              )}
                            </div>
                          )}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="previousSchool"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>School Name</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          placeholder="e.g. ABC Driving School" 
                          data-testid="input-school-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="learnerPermitDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date Of Issue of Learner's Permit</FormLabel>
                      <FormControl>
                        <Input 
                          type="date"
                          {...field}
                          data-testid="input-permit-date"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Current Phase</label>
                    <Select 
                      value={selectedPhase?.toString() || ""} 
                      onValueChange={(value) => {
                        const phase = parseInt(value);
                        setSelectedPhase(phase);
                        setCompletedCourses([]); // Reset courses when phase changes
                      }}
                    >
                      <SelectTrigger data-testid="select-phase">
                        <SelectValue placeholder="Select phase" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Phase 1</SelectItem>
                        <SelectItem value="2">Phase 2</SelectItem>
                        <SelectItem value="3">Phase 3</SelectItem>
                        <SelectItem value="4">Phase 4</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedPhase && (
                    <FormField
                      control={form.control}
                      name="phaseStartDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Start Date of Phase {selectedPhase}</FormLabel>
                          <FormControl>
                            <Input 
                              type="date"
                              {...field}
                              data-testid="input-phase-start-date"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>

                <FormField
                  control={form.control}
                  name="courseType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Course Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-course-type">
                            <SelectValue placeholder="Select course type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="auto">Auto</SelectItem>
                          <SelectItem value="moto">Motorcycle</SelectItem>
                          <SelectItem value="scooter">Scooter</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="creditValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Credit Value ($)</FormLabel>
                      <FormControl>
                        <Input 
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          {...field}
                          data-testid="input-credit-value"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {selectedPhase && (
                  <div className="space-y-3">
                    <label className="text-sm font-medium">Completed Courses</label>
                    <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto border rounded-lg p-4">
                      {getAvailableCourses().map((course) => (
                        <label key={course} className="flex items-center space-x-2 cursor-pointer">
                          <Checkbox
                            checked={completedCourses.includes(course)}
                            onCheckedChange={(checked) => handleCourseToggle(course, checked === true)}
                            data-testid={`checkbox-${course.toLowerCase().replace(' ', '-')}`}
                          />
                          <span className="text-sm">{course}</span>
                        </label>
                      ))}
                    </div>
                    {completedCourses.length > 0 && (
                      <div className="text-sm text-muted-foreground">
                        Selected: {completedCourses.join(', ')}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-end space-x-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setShowNewForm(false)}>
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={createMutation.isPending}
                    data-testid="button-save-transfer"
                  >
                    {createMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-6">
        {transferCredits.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <GraduationCap className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No Course Transfers</h3>
              <p className="text-muted-foreground mb-4">Start by creating a course transfer application</p>
              <Button className="bg-gradient-to-r from-[#ECC462] to-amber-500 hover:from-[#d4ad4f] hover:to-amber-600 text-[#111111] font-medium shadow-lg hover:shadow-xl transition-all duration-200" onClick={() => setShowNewForm(true)} data-testid="button-create-first-transfer">
                <Plus className="h-4 w-4 mr-2" />
                Create First Course Transfer
              </Button>
            </CardContent>
          </Card>
        ) : (
          transferCredits.map((credit) => (
            <Card key={credit.id} data-testid={`card-transfer-${credit.id}`}>
              <CardContent className="pt-6">
                <div className="flex justify-between items-start">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold" data-testid={`text-student-name-${credit.id}`}>
                        {getStudentName(credit.studentId)}
                      </h3>
                      {getStatusBadge(credit.status)}
                    </div>
                    <p className="text-sm text-muted-foreground" data-testid={`text-previous-school-${credit.id}`}>
                      Transfer from: {credit.previousSchool}
                    </p>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="flex items-center gap-1">
                        <FileText className="h-4 w-4" />
                        {credit.courseType?.toUpperCase()}
                      </span>
                      <span data-testid={`text-phase-${credit.id}`}>Phase: {credit.currentPhase}</span>
                      <span data-testid={`text-permit-date-${credit.id}`}>
                        Permit: {new Date(credit.learnerPermitDate).toLocaleDateString()}
                      </span>
                      <span data-testid={`text-phase-start-${credit.id}`}>
                        Phase Start: {new Date(credit.phaseStartDate).toLocaleDateString()}
                      </span>
                    </div>
                    {credit.completedCourses && credit.completedCourses.length > 0 && (
                      <div className="text-sm">
                        <span className="font-medium">Completed Courses: </span>
                        <span data-testid={`text-completed-courses-${credit.id}`}>
                          {credit.completedCourses.join(', ')}
                        </span>
                      </div>
                    )}
                    {credit.equivalencyNotes && (
                      <p className="text-sm text-red-600" data-testid={`text-notes-${credit.id}`}>
                        Notes: {credit.equivalencyNotes}
                      </p>
                    )}
                  </div>
                  
                  {credit.status === 'pending' && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-green-600 border-green-600 hover:bg-green-50"
                        onClick={() => approveCredit(credit)}
                        disabled={updateMutation.isPending}
                        data-testid={`button-approve-${credit.id}`}
                      >
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 border-red-600 hover:bg-red-50"
                        onClick={() => denyCredit(credit)}
                        disabled={updateMutation.isPending}
                        data-testid={`button-deny-${credit.id}`}
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        Deny
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}