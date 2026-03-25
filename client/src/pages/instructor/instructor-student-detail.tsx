import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, User, Phone, Mail, Calendar, FileText, Star, Plus, Lock, MessageSquare, Trash2, Send, BookOpen } from "lucide-react";
import { useInstructorAuth } from "@/hooks/useInstructorAuth";
import { useLocation } from "wouter";
import { formatDate } from "@/lib/utils";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Student, Evaluation, StudentNote } from "@shared/schema";
import type { PhaseProgressData } from "@shared/phaseConfig";
import PhaseProgressTracker, { PhaseProgressTrackerSkeleton } from "@/components/phase-progress-tracker";

interface StudentDetailProps {
  studentId: number;
}

interface StudentDetailData {
  student: Student;
  evaluations: Evaluation[];
}

export default function InstructorStudentDetail({ studentId }: StudentDetailProps) {
  const { instructor, isLoading: authLoading } = useInstructorAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showInternalNoteForm, setShowInternalNoteForm] = useState(false);
  const [showVisibleNoteForm, setShowVisibleNoteForm] = useState(false);
  const [internalNoteContent, setInternalNoteContent] = useState("");
  const [visibleNoteContent, setVisibleNoteContent] = useState("");

  const { data: studentData, isLoading } = useQuery<StudentDetailData>({
    queryKey: [`/api/instructor/students/${studentId}`],
    enabled: !!instructor && !!studentId,
  });

  const { data: studentNotes = [] } = useQuery<StudentNote[]>({
    queryKey: ['/api/students', studentId, 'notes'],
    queryFn: () => apiRequest("GET", `/api/students/${studentId}/notes`),
    enabled: !!instructor && !!studentId,
  });

  const { data: phaseProgressData, isLoading: phaseLoading } = useQuery<PhaseProgressData>({
    queryKey: ['/api/students', studentId, 'phase-progress'],
    queryFn: () => apiRequest("GET", `/api/students/${studentId}/phase-progress`),
    enabled: !!instructor && !!studentId,
  });

  const createNoteMutation = useMutation({
    mutationFn: (data: { noteType: string; content: string }) =>
      apiRequest("POST", `/api/students/${studentId}/notes`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/students', studentId, 'notes'] });
      setInternalNoteContent("");
      setVisibleNoteContent("");
      setShowInternalNoteForm(false);
      setShowVisibleNoteForm(false);
      toast({ title: "Note added successfully" });
    },
    onError: () => {
      toast({ title: "Failed to add note", variant: "destructive" });
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (noteId: number) =>
      apiRequest("DELETE", `/api/students/${studentId}/notes/${noteId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/students', studentId, 'notes'] });
      toast({ title: "Note deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete note", variant: "destructive" });
    },
  });

  const renderRatingStars = (rating: number | null) => {
    if (!rating) return <span className="text-gray-400">Not rated</span>;
    
    return (
      <div className="flex items-center">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`h-4 w-4 ${
              star <= rating ? 'text-yellow-400 fill-current drop-shadow-sm' : 'text-gray-300'
            }`}
          />
        ))}
        <span className="ml-2 text-sm text-gray-600">({rating}/5)</span>
      </div>
    );
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-[#ECC462] mx-auto mb-4"></div>
          <p className="text-gray-700 font-medium">Loading student details...</p>
        </div>
      </div>
    );
  }

  if (!studentData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="bg-gray-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
            <User className="h-10 w-10 text-gray-400" />
          </div>
          <p className="text-gray-700 font-medium">Student not found or access denied</p>
          <Button 
            className="mt-4 bg-[#ECC462] hover:bg-[#d4af56] text-[#111111] rounded-md"
            onClick={() => setLocation('/instructor/students')}
          >
            Back to Students
          </Button>
        </div>
      </div>
    );
  }

  const { student, evaluations } = studentData;

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
                onClick={() => setLocation('/instructor/students')}
                className="hover:bg-gray-100 transition-colors"
              >
                <ArrowLeft className="flex-shrink-0 h-4 w-4 mr-2" />
                Back to Students
              </Button>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
                  {student.firstName} {student.lastName}
                </h1>
                <p className="text-sm sm:text-base text-gray-600">Student Profile & Evaluations</p>
              </div>
            </div>
            <Button 
              onClick={() => setLocation('/instructor/evaluations')}
              className="w-full sm:w-auto bg-[#ECC462] hover:bg-[#d4af56] text-[#111111] rounded-md shadow-sm"
            >
              <Plus className="flex-shrink-0 h-4 w-4 mr-2" />
              Create Evaluation
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Phase Progress */}
        <div className="mb-8">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-[#ECC462]" />
            Phase Progress
          </h2>
          {phaseLoading ? (
            <PhaseProgressTrackerSkeleton />
          ) : phaseProgressData ? (
            <PhaseProgressTracker phaseData={phaseProgressData} compact />
          ) : null}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Student Information */}
          <div className="lg:col-span-1">
            <Card className="border border-gray-200 rounded-md shadow-sm bg-white overflow-hidden">
              <CardHeader className="border-b bg-gray-50">
                <CardTitle className="flex items-center text-gray-900 text-xl font-semibold">
                  <div className="bg-gray-100 rounded-md p-2 mr-3">
                    <User className="h-5 w-5 text-[#ECC462]" />
                  </div>
                  Student Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-6">
                <div>
                  <label className="text-sm font-medium text-gray-500 uppercase tracking-wider">Email</label>
                  <div className="flex items-center mt-1 p-2 rounded-md hover:bg-gray-50 transition-colors">
                    <div className="bg-gray-100 rounded p-1.5 mr-2 flex-shrink-0">
                      <Mail className="h-4 w-4 text-gray-400" />
                    </div>
                    <span className="text-gray-900 truncate" title={student.email || 'Not provided'}>{student.email || 'Not provided'}</span>
                  </div>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-gray-500 uppercase tracking-wider">Phone</label>
                  <div className="flex items-center mt-1 p-2 rounded-md hover:bg-gray-50 transition-colors">
                    <div className="bg-gray-100 rounded p-1.5 mr-2 flex-shrink-0">
                      <Phone className="h-4 w-4 text-gray-400" />
                    </div>
                    <span className="text-gray-900 truncate" title={student.phone || 'Not provided'}>{student.phone || 'Not provided'}</span>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-500 uppercase tracking-wider">Course Type</label>
                  <div className="mt-1">
                    <Badge variant="outline" className="capitalize rounded-md">
                      {student.courseType}
                    </Badge>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-500 uppercase tracking-wider">Status</label>
                  <div className="mt-1">
                    <Badge 
                      variant={student.status === 'active' ? 'default' : 'secondary'}
                      className="capitalize rounded-md"
                    >
                      {student.status}
                    </Badge>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-500 uppercase tracking-wider">Progress</label>
                  <div className="mt-1">
                    <span className="text-2xl font-bold text-gray-900">
                      {student.progress || 0}%
                    </span>
                  </div>
                </div>

                {student.enrollmentDate && (
                  <div>
                    <label className="text-sm font-medium text-gray-500 uppercase tracking-wider">Enrollment Date</label>
                    <div className="flex items-center mt-1 p-2 rounded-md hover:bg-gray-50 transition-colors">
                      <div className="bg-gray-100 rounded p-1.5 mr-2 flex-shrink-0">
                        <Calendar className="h-4 w-4 text-gray-400" />
                      </div>
                      <span className="text-gray-900">{formatDate(student.enrollmentDate)}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Evaluations */}
          <div className="lg:col-span-2">
            <Card className="border border-gray-200 rounded-md shadow-sm bg-white overflow-hidden">
              <CardHeader className="border-b bg-gray-50">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center text-gray-900 text-xl font-semibold">
                    <div className="bg-gray-100 rounded-md p-2 mr-3">
                      <FileText className="h-5 w-5 text-[#ECC462]" />
                    </div>
                    My Evaluations ({evaluations.length})
                  </CardTitle>
                  <Button 
                    size="sm"
                    onClick={() => setLocation('/instructor/evaluations')}
                    className="bg-[#ECC462] hover:bg-[#d4af56] text-[#111111] rounded-md shadow-sm"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    New Evaluation
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                {evaluations.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="bg-gray-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                      <FileText className="h-10 w-10 text-gray-300" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900">
                      No evaluations yet
                    </h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Create your first evaluation for this student.
                    </p>
                    <div className="mt-6">
                      <Button 
                        size="sm"
                        onClick={() => setLocation('/instructor/evaluations')}
                        className="bg-[#ECC462] hover:bg-[#d4af56] text-[#111111] rounded-md shadow-sm"
                      >
                        <Plus className="flex-shrink-0 h-4 w-4 mr-2" />
                        Create Evaluation
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Session Type</TableHead>
                          <TableHead>Rating</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {evaluations.map((evaluation) => (
                          <TableRow 
                            key={evaluation.id}
                            className="transition-colors duration-150 hover:bg-gray-50"
                          >
                            <TableCell>
                              {evaluation.evaluationDate ? formatDate(evaluation.evaluationDate) : 'Not set'}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="capitalize rounded-md">
                                {evaluation.sessionType === 'in-car' ? 'Driving' : 'Theory'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {renderRatingStars(evaluation.overallRating)}
                            </TableCell>
                            <TableCell>
                              <Badge 
                                variant={evaluation.signedOff ? "default" : "secondary"}
                                className="rounded-md"
                              >
                                {evaluation.signedOff ? "Completed" : "Pending"}
                              </Badge>
                            </TableCell>
                            <TableCell className="max-w-xs">
                              {evaluation.notes ? (
                                <span className="text-sm text-gray-600 truncate block">
                                  {evaluation.notes}
                                </span>
                              ) : (
                                <span className="text-sm text-gray-400">No notes</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Student Notes Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
          <Card className="border border-gray-200 rounded-md shadow-sm bg-white overflow-hidden">
            <CardHeader className="border-b bg-gray-50">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center text-gray-900 text-xl font-semibold">
                  <div className="bg-gray-100 rounded-md p-2 mr-3">
                    <Lock className="h-5 w-5 text-gray-600" />
                  </div>
                  Internal Notes (Staff Only)
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-gray-200 text-gray-700 hover:bg-gray-50 rounded-md"
                  onClick={() => setShowInternalNoteForm(!showInternalNoteForm)}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Note
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {showInternalNoteForm && (
                <div className="mb-4 space-y-2 p-3 bg-gray-50 rounded-md border border-gray-200">
                  <Textarea
                    placeholder="Write an internal note..."
                    value={internalNoteContent}
                    onChange={(e: any) => setInternalNoteContent(e.target.value)}
                    rows={3}
                    className="border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462] rounded-md"
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      disabled={!internalNoteContent.trim() || createNoteMutation.isPending}
                      onClick={() => createNoteMutation.mutate({ noteType: 'internal', content: internalNoteContent })}
                      className="bg-[#ECC462] hover:bg-[#d4af56] text-[#111111] rounded-md"
                    >
                      <Send className="h-4 w-4 mr-1" />
                      Submit
                    </Button>
                  </div>
                </div>
              )}
              {studentNotes.filter(n => n.noteType === 'internal').length === 0 ? (
                <div className="text-center py-6 text-gray-400">
                  <Lock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No internal notes yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {studentNotes.filter(n => n.noteType === 'internal').map((note) => (
                    <div key={note.id} className="p-3 bg-gray-50 rounded-md border border-gray-100">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-gray-900">{note.authorName}</span>
                          <Badge variant="outline" className="text-xs capitalize rounded-md">{note.authorRole}</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400">
                            {note.createdAt ? new Date(note.createdAt).toLocaleDateString() : ''}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-gray-400 hover:text-red-600"
                            onClick={() => deleteNoteMutation.mutate(note.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 whitespace-pre-wrap">{note.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border border-gray-200 rounded-md shadow-sm bg-white overflow-hidden">
            <CardHeader className="border-b bg-gray-50">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center text-gray-900 text-xl font-semibold">
                  <div className="bg-gray-100 rounded-md p-2 mr-3">
                    <MessageSquare className="h-5 w-5 text-gray-600" />
                  </div>
                  Notes Shared with Student
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-gray-200 text-gray-700 hover:bg-gray-50 rounded-md"
                  onClick={() => setShowVisibleNoteForm(!showVisibleNoteForm)}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Note
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {showVisibleNoteForm && (
                <div className="mb-4 space-y-2 p-3 bg-gray-50 rounded-md border border-gray-200">
                  <Textarea
                    placeholder="Write a note visible to the student..."
                    value={visibleNoteContent}
                    onChange={(e: any) => setVisibleNoteContent(e.target.value)}
                    rows={3}
                    className="border-gray-200 focus:border-[#ECC462] focus:ring-[#ECC462] rounded-md"
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      disabled={!visibleNoteContent.trim() || createNoteMutation.isPending}
                      onClick={() => createNoteMutation.mutate({ noteType: 'student_visible', content: visibleNoteContent })}
                      className="bg-[#ECC462] hover:bg-[#d4af56] text-[#111111] rounded-md"
                    >
                      <Send className="h-4 w-4 mr-1" />
                      Submit
                    </Button>
                  </div>
                </div>
              )}
              {studentNotes.filter(n => n.noteType === 'student_visible').length === 0 ? (
                <div className="text-center py-6 text-gray-400">
                  <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No student-visible notes yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {studentNotes.filter(n => n.noteType === 'student_visible').map((note) => (
                    <div key={note.id} className="p-3 bg-gray-50 rounded-md border border-gray-100">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-gray-900">{note.authorName}</span>
                          <Badge variant="outline" className="text-xs capitalize rounded-md">{note.authorRole}</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400">
                            {note.createdAt ? new Date(note.createdAt).toLocaleDateString() : ''}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-gray-400 hover:text-red-600"
                            onClick={() => deleteNoteMutation.mutate(note.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 whitespace-pre-wrap">{note.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
