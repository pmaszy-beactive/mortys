import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, FileSignature, Calendar, Clock, User, LogOut, Car, BookOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useInstructorAuth } from "@/hooks/useInstructorAuth";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/utils";
import EvaluationForm from "@/components/evaluation-form";
import type { Class, Student } from "@shared/schema";

interface ClassNeedingEvaluation {
  class: Class;
  enrollment: any;
  student: Student;
}

export default function InstructorEvaluations() {
  const [selectedClass, setSelectedClass] = useState<{ classData: Class; student: Student } | null>(null);
  const { instructor, isLoading: authLoading, isAuthenticated } = useInstructorAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: classesNeedingEval = [], isLoading } = useQuery<ClassNeedingEvaluation[]>({
    queryKey: ["/api/instructor/classes-needing-evaluation"],
    enabled: !!instructor,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const { data: completedEvaluations = [] } = useQuery({
    queryKey: ["/api/instructor/evaluations"],
    enabled: !!instructor,
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      setLocation("/instructor/login");
    }
  }, [authLoading, isAuthenticated, setLocation]);

  const createMutation = useMutation({
    mutationFn: (evaluationData: any) => apiRequest('POST', '/api/instructor/evaluations', evaluationData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/instructor/evaluations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/instructor/classes-needing-evaluation'] });
      queryClient.invalidateQueries({ queryKey: ['/api/instructor/dashboard'] });
      setSelectedClass(null);
      toast({
        title: "Success",
        description: "Evaluation created successfully with your signature",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create evaluation",
        variant: "destructive",
      });
    },
  });

  const handleCreateEvaluation = (data: any) => {
    if (!selectedClass) return;
    
    // Add class and student information to the evaluation
    const evaluationData = {
      ...data,
      classId: selectedClass.classData.id,
      studentId: selectedClass.student.id,
      sessionType: selectedClass.classData.classNumber === 1 || selectedClass.classData.classNumber === 5 ? 'theory' : 'in-car',
      evaluationDate: new Date().toISOString().split('T')[0],
    };
    
    createMutation.mutate(evaluationData);
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
      window.location.href = '/instructor/login';
    } catch (error) {
      console.error('Logout error:', error);
      window.location.href = '/instructor/login';
    }
  };

  const getClassTypeInfo = (classNumber: number) => {
    if (classNumber === 1 || classNumber === 5) {
      return { type: 'Theory', icon: BookOpen, color: 'text-blue-600', bgColor: 'bg-blue-50' };
    }
    return { type: 'Driving', icon: Car, color: 'text-green-600', bgColor: 'bg-green-50' };
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-[#ECC462] mx-auto mb-4"></div>
          <p className="text-gray-700 font-medium">Loading...</p>
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
                data-testid="button-back-dashboard"
              >
                <ArrowLeft className="flex-shrink-0 h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
                  Student Evaluations
                </h1>
                <p className="text-sm sm:text-base text-gray-600">Complete evaluations for your classes</p>
              </div>
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

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="stat-card">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-gray-100 rounded-md p-3">
                <FileSignature className="h-8 w-8 text-gray-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Pending Evaluations</p>
                <p className="text-3xl font-bold text-gray-900">{classesNeedingEval.length}</p>
              </div>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-gray-100 rounded-md p-3">
                <FileSignature className="h-8 w-8 text-gray-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Completed</p>
                <p className="text-3xl font-bold text-gray-900">{Array.isArray(completedEvaluations) ? completedEvaluations.length : 0}</p>
              </div>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-gray-100 rounded-md p-3">
                <User className="h-8 w-8 text-gray-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Unique Students</p>
                <p className="text-3xl font-bold text-gray-900">
                  {new Set(classesNeedingEval.map(c => c.student.id)).size}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Classes Needing Evaluation */}
        <Card className="border border-gray-200 rounded-md shadow-sm bg-white overflow-hidden">
          <CardHeader className="border-b bg-gray-50">
            <CardTitle className="text-gray-900 text-xl font-semibold">Classes Awaiting Evaluation</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {classesNeedingEval.length === 0 ? (
              <div className="text-center py-12">
                <FileSignature className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-700 mb-2">All Caught Up!</h3>
                <p className="text-gray-500">
                  There are no classes waiting for evaluation at the moment.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead>Class Type</TableHead>
                      <TableHead>Class #</TableHead>
                      <TableHead>Course</TableHead>
                      <TableHead>Date & Time</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {classesNeedingEval.map((item, index) => {
                      const classTypeInfo = getClassTypeInfo(item.class.classNumber);
                      const ClassIcon = classTypeInfo.icon;
                      
                      return (
                        <TableRow key={index} className="transition-colors duration-150 hover:bg-gray-50">
                          <TableCell className="font-medium">
                            <div className="flex items-center space-x-2">
                              <User className="h-4 w-4 text-gray-400" />
                              <span className="text-gray-900">{item.student.firstName} {item.student.lastName}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center space-x-2">
                              <div className="bg-gray-100 p-1.5 rounded-md">
                                <ClassIcon className={`h-4 w-4 text-gray-600`} />
                              </div>
                              <span className={`text-sm text-gray-700 font-medium`}>
                                {classTypeInfo.type}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="rounded-md">Class {item.class.classNumber}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="capitalize rounded-md">
                              {item.class.courseType}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col space-y-1">
                              <div className="flex items-center space-x-1 text-sm text-gray-600">
                                <Calendar className="h-3 w-3 text-gray-400" />
                                <span>{formatDate(item.class.date)}</span>
                              </div>
                              <div className="flex items-center space-x-1 text-sm text-gray-500">
                                <Clock className="h-3 w-3 text-gray-400" />
                                <span>{item.class.time}</span>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge 
                              variant={item.class.status === 'completed' ? 'default' : 'secondary'}
                              className="capitalize rounded-md"
                            >
                              {item.class.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              onClick={() => setSelectedClass({ classData: item.class, student: item.student })}
                              className="bg-[#ECC462] hover:bg-[#d4af56] text-[#111111] rounded-md shadow-sm"
                              data-testid={`button-evaluate-${item.class.id}-${item.student.id}`}
                            >
                              <FileSignature className="h-4 w-4 mr-2" />
                              Evaluate
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Evaluation Dialog */}
      <Dialog open={!!selectedClass} onOpenChange={(open) => !open && setSelectedClass(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Evaluation</DialogTitle>
            <DialogDescription>
              {selectedClass && (
                <>
                  Evaluating <strong>{selectedClass.student.firstName} {selectedClass.student.lastName}</strong> for{' '}
                  <strong>Class {selectedClass.classData.classNumber}</strong> ({selectedClass.classData.courseType}) on {formatDate(selectedClass.classData.date)}
                  <br />
                  <span className="text-sm text-amber-600 mt-2 block">
                    Your signature will be automatically added to this evaluation.
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {selectedClass && (
            <EvaluationForm
              evaluation={undefined}
              onSuccess={() => {
                queryClient.invalidateQueries({ queryKey: ['/api/instructor/classes-needing-evaluation'] });
                queryClient.invalidateQueries({ queryKey: ['/api/instructor/evaluations'] });
                queryClient.invalidateQueries({ queryKey: ['/api/instructor/dashboard'] });
                setSelectedClass(null);
              }}
              prefilledData={{
                studentId: selectedClass.student.id,
                studentName: `${selectedClass.student.firstName} ${selectedClass.student.lastName}`,
                instructorId: instructor?.id,
                instructorName: instructor ? `${instructor.firstName} ${instructor.lastName}` : undefined,
                classId: selectedClass.classData.id,
                sessionType: selectedClass.classData.classNumber === 1 || selectedClass.classData.classNumber === 5 ? 'theory' : 'in-car',
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
