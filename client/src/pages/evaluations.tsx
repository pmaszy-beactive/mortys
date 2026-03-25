import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Edit, Eye, CheckCircle, Star, FileSignature, Check, X } from "lucide-react";
import EvaluationForm from "@/components/evaluation-form";
import SignatureDisplay from "@/components/signature-display";
import { formatDate } from "@/lib/utils";
import type { Evaluation, Student, Instructor } from "@shared/schema";

const drivingChecklistCategories = {
  "Stopping": [
    "Makes full stops",
    "Looks left-right-left",
    "Stops before stop line or pole",
    "Performs double stops when required",
    "Starts braking early enough"
  ],
  "Turning": [
    "Uses hand over hand steering",
    "Turns into proper lane",
    "Signals and checks blind spots",
    "Handles boulevards properly",
    "Navigates side streets correctly"
  ],
  "Lane Changes": [
    "Hesitates appropriately before changing",
    "Signals before lane changes",
    "Checks blind spots",
    "Uses mirrors effectively",
    "Builds confidence in lane changes"
  ],
  "Acceleration/Deceleration": [
    "Avoids sudden acceleration",
    "Avoids abrupt deceleration", 
    "Manages heavy foot tendency",
    "Smooth speed transitions"
  ],
  "Parking": [
    "Parallel parking",
    "Reverse park 90 degrees",
    "Front parking",
    "Proper positioning within space"
  ],
  "Highway": [
    "Student went on highway",
    "Merging technique",
    "Checks mirrors regularly",
    "Maintains speed limit",
    "Lane discipline on highway"
  ],
  "Practice at Home": [
    "Student practices at home",
    "Regular practice schedule",
    "Improvement noted from practice"
  ]
};

export default function Evaluations() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingEvaluation, setEditingEvaluation] = useState<Evaluation | null>(null);
  const [viewingEvaluation, setViewingEvaluation] = useState<Evaluation | null>(null);

  const { data: evaluations = [], isLoading: evaluationsLoading } = useQuery<Evaluation[]>({
    queryKey: ["/api/evaluations"],
  });

  const { data: studentsResponse } = useQuery<{ students: Student[] }>({
    queryKey: ["/api/students"],
  });

  const students: Student[] = studentsResponse?.students || [];

  const { data: instructors = [] } = useQuery<Instructor[]>({
    queryKey: ["/api/instructors"],
  });

  const getStudentName = (studentId: number | null) => {
    if (!studentId) return "Unknown Student";
    const student = students.find(s => s.id === studentId);
    return student ? `${student.firstName} ${student.lastName}` : "Unknown Student";
  };

  const getInstructorName = (instructorId: number | null) => {
    if (!instructorId) return "Unknown Instructor";
    const instructor = instructors.find(i => i.id === instructorId);
    return instructor ? `${instructor.firstName} ${instructor.lastName}` : "Unknown Instructor";
  };

  const renderRatingStars = (rating: number | null) => {
    if (!rating) return <span className="text-gray-400">Not rated</span>;
    
    return (
      <div className="flex items-center">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`h-4 w-4 ${
              star <= rating ? 'text-yellow-400 fill-current' : 'text-gray-300'
            }`}
          />
        ))}
        <span className="ml-2 text-sm text-gray-600">({rating}/5)</span>
      </div>
    );
  };

  const isCategoryNA = (category: string, checklist: Record<string, boolean>) => {
    return checklist[`${category}: N/A`] || false;
  };

  const isItemNA = (itemKey: string, checklist: Record<string, boolean>) => {
    return checklist[`${itemKey}: N/A`] || false;
  };

  const isItemIncomplete = (itemKey: string, checklist: Record<string, boolean>, categoryNA: boolean) => {
    if (categoryNA) return false;
    const itemChecked = checklist[itemKey] || false;
    const itemNA = isItemNA(itemKey, checklist);
    return !itemChecked && !itemNA;
  };

  const renderChecklistIcon = (itemKey: string, checklist: Record<string, boolean>, categoryNA: boolean) => {
    if (categoryNA) {
      return <Badge variant="outline" className="text-xs bg-orange-100 text-orange-600 shadow-sm">N/A</Badge>;
    }
    
    const itemChecked = checklist[itemKey] || false;
    const itemNA = isItemNA(itemKey, checklist);
    const incomplete = isItemIncomplete(itemKey, checklist, categoryNA);

    if (itemChecked) {
      return <Check className="h-4 w-4 text-green-600" />;
    } else if (itemNA) {
      return <Badge variant="outline" className="text-xs bg-orange-100 text-orange-600 shadow-sm">N/A</Badge>;
    } else if (incomplete) {
      return <X className="h-4 w-4 text-red-600" />;
    }
    
    return <span className="h-4 w-4"></span>;
  };

  if (evaluationsLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="animate-pulse space-y-8">
          <div className="h-12 bg-gray-200 rounded-md w-1/3"></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 bg-white border border-gray-200 rounded-md"></div>
            ))}
          </div>
          <div className="h-96 bg-white border border-gray-200 rounded-md"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">
              Student Evaluations
            </h1>
            <p className="text-gray-600">
              Track and manage in-car evaluations and student progress assessments.
            </p>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] font-medium rounded-md transition-all duration-200">
                <Plus className="mr-2 h-4 w-4" />
                New Evaluation
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create New Evaluation</DialogTitle>
                <DialogDescription>
                  Complete an evaluation form for a student's driving session.
                </DialogDescription>
              </DialogHeader>
              <EvaluationForm onSuccess={() => setIsCreateDialogOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="stat-card">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-600 mb-1">Total Evaluations</p>
                <p className="text-3xl font-bold text-gray-900">
                  {evaluations.length}
                </p>
              </div>
              <CheckCircle className="text-gray-400 h-6 w-6" />
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-600 mb-1">Signed Off</p>
                <p className="text-3xl font-bold text-gray-900">
                  {evaluations.filter(e => e.signedOff).length}
                </p>
              </div>
              <CheckCircle className="text-gray-400 h-6 w-6" />
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-600 mb-1">Avg Rating</p>
                <p className="text-3xl font-bold text-gray-900">
                  {evaluations.length > 0 
                    ? (evaluations.reduce((sum, e) => sum + (e.overallRating || 0), 0) / evaluations.length).toFixed(1)
                    : "0"
                  }
                </p>
              </div>
              <Star className="text-gray-400 h-6 w-6" />
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-600 mb-1">In-Car Sessions</p>
                <p className="text-3xl font-bold text-gray-900">
                  {evaluations.filter(e => e.sessionType === "in-car").length}
                </p>
              </div>
              <CheckCircle className="text-gray-400 h-6 w-6" />
            </div>
          </div>
        </div>

        <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
          <CardHeader className="bg-gray-50/50 border-b border-gray-200">
            <CardTitle className="text-xl font-semibold text-gray-900">Recent Evaluations</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-200">
                    <TableHead className="font-semibold text-gray-700">Student</TableHead>
                    <TableHead className="font-semibold text-gray-700">Instructor</TableHead>
                    <TableHead className="font-semibold text-gray-700">Date</TableHead>
                    <TableHead className="font-semibold text-gray-700">Session Type</TableHead>
                    <TableHead className="font-semibold text-gray-700">Rating</TableHead>
                    <TableHead className="font-semibold text-gray-700">Status</TableHead>
                    <TableHead className="font-semibold text-gray-700">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {evaluations.map((evaluation) => (
                    <TableRow 
                      key={evaluation.id}
                      className="border-gray-100 hover:bg-gray-50 transition-all duration-200"
                    >
                      <TableCell>
                        <div className="text-sm font-semibold text-gray-900">
                          {getStudentName(evaluation.studentId)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-600">
                          {getInstructorName(evaluation.instructorId)}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-gray-900">
                        {formatDate(evaluation.evaluationDate)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={
                          evaluation.sessionType === "in-car" 
                            ? "text-[#111111] border-[#ECC462]" 
                            : "text-gray-600 border-gray-200"
                        }>
                          {evaluation.sessionType === "in-car" ? "In-Car" : "Theory"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {renderRatingStars(evaluation.overallRating)}
                      </TableCell>
                      <TableCell>
                        {evaluation.signedOff ? (
                          <Badge variant="outline" className="text-green-700 border-green-200 bg-green-50">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Signed Off
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-700 border-amber-200 bg-amber-50">
                            Pending Sign-off
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex space-x-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewingEvaluation(evaluation)}
                            className="h-8 w-8 p-0 rounded-md"
                            data-testid={`button-view-evaluation-${evaluation.id}`}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingEvaluation(evaluation)}
                            className="h-8 w-8 p-0 rounded-md"
                            data-testid={`button-edit-evaluation-${evaluation.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          {evaluation.instructorSignature && (
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button variant="ghost" size="sm" title="View Digital Signature" className="h-8 w-8 p-0 text-green-600 rounded-md">
                                  <FileSignature className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-2xl">
                                <DialogHeader>
                                  <DialogTitle>Digital Signature</DialogTitle>
                                  <DialogDescription>
                                    Instructor signature for {getStudentName(evaluation.studentId)}'s evaluation
                                  </DialogDescription>
                                </DialogHeader>
                                <SignatureDisplay
                                  signature={evaluation.instructorSignature}
                                  instructorName={getInstructorName(evaluation.instructorId)}
                                  signatureDate={evaluation.signatureDate || undefined}
                                  ipAddress={evaluation.signatureIpAddress || undefined}
                                  title="Evaluation Sign-Off"
                                />
                              </DialogContent>
                            </Dialog>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {evaluations.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-gray-500">
                        <div className="flex flex-col items-center gap-2">
                          <CheckCircle className="h-10 w-10 text-gray-300" />
                          <p className="font-semibold text-gray-900">No evaluations found</p>
                          <p className="text-sm">Create your first evaluation to get started.</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {editingEvaluation && (
          <Dialog open={true} onOpenChange={() => setEditingEvaluation(null)}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Edit Evaluation</DialogTitle>
                <DialogDescription>
                  Update evaluation details and assessment.
                </DialogDescription>
              </DialogHeader>
              <EvaluationForm 
                evaluation={editingEvaluation} 
                onSuccess={() => setEditingEvaluation(null)} 
              />
            </DialogContent>
          </Dialog>
        )}

        <Dialog open={!!viewingEvaluation} onOpenChange={() => setViewingEvaluation(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Evaluation Details</DialogTitle>
              <DialogDescription>
                View evaluation for {viewingEvaluation ? getStudentName(viewingEvaluation.studentId) : ''}
              </DialogDescription>
            </DialogHeader>
            {viewingEvaluation && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700">Student</label>
                    <p className="text-gray-900">{getStudentName(viewingEvaluation.studentId)}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">Instructor</label>
                    <p className="text-gray-900">{getInstructorName(viewingEvaluation.instructorId)}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">Session Type</label>
                    <p className="text-gray-900 capitalize">
                      {viewingEvaluation.sessionType === 'in-car' ? 'Driving Session' : 'Theory Session'}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">Date</label>
                    <p className="text-gray-900">
                      {viewingEvaluation.evaluationDate ? formatDate(viewingEvaluation.evaluationDate) : 'Not set'}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">Overall Rating</label>
                    <div className="mt-1">
                      {renderRatingStars(viewingEvaluation.overallRating)}
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">Status</label>
                    <div className="mt-1">
                      {viewingEvaluation.signedOff ? (
                        <Badge className="bg-green-600 text-white">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Signed Off
                        </Badge>
                      ) : (
                        <Badge className="bg-amber-600 text-white">
                          Pending Sign-off
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                {viewingEvaluation.strengths && (
                  <div>
                    <label className="text-sm font-medium text-gray-700">Strengths</label>
                    <p className="text-gray-900 mt-1">{viewingEvaluation.strengths}</p>
                  </div>
                )}

                {viewingEvaluation.weaknesses && (
                  <div>
                    <label className="text-sm font-medium text-gray-700">Areas for Improvement</label>
                    <p className="text-gray-900 mt-1">{viewingEvaluation.weaknesses}</p>
                  </div>
                )}

                {Boolean(viewingEvaluation.notes) && (
                  <div>
                    <label className="text-sm font-medium text-gray-700">Additional Notes</label>
                    <p className="text-gray-900 mt-1">{viewingEvaluation.notes as string}</p>
                  </div>
                )}

                {viewingEvaluation.sessionType === 'in-car' && !!viewingEvaluation.checklist && (
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-4 block">Driving Skills Assessment</label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {Object.entries(drivingChecklistCategories).map(([category, items]) => {
                        const checklist = viewingEvaluation.checklist as Record<string, boolean>;
                        const categoryNA = isCategoryNA(category, checklist);
                        
                        return (
                          <div key={category} className="space-y-3 bg-gray-50 p-4 rounded-md border border-gray-200">
                            <div className="flex items-center justify-between border-b border-gray-200 pb-2">
                              <h4 className={`font-semibold ${categoryNA ? 'text-gray-400' : 'text-gray-900'}`}>
                                {category}
                              </h4>
                              {categoryNA && (
                                <Badge variant="outline" className="bg-orange-100 text-orange-600 shadow-sm">
                                  Category N/A
                                </Badge>
                              )}
                            </div>
                            <div className="space-y-2">
                              {items.map((item) => {
                                const itemKey = `${category}: ${item}`;
                                const isIncomplete = isItemIncomplete(itemKey, checklist, categoryNA);
                                
                                return (
                                  <div
                                    key={itemKey}
                                    className={`flex items-center justify-between py-1 px-2 rounded transition-all duration-200 ${
                                      isIncomplete ? 'bg-red-50 border border-red-200' : ''
                                    }`}
                                    data-testid={`checklist-item-${category.toLowerCase().replace(/\s+/g, '-')}-${item.toLowerCase().replace(/\s+/g, '-')}`}
                                  >
                                    <span className={`text-sm ${
                                      categoryNA 
                                        ? 'text-gray-400' 
                                        : isIncomplete 
                                          ? 'text-red-700' 
                                          : 'text-gray-700'
                                    }`}>
                                      {item}
                                    </span>
                                    <div className="flex items-center">
                                      {renderChecklistIcon(itemKey, checklist, categoryNA)}
                                      {isIncomplete && (
                                        <span 
                                          className="ml-2 text-xs text-red-600 font-medium"
                                          data-testid={`incomplete-indicator-${category.toLowerCase().replace(/\s+/g, '-')}-${item.toLowerCase().replace(/\s+/g, '-')}`}
                                        >
                                          Not Done
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {viewingEvaluation.instructorSignature && (
                  <div className="border-t pt-4">
                    <SignatureDisplay
                      signature={viewingEvaluation.instructorSignature}
                      instructorName={getInstructorName(viewingEvaluation.instructorId)}
                      signatureDate={viewingEvaluation.signatureDate || undefined}
                      ipAddress={viewingEvaluation.signatureIpAddress || undefined}
                      title="Instructor Sign-Off"
                    />
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
